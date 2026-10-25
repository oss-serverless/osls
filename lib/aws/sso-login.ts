'use strict';

const fs = require('fs');
const path = require('path');
const writeFileAtomic = require('write-file-atomic');
const { getSSOTokenFilepath, loadSsoSessionData, parseKnownFiles } = require('@smithy/core/config');
const {
  CreateTokenCommand,
  RegisterClientCommand,
  SSOOIDCClient,
  StartDeviceAuthorizationCommand,
} = require('@aws-sdk/client-sso-oidc');
const ServerlessError = require('../serverless-error');
const { isAwsCredentialProviderError } = require('./aws-sdk-v3-error');
const isInteractive = require('../utils/is-interactive');
const wait = require('../utils/sleep');
const { writeText } = require('../utils/serverless-utils/log');

const DEFAULT_SSO_REGISTRATION_SCOPES = ['sso:account:access'];
const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const LOGIN_ATTEMPTS = new Map();

function splitScopes(value) {
  if (!value) return DEFAULT_SSO_REGISTRATION_SCOPES;
  const scopes = value.split(/[,\s]+/).filter(Boolean);
  return scopes.length ? scopes : DEFAULT_SSO_REGISTRATION_SCOPES;
}

async function resolveSsoProfileConfig({ profile, filepath, configFilepath }) {
  const profiles = await parseKnownFiles({ filepath, configFilepath, ignoreCache: true });
  const profileConfig = findSsoRoutedProfile(profiles, profile, new Set());
  if (!profileConfig) return null;

  let session = null;
  if (profileConfig.sso_session) {
    const sessions = await loadSsoSessionData({ configFilepath });
    session = sessions[profileConfig.sso_session];
    if (!session) return null;
  }

  const source = session || profileConfig;
  const ssoConfig = {
    accountId: profileConfig.sso_account_id,
    cacheKey: profileConfig.sso_session || profileConfig.sso_start_url,
    profile,
    region: source.sso_region,
    roleName: profileConfig.sso_role_name,
    scopes: splitScopes(source.sso_registration_scopes),
    startUrl: source.sso_start_url,
  };
  if (profileConfig.sso_session) ssoConfig.sessionName = profileConfig.sso_session;

  return isCompleteSsoConfig(ssoConfig) ? ssoConfig : null;
}

// Mirrors fromIni's routing so that a login is only attempted when credential
// resolution actually goes through SSO: role-chaining profiles (role_arn +
// source_profile) are followed to the profile holding the SSO configuration,
// while profiles resolving through static keys, web identity, credential_source
// or credential_process never trigger a login.
function findSsoRoutedProfile(profiles, profileName, visitedProfiles) {
  const profileConfig = profiles[profileName];
  if (!profileConfig || visitedProfiles.has(profileName)) return null;
  visitedProfiles.add(profileName);
  const isSourceProfile = visitedProfiles.size > 1;

  const hasStaticCredentials = Boolean(
    profileConfig.aws_access_key_id && profileConfig.aws_secret_access_key
  );
  // fromIni resolves source profiles carrying static keys directly, before role chaining
  if (isSourceProfile && hasStaticCredentials) return null;

  // fromIni only honors source_profile/credential_source when the other key is absent
  const sourceProfile = profileConfig.credential_source ? undefined : profileConfig.source_profile;
  const credentialSource = profileConfig.source_profile
    ? undefined
    : profileConfig.credential_source;
  if (profileConfig.role_arn && sourceProfile) {
    return findSsoRoutedProfile(profiles, sourceProfile, visitedProfiles);
  }
  // credential_source resolves via IMDS/ECS/environment when combined with
  // role_arn, or on its own when reached as a source profile; only a top-level
  // profile lacking role_arn ignores it and can still fall through to SSO
  if (credentialSource && (profileConfig.role_arn || isSourceProfile)) return null;
  // fromIni only routes to web identity when role_arn accompanies the token file
  const hasWebIdentity = Boolean(profileConfig.web_identity_token_file && profileConfig.role_arn);
  if (hasStaticCredentials || hasWebIdentity || profileConfig.credential_process) return null;

  return profileConfig;
}

function isCompleteSsoConfig(ssoConfig) {
  return Boolean(
    ssoConfig &&
    ssoConfig.accountId &&
    ssoConfig.cacheKey &&
    ssoConfig.region &&
    ssoConfig.roleName &&
    ssoConfig.startUrl
  );
}

function assertInteractiveSsoLoginAllowed(originalError) {
  // stdin is deliberately not required: the device flow only displays a URL
  // and user code, so a piped stdin (git hooks, wrapper scripts) is fine
  if (!isInteractive({ requireStdin: false })) throw createUnavailableError(originalError);
}

function createUnavailableError(originalError) {
  return new ServerlessError(
    'AWS SSO login requires an interactive terminal. Run `aws sso login` for this profile, ' +
      'or re-run this command in an interactive terminal.\n' +
      `Original error: ${originalError.message}`,
    'AWS_SSO_LOGIN_UNAVAILABLE',
    { cause: originalError }
  );
}

async function performSsoDeviceLogin({ ssoConfig, requestHandler, originalError }) {
  assertInteractiveSsoLoginAllowed(originalError);

  const oidcClient = new SSOOIDCClient({
    region: ssoConfig.region,
    requestHandler,
  });
  const registration = await oidcClient.send(
    new RegisterClientCommand({
      clientName: 'osls',
      clientType: 'public',
      scopes: ssoConfig.scopes,
    })
  );
  const authorization = await oidcClient.send(
    new StartDeviceAuthorizationCommand({
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
      startUrl: ssoConfig.startUrl,
    })
  );

  const verificationUri = authorization.verificationUriComplete || authorization.verificationUri;
  // stdout (unfiltered), matching the stream the interactivity gate checks
  writeText(
    'AWS SSO login required.',
    `Open this URL to authorize: ${verificationUri}`,
    `Confirm the user code shown by AWS: ${authorization.userCode}`
  );

  const token = await pollForToken({
    authorization,
    oidcClient,
    registration,
  });
  return writeSsoTokenCache(ssoConfig, registration, token);
}

async function pollForToken({ authorization, oidcClient, registration }) {
  // Guard against a malformed interval of 0 busy-polling
  let intervalSeconds = Math.max(authorization.interval ?? 5, 1);
  const expiresAt = Date.now() + authorization.expiresIn * 1000;

  while (Date.now() < expiresAt) {
    await wait(Math.min(intervalSeconds * 1000, Math.max(expiresAt - Date.now(), 0)));
    try {
      return await oidcClient.send(
        new CreateTokenCommand({
          clientId: registration.clientId,
          clientSecret: registration.clientSecret,
          deviceCode: authorization.deviceCode,
          grantType: DEVICE_CODE_GRANT_TYPE,
        })
      );
    } catch (error) {
      if (error && error.name === 'AuthorizationPendingException') continue;
      if (error && error.name === 'SlowDownException') {
        intervalSeconds += 5;
        continue;
      }
      if (error && error.name === 'AccessDeniedException') {
        throw new ServerlessError('AWS SSO login was denied.', 'AWS_SSO_LOGIN_DENIED', {
          cause: error,
        });
      }
      if (error && error.name === 'ExpiredTokenException') break;
      throw error;
    }
  }

  throw new ServerlessError('AWS SSO device authorization expired.', 'AWS_SSO_LOGIN_EXPIRED');
}

async function writeSsoTokenCache(ssoConfig, registration, token) {
  validateTokenCacheInputs(registration, token);

  const cachePath = getSSOTokenFilepath(ssoConfig.cacheKey);
  await fs.promises.mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });

  const expiresAtMs = Date.now() + token.expiresIn * 1000;
  const cachedToken = {
    startUrl: ssoConfig.startUrl,
    region: ssoConfig.region,
    accessToken: token.accessToken,
    expiresAt: new Date(expiresAtMs).toISOString(),
    clientId: registration.clientId,
    clientSecret: registration.clientSecret,
    registrationExpiresAt: new Date(registration.clientSecretExpiresAt * 1000).toISOString(),
  };
  if (token.refreshToken) cachedToken.refreshToken = token.refreshToken;

  await writeFileAtomic(cachePath, `${JSON.stringify(cachedToken, null, 2)}\n`, {
    mode: 0o600,
  });
  return expiresAtMs;
}

function validateTokenCacheInputs(registration, token) {
  if (
    !registration.clientId ||
    !registration.clientSecret ||
    !registration.clientSecretExpiresAt ||
    !token.accessToken ||
    !token.expiresIn
  ) {
    throw new ServerlessError(
      'AWS SSO returned an incomplete device authorization response.',
      'AWS_SSO_LOGIN_INVALID_RESPONSE'
    );
  }
}

function withInteractiveSsoLogin({ profile, provider, filepath, configFilepath, requestHandler }) {
  return async (providerOptions) => {
    try {
      return await provider(providerOptions);
    } catch (error) {
      // Fixable and unfixable failures cannot be told apart: the SDK wraps
      // all SSO failures in message-only errors, and cached token state is
      // no signal either (a fresh-looking token may be revoked server-side),
      // so any credential error triggers a login — a spurious one is
      // single-flighted and the provider's own error surfaces on the retry.
      // A failure in SSO detection itself must never replace the provider error.
      let ssoConfig;
      try {
        ssoConfig = isAwsCredentialProviderError(error)
          ? await resolveSsoProfileConfig({ profile, filepath, configFilepath })
          : null;
      } catch {
        ssoConfig = null;
      }
      if (!ssoConfig) throw error;

      await runSingleFlightLogin(ssoConfig, () =>
        performSsoDeviceLogin({ ssoConfig, requestHandler, originalError: error })
      );
      return provider(providerOptions);
    }
  };
}

// At most one *successful* login per SSO session per written token lifetime:
// concurrent failures share it, and when credentials still fail after a
// completed login (e.g. the user is not assigned to the role), another login
// cannot fix it — the provider's error surfaces instead of a re-prompt.
// Failed logins are evicted so a later resolution can retry; an expired
// token's entry is replaced so long-lived processes can log in again.
function runSingleFlightLogin(ssoConfig, login) {
  const cachePath = getSSOTokenFilepath(ssoConfig.cacheKey);
  const activeAttempt = LOGIN_ATTEMPTS.get(cachePath);
  const hasExpired =
    activeAttempt != null &&
    activeAttempt.tokenExpiresAt != null &&
    activeAttempt.tokenExpiresAt <= Date.now();
  if (!activeAttempt || hasExpired) {
    const attempt = { tokenExpiresAt: null };
    attempt.promise = login().then(
      (tokenExpiresAt) => {
        attempt.tokenExpiresAt = tokenExpiresAt;
      },
      (error) => {
        LOGIN_ATTEMPTS.delete(cachePath);
        throw error;
      }
    );
    LOGIN_ATTEMPTS.set(cachePath, attempt);
  }
  return LOGIN_ATTEMPTS.get(cachePath).promise;
}

module.exports = {
  resolveSsoProfileConfig,
  withInteractiveSsoLogin,
};
