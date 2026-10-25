'use strict';

const os = require('os');
const ServerlessError = require('../serverless-error');

let homeDirectory;
let currentUser;

const getHomeDirectory = (inputPath) => {
  if (homeDirectory === undefined) {
    try {
      homeDirectory = os.homedir() || null;
    } catch (error) {
      throw new ServerlessError(
        `Cannot expand path "${inputPath}": home directory could not be resolved: ${error.message}`,
        'HOME_DIRECTORY_UNAVAILABLE'
      );
    }
  }

  if (homeDirectory) return homeDirectory;

  throw new ServerlessError(
    `Cannot expand path "${inputPath}": home directory could not be resolved.`,
    'HOME_DIRECTORY_UNAVAILABLE'
  );
};

const getCurrentUser = (inputPath) => {
  if (currentUser === undefined) {
    try {
      const userInfo = os.userInfo();
      currentUser = userInfo && userInfo.username ? userInfo.username : null;
    } catch (error) {
      throw new ServerlessError(
        `Cannot expand path "${inputPath}": current user could not be resolved: ${error.message}`,
        'CURRENT_USER_UNAVAILABLE'
      );
    }
  }

  if (currentUser) return currentUser;

  throw new ServerlessError(
    `Cannot expand path "${inputPath}": current user could not be resolved.`,
    'CURRENT_USER_UNAVAILABLE'
  );
};

module.exports = (pathWithTilde) => {
  if (typeof pathWithTilde !== 'string') {
    throw new TypeError(`Expected a string, got ${typeof pathWithTilde}`);
  }

  if (!pathWithTilde.startsWith('~')) {
    return pathWithTilde;
  }

  if (/^~(?=$|\/|\\)/.test(pathWithTilde)) {
    return `${getHomeDirectory(pathWithTilde)}${pathWithTilde.slice(1)}`;
  }

  const userMatch = pathWithTilde.match(/^~([^/\\]+)(.*)/);
  const username = userMatch[1];
  const rest = userMatch[2];

  if (username !== getCurrentUser(pathWithTilde)) {
    throw new ServerlessError(
      `Cannot expand path "${pathWithTilde}": user-home expansion is only supported for the current user.`,
      'UNSUPPORTED_HOME_DIRECTORY_EXPANSION'
    );
  }

  return `${getHomeDirectory(pathWithTilde)}${rest}`;
};
