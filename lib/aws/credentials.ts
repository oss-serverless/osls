'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { fromIni, fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { buildHttpOptions } = require('./config');
const { withInteractiveSsoLogin } = require('./sso-login');
const ServerlessError = require('../serverless-error');
const { log } = require('../utils/serverless-utils/log');

// Inner SSO/OIDC/STS clients created during credential resolution inherit the same
// proxy, CA, and timeout configuration as regular clients
let sharedRequestHandler;

function getCredentialsRequestHandler() {
  if (!sharedRequestHandler) sharedRequestHandler = new NodeHttpHandler(buildHttpOptions());
  return sharedRequestHandler;
}

function hasEnvironmentCredentials(prefix) {
  return Boolean(
    process.env[`${prefix}_ACCESS_KEY_ID`] && process.env[`${prefix}_SECRET_ACCESS_KEY`]
  );
}

function fromPrefixedEnv(prefix) {
  return async () => {
    const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`];
    const secretAccessKey = process.env[`${prefix}_SECRET_ACCESS_KEY`];
    const sessionToken = process.env[`${prefix}_SESSION_TOKEN`];

    if (!accessKeyId || !secretAccessKey) {
      throw Object.assign(new Error(`Could not load credentials from ${prefix} environment`), {
        name: 'CredentialsProviderError',
      });
    }

    return {
      accessKeyId,
      secretAccessKey,
      sessionToken,
    };
  };
}

function promptMfaCode(mfaSerial) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve, reject) => {
    let answered = false;
    rl.question(`Enter MFA code for ${mfaSerial}: `, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    // Without this, stdin EOF (e.g. in CI) would leave the promise unsettled forever
    rl.on('close', () => {
      if (!answered) {
        reject(
          new ServerlessError(
            `MFA code required for ${mfaSerial} but no interactive terminal is available`,
            'MFA_CODE_UNAVAILABLE'
          )
        );
      }
    });
  });
}

function expandHomeDirPath(filePath) {
  return filePath.startsWith('~/') ? path.join(os.homedir(), filePath.slice(2)) : filePath;
}

function getSharedCredentialsFilepath() {
  return expandHomeDirPath(
    process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), '.aws', 'credentials')
  );
}

function getSharedConfigFilepath() {
  return expandHomeDirPath(
    process.env.AWS_CONFIG_FILE || path.join(os.homedir(), '.aws', 'config')
  );
}

function fromProfile(profile) {
  maybeWarnIdentityDivergence(profile);
  const requestHandler = getCredentialsRequestHandler();
  const filepath = getSharedCredentialsFilepath();
  const configFilepath = getSharedConfigFilepath();
  const provider = fromIni({
    profile,
    filepath,
    configFilepath,
    mfaCodeProvider: promptMfaCode,
    // Region is deliberately omitted: it would override the profile's sso_region
    clientConfig: { requestHandler },
  });
  return withInteractiveSsoLogin({
    profile,
    provider,
    filepath,
    configFilepath,
    requestHandler,
  });
}

function getIniSectionNames(filePath) {
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    const sectionNames = new Set();

    for (const line of contents.split(/\r?\n/)) {
      const trimmedLine = line.split(/(^|\s)[;#]/)[0].trim();
      if (trimmedLine[0] === '[' && trimmedLine[trimmedLine.length - 1] === ']') {
        sectionNames.add(trimmedLine.slice(1, -1));
      }
    }

    return sectionNames;
  } catch (error) {
    if (error && error.code === 'ENOENT') return new Set();
    throw error;
  }
}

function isDefaultConfigProfileSection(sectionName) {
  return isConfigProfileSection(sectionName, 'default');
}

function isConfigProfileSection(sectionName, profile) {
  if (sectionName === profile) return true;
  if (!sectionName.startsWith('profile')) return false;
  const rest = sectionName.slice('profile'.length);
  if (!/^\s/.test(rest)) return false;
  const name = rest.trim();
  return name === profile || name === `"${profile}"` || name === `'${profile}'`;
}

function doesProfileExist(profile) {
  if (getIniSectionNames(getSharedCredentialsFilepath()).has(profile)) return true;

  for (const sectionName of getIniSectionNames(getSharedConfigFilepath())) {
    if (isConfigProfileSection(sectionName, profile)) return true;
  }

  return false;
}

function doesIniSectionHaveKey(filePath, sectionMatcher, keyName) {
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    let inSection = false;

    for (const line of contents.split(/\r?\n/)) {
      const trimmedLine = line.split(/(^|\s)[;#]/)[0].trim();
      if (trimmedLine[0] === '[' && trimmedLine[trimmedLine.length - 1] === ']') {
        inSection = sectionMatcher(trimmedLine.slice(1, -1));
      } else if (inSection) {
        const equalsIndex = trimmedLine.indexOf('=');
        if (equalsIndex !== -1 && trimmedLine.slice(0, equalsIndex).trim() === keyName) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

const warnedDivergenceProfiles = new Set();

function maybeWarnIdentityDivergence(profile) {
  if (warnedDivergenceProfiles.has(profile)) return;
  warnedDivergenceProfiles.add(profile);

  const hasStaticKeys = doesIniSectionHaveKey(
    getSharedCredentialsFilepath(),
    (sectionName) => sectionName === profile,
    'aws_access_key_id'
  );
  if (!hasStaticKeys) return;

  const hasConfigRoleArn = doesIniSectionHaveKey(
    getSharedConfigFilepath(),
    (sectionName) => isConfigProfileSection(sectionName, profile),
    'role_arn'
  );
  if (!hasConfigRoleArn) return;

  log.warning(
    `Profile "${profile}" resolves via the role_arn configured in the AWS config file; ` +
      'the static keys in the credentials file are used only as source credentials for ' +
      'the AssumeRole call, so commands run under the assumed role identity.'
  );
}

function doesImplicitDefaultProfileExist() {
  const credentialsProfiles = getIniSectionNames(getSharedCredentialsFilepath());
  if (credentialsProfiles.has('default')) return true;

  const configSectionNames = getIniSectionNames(getSharedConfigFilepath());
  for (const sectionName of configSectionNames) {
    if (isDefaultConfigProfileSection(sectionName)) return true;
  }

  return false;
}

function fromImplicitDefaultProfileWithFallback() {
  const profileProvider = fromProfile('default');
  let fallbackProvider;

  return async (providerOptions) => {
    try {
      return await profileProvider(providerOptions);
    } catch (error) {
      if (doesImplicitDefaultProfileExist()) throw error;
      if (!fallbackProvider) {
        fallbackProvider = fromNodeProviderChain({
          clientConfig: { requestHandler: getCredentialsRequestHandler() },
        });
      }
      return fallbackProvider(providerOptions);
    }
  };
}

function getAwsSdkV3CredentialsProviderCacheKey({ provider, profile } = {}) {
  const stage = provider && provider.getStage ? provider.getStage() : null;
  const stageUpper = stage ? stage.toUpperCase() : null;
  const providerProfile =
    provider && provider.serverless && provider.serverless.service.provider.profile;
  const cliProfile = provider && provider.options && provider.options['aws-profile'];

  return JSON.stringify({
    profile: profile || null,
    stage: stage || null,
    cliProfile: cliProfile || null,
    providerProfile: providerProfile || null,
    awsProfile: process.env.AWS_PROFILE || null,
    awsDefaultProfile: process.env.AWS_DEFAULT_PROFILE || null,
    stageProfile: stageUpper ? process.env[`AWS_${stageUpper}_PROFILE`] || null : null,
    hasStageEnvironmentCredentials: stageUpper
      ? hasEnvironmentCredentials(`AWS_${stageUpper}`)
      : false,
    hasEnvironmentCredentials: hasEnvironmentCredentials('AWS'),
    sharedCredentialsFile: process.env.AWS_SHARED_CREDENTIALS_FILE || null,
    sharedConfigFile: process.env.AWS_CONFIG_FILE || null,
  });
}

function getAwsSdkV3CredentialsProvider({ provider, profile } = {}) {
  const stage = provider && provider.getStage ? provider.getStage() : null;
  const stageUpper = stage ? stage.toUpperCase() : null;
  const providerProfile =
    provider && provider.serverless && provider.serverless.service.provider.profile;
  const cliProfile = provider && provider.options && provider.options['aws-profile'];

  if (cliProfile) return fromProfile(cliProfile);
  if (profile) return fromProfile(profile);
  if (stageUpper && process.env[`AWS_${stageUpper}_PROFILE`]) {
    return fromProfile(process.env[`AWS_${stageUpper}_PROFILE`]);
  }
  if (stageUpper && hasEnvironmentCredentials(`AWS_${stageUpper}`)) {
    return fromPrefixedEnv(`AWS_${stageUpper}`);
  }
  if (process.env.AWS_PROFILE) return fromProfile(process.env.AWS_PROFILE);
  if (hasEnvironmentCredentials('AWS')) return fromPrefixedEnv('AWS');
  if (providerProfile) return fromProfile(providerProfile);
  if (process.env.AWS_DEFAULT_PROFILE) {
    if (doesProfileExist(process.env.AWS_DEFAULT_PROFILE)) {
      return fromProfile(process.env.AWS_DEFAULT_PROFILE);
    }
    log.warning(
      `Profile "${process.env.AWS_DEFAULT_PROFILE}" (from AWS_DEFAULT_PROFILE) was not found ` +
        'in the AWS credentials or config files; falling back to the default provider chain.'
    );
    return fromNodeProviderChain({
      clientConfig: { requestHandler: getCredentialsRequestHandler() },
    });
  }

  return fromImplicitDefaultProfileWithFallback();
}

module.exports = {
  doesImplicitDefaultProfileExist,
  fromPrefixedEnv,
  getAwsSdkV3CredentialsProviderCacheKey,
  getAwsSdkV3CredentialsProvider,
  hasEnvironmentCredentials,
};
