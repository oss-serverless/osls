'use strict';

const { join } = require('path');
const { constants, promises: fsp } = require('fs');
const os = require('os');
const ServerlessError = require('../../../serverless-error');

const homedir = os.homedir();
const awsConfigDirPath = join(homedir, '.aws');
const credentialsFilePath = homedir ? join(awsConfigDirPath, 'credentials') : null;

const isWindows = process.platform === 'win32';
const profileNameRe = /^\[([^\]]+)]\s*$/;
const settingRe = /^([a-zA-Z0-9_]+)\s*=\s*([^\s]+)\s*$/;
const settingMap = new Map([
  ['aws_access_key_id', 'accessKeyId'],
  ['aws_secret_access_key', 'secretAccessKey'],
  ['aws_session_token', 'sessionToken'],
]);
const parseFileProfiles = (content) => {
  const profiles = new Map();
  let currentProfile;
  for (const line of content.split(/[\n\r]+/)) {
    const profileNameMatches = line.match(profileNameRe);
    if (profileNameMatches) {
      currentProfile = {};
      profiles.set(profileNameMatches[1], currentProfile);
      continue;
    }
    if (!currentProfile) continue;
    const settingMatches = line.match(settingRe);
    if (!settingMatches) continue;
    let [, settingAwsName] = settingMatches;
    settingAwsName = settingAwsName.toLowerCase();
    const settingName = settingMap.get(settingAwsName);
    if (settingName) currentProfile[settingName] = settingMatches[2];
  }
  for (const [profileName, profileData] of profiles) {
    if (!profileData.sessionToken && (!profileData.accessKeyId || !profileData.secretAccessKey)) {
      profiles.delete(profileName);
    }
  }
  return profiles;
};

const writeCredentialsContent = async (content) => {
  try {
    await fsp.writeFile(
      credentialsFilePath,
      content,
      !isWindows ? { mode: constants.S_IRUSR | constants.S_IWUSR } : null
    );
  } catch (writeFileError) {
    if (writeFileError.code !== 'ENOENT') throw writeFileError;
    await fsp.mkdir(awsConfigDirPath, !isWindows ? { mode: constants.S_IRWXU } : null);
    await writeCredentialsContent(content);
  }
};

module.exports = {
  async resolveFileProfiles() {
    if (!credentialsFilePath) return new Map();
    try {
      return parseFileProfiles(await fsp.readFile(credentialsFilePath, { encoding: 'utf8' }));
    } catch (error) {
      if (error.code === 'ENOENT') return new Map();
      throw error;
    }
  },

  resolveEnvCredentials() {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return null;
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  },

  async saveFileProfiles(profiles) {
    if (!credentialsFilePath) {
      throw new ServerlessError(
        'Could not resolve path to user credentials file',
        'UNKNOWN_AWS_CREDENTIALS_PATH'
      );
    }
    return writeCredentialsContent(
      `${Array.from(profiles)
        .map(([name, data]) => {
          const lineTokens = [`[${name}]`];
          if (data.sessionToken) lineTokens.push(`aws_session_token=${data.sessionToken}`);
          else {
            lineTokens.push(
              `aws_access_key_id=${data.accessKeyId}`,
              `aws_secret_access_key=${data.secretAccessKey}`
            );
          }
          return `${lineTokens.join('\n')}\n`;
        })
        .join('\n')}`
    );
  },
};
