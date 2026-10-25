'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const URL = require('url');
const download = require('./serverless-utils/download');
const buildFetchDispatcher = require('./build-fetch-dispatcher');
const qs = require('querystring');
const spawn = require('./spawn');
const untildify = require('./untildify');
const renameService = require('./rename-service').renameService;
const ServerlessError = require('../serverless-error');
const copyDirContentsSync = require('./fs/copy-dir-contents-sync');
const dirExistsSync = require('./fs/dir-exists-sync');
const { removeSync } = require('./fs/remove');

/**
 * Returns directory path
 * @param {Number} length
 * @param {Array} parts
 * @returns {String} directory path
 */
function getPathDirectory(length, parts, validationContext) {
  if (!parts) {
    return '';
  }
  const directoryParts = parts.slice(length);
  if (!directoryParts.length) return '';
  for (const part of directoryParts) validatePathSegment(part, validationContext);
  return directoryParts.join(path.sep);
}

const invalidTemplateUrl = (service, hostname) =>
  new ServerlessError(
    `The URL must be a valid ${service} URL in the following format: https://${hostname}/serverless/serverless`,
    'INVALID_TEMPLATE_URL'
  );

const decodeUrlComponent = (component, validationContext) => {
  try {
    return decodeURIComponent(String(component));
  } catch {
    throw invalidTemplateUrl(validationContext.service, validationContext.hostname);
  }
};

const validatePathSegment = (segment, validationContext) => {
  if (segment == null) {
    throw invalidTemplateUrl(validationContext.service, validationContext.hostname);
  }

  const decodedSegment = decodeUrlComponent(segment, validationContext);
  if (
    !decodedSegment ||
    decodedSegment === '.' ||
    decodedSegment === '..' ||
    decodedSegment.includes('\0') ||
    decodedSegment.includes('/') ||
    decodedSegment.includes('\\') ||
    path.isAbsolute(decodedSegment) ||
    /^[a-zA-Z]:/u.test(decodedSegment) ||
    path.basename(decodedSegment) !== decodedSegment
  ) {
    throw invalidTemplateUrl(validationContext.service, validationContext.hostname);
  }

  return segment;
};

const validateRouteMarker = (segment, expectedMarker, validationContext) => {
  const decodedSegment = decodeUrlComponent(
    validatePathSegment(segment, validationContext),
    validationContext
  );
  if (decodedSegment !== expectedMarker) {
    throw invalidTemplateUrl(validationContext.service, validationContext.hostname);
  }
};

const validateRef = (ref, validationContext) => {
  if (ref == null) {
    throw invalidTemplateUrl(validationContext.service, validationContext.hostname);
  }
  const decodedRef = decodeUrlComponent(ref, validationContext);
  if (!decodedRef || decodedRef.includes('\0')) {
    throw invalidTemplateUrl(validationContext.service, validationContext.hostname);
  }
  return ref;
};

const validateRawQuery = (rawQuery, validationContext) => {
  if (!rawQuery) return;
  const decodedQuery = decodeUrlComponent(rawQuery, validationContext);
  if (decodedQuery.includes('\0')) {
    throw invalidTemplateUrl(validationContext.service, validationContext.hostname);
  }
};

/**
 * Validates URL
 * @param {Object} url
 * @param {String} hostname
 * @param {String} service
 * @param {String} owner
 * @param {String} repo
 */
function validateUrl({ url, hostname, service, owner, repo }) {
  // validate if given url is a valid url
  if (url.hostname !== hostname || !owner || !repo) {
    throw invalidTemplateUrl(service, hostname);
  }
}

/**
 * Check if the URL is pointing to a Git repository
 * @param {String} url
 */
function isPlainGitURL(url) {
  return (url.startsWith('https') || url.startsWith('git@')) && url.endsWith('.git');
}

/**
 * @param {Object} url
 * @returns {Object}
 */
function parseGitHubURL(url) {
  const pathLength = 5;
  const validationContext = {
    service: url.hostname === 'github.com' ? 'GitHub' : 'GitHub Enterprise',
    hostname: url.hostname === 'github.com' ? 'github.com' : url.hostname,
  };
  const parts = url.pathname.replace(/\/$/u, '').split('/');
  const hasTreeRoute = parts.length > 3;
  const isSubdirectory = parts.length > pathLength;
  const owner = validatePathSegment(parts[1], validationContext);
  const repo = validatePathSegment(parts[2], validationContext);
  if (hasTreeRoute) validateRouteMarker(parts[3], 'tree', validationContext);
  const branch = hasTreeRoute ? validateRef(parts[4], validationContext) : 'master';
  const isGitHubEnterprise = url.hostname !== 'github.com';

  if (!isGitHubEnterprise) {
    // validate if given url is a valid GitHub url
    validateUrl({ url, hostname: 'github.com', service: 'GitHub', owner, repo });
  }

  const downloadUrl = `https://${
    isGitHubEnterprise ? url.hostname : 'github.com'
  }/${owner}/${repo}/archive/${branch}.zip`;

  return {
    owner,
    repo,
    branch,
    downloadUrl,
    isSubdirectory,
    pathToDirectory: getPathDirectory(pathLength, parts, validationContext),
    username: url.username || '',
    password: url.password || '',
  };
}

/**
 * @param {Object} url
 * @returns {Object}
 */
function parseBitbucketURL(url) {
  const pathLength = 5;
  const validationContext = { service: 'Bitbucket', hostname: 'bitbucket.org' };
  const parts = url.pathname.replace(/\/$/u, '').split('/');
  const hasSrcRoute = parts.length > 3;
  const isSubdirectory = parts.length > pathLength;
  const owner = validatePathSegment(parts[1], validationContext);
  const repo = validatePathSegment(parts[2], validationContext);
  if (hasSrcRoute) {
    validateRouteMarker(parts[3], 'src', validationContext);
    validateRef(parts[4], validationContext);
  }

  validateRawQuery(url.query, validationContext);
  const query = qs.parse(url.query);
  const branch = 'at' in query ? validateRef(query.at, validationContext) : 'master';

  // validate if given url is a valid Bitbucket url
  validateUrl({ url, hostname: 'bitbucket.org', service: 'Bitbucket', owner, repo });

  const downloadUrl = `https://bitbucket.org/${owner}/${repo}/get/${branch}.zip`;

  return {
    owner,
    repo,
    branch,
    downloadUrl,
    isSubdirectory,
    pathToDirectory: getPathDirectory(pathLength, parts, validationContext),
    username: url.username || '',
    password: url.password || '',
  };
}

function parseBitbucketServerURL(url) {
  const pathLength = 9;
  const validationContext = { service: 'Bitbucket Server', hostname: url.hostname };
  const parts = url.pathname.replace(/\/$/u, '').split('/');
  const isSubdirectory = parts.length > pathLength;
  ['rest', 'api', 'latest', 'projects', 'repos', 'archive'].forEach((marker, index) => {
    validateRouteMarker(parts[[1, 2, 3, 4, 6, 8][index]], marker, validationContext);
  });
  const owner = validatePathSegment(parts[5], validationContext);
  const repo = validatePathSegment(parts[7], validationContext);

  validateRawQuery(url.query, validationContext);
  const query = qs.parse(url.query);
  const branch = 'at' in query ? validateRef(query.at, validationContext) : 'master';

  const querySuffix = url.search ? `${url.search}&format=zip` : '?format=zip';
  const downloadUrl = `${url.protocol}//${url.hostname}/rest/api/latest/projects/${owner}/repos/${repo}/archive${querySuffix}`;

  return {
    owner,
    repo,
    branch,
    downloadUrl,
    isSubdirectory,
    pathToDirectory: getPathDirectory(pathLength + 1, parts, validationContext),
    username: url.username || '',
    password: url.password || '',
  };
}

/**
 * Call `/rest/api/1.0/application-properties` to retrieve server info
 * @param {Object} url
 * @returns {Boolean}
 */
async function retrieveBitbucketServerInfo(url) {
  const versionInfoPath = `${url.protocol}//${url.hostname}/rest/api/1.0/application-properties`;

  return fetch(versionInfoPath, {
    dispatcher: buildFetchDispatcher(),
    signal: AbortSignal.timeout(30000),
  })
    .then((resp) => resp.json())
    .then((body) => body.displayName === 'Bitbucket');
}

/**
 * @param {Object} url
 * @returns {Object}
 */
function parseGitlabURL(url) {
  const pathLength = 5;
  const validationContext = { service: 'GitLab', hostname: 'gitlab.com' };
  const parts = url.pathname.replace(/\/$/u, '').split('/');
  const hasTreeRoute = parts.length > 3;
  const isSubdirectory = parts.length > pathLength;
  const owner = validatePathSegment(parts[1], validationContext);
  const repo = validatePathSegment(parts[2], validationContext);

  if (hasTreeRoute) validateRouteMarker(parts[3], 'tree', validationContext);
  const branch = hasTreeRoute ? validateRef(parts[4], validationContext) : 'master';

  // validate if given url is a valid GitLab url
  validateUrl({ url, hostname: 'gitlab.com', service: 'GitLab', owner, repo });

  const downloadUrl = `https://gitlab.com/${owner}/${repo}/-/archive/${branch}/${repo}-${branch}.zip`;

  return {
    owner,
    repo,
    branch,
    downloadUrl,
    isSubdirectory,
    pathToDirectory: getPathDirectory(pathLength, parts, validationContext),
    username: url.username || '',
    password: url.password || '',
  };
}

/**
 * Parses a URL which points to a plain Git repository
 * such as https://example.com/jdoe/project.git
 *
 * @param {String} url
 * @returns {Object}
 */
function parsePlainGitURL(url) {
  const validationContext = { service: 'Git', hostname: 'git-host' };
  const branch = 'master';
  const downloadUrl = url;
  const isSubdirectory = false;
  const repo = validatePathSegment(url.match(/.+\/(.+)\.git/)[1], validationContext);
  return {
    repo,
    branch,
    downloadUrl,
    isSubdirectory,
    username: url.username || '',
    password: url.password || '',
  };
}

/**
 * Parse URL and call the appropriate adaptor
 *
 * @param {string} inputUrl
 * @throws {ServerlessError}
 * @returns {Promise}
 */
async function parseRepoURL(inputUrl) {
  return new Promise((resolve, reject) => {
    if (!inputUrl) {
      return reject(new ServerlessError('URL is required', 'MISSING_TEMPLATE_URL'));
    }

    const url = URL.parse(inputUrl.replace(/\/$/, ''));
    if (url.auth) {
      const [username, password] = url.auth.split(':');
      url.username = username;
      url.password = password;
    }

    // check if url parameter is a valid url
    if (!url.host && !url.href.startsWith('git@')) {
      return reject(new ServerlessError('The URL you passed is not valid', 'INVALID_TEMPLATE_URL'));
    }

    if (isPlainGitURL(url.href)) {
      return resolve(parsePlainGitURL(inputUrl));
    } else if (url.hostname === 'github.com' || url.hostname.indexOf('github.') !== -1) {
      return resolve(parseGitHubURL(url));
    } else if (url.hostname === 'bitbucket.org') {
      return resolve(parseBitbucketURL(url));
    } else if (url.hostname === 'gitlab.com') {
      return resolve(parseGitlabURL(url));
    }

    const msg =
      'The URL you passed is not one of the valid providers: "GitHub", "GitHub Enterprise", "Bitbucket", "Bitbucket Server" or "GitLab".';
    const err = new ServerlessError(msg, 'INVALID_TEMPLATE_PROVIDER');
    // test if it's a private bitbucket server
    return retrieveBitbucketServerInfo(url)
      .then((isBitbucket) => {
        if (!isBitbucket) {
          return reject(err);
        }

        // build download URL
        return resolve(parseBitbucketServerURL(url));
      })
      .catch((error) => reject(error instanceof ServerlessError ? error : err));
  });
}

/**
 * @param {string} inputUrl
 * @param {string} [requestedServiceName]
 * @param {string} [downloadPath]
 * @returns {Promise}
 */
async function downloadTemplateFromRepo(inputUrl, requestedServiceName, downloadPath) {
  const repoInformation = await parseRepoURL(inputUrl);
  let sourceName;
  let downloadServicePath;
  const { username, password } = repoInformation;
  const authRedirectHostnames = repoInformation.downloadUrl.startsWith('https://github.com/')
    ? ['codeload.github.com']
    : [];

  if (repoInformation.isSubdirectory) {
    const folderName = repoInformation.pathToDirectory.split(path.sep).splice(-1)[0];
    sourceName = folderName;
  } else {
    sourceName = repoInformation.repo;
  }

  const targetDirectoryName = requestedServiceName || sourceName;
  const targetDirectoryPath = downloadPath
    ? path.resolve(process.cwd(), untildify(downloadPath))
    : path.join(process.cwd(), targetDirectoryName);
  const targetDirectoryDisplayPath = downloadPath || `./${targetDirectoryName}`;
  const effectiveServiceName =
    requestedServiceName || (downloadPath ? path.basename(targetDirectoryPath) : sourceName);
  const shouldRenameService = Boolean(
    requestedServiceName || downloadPath || repoInformation.isSubdirectory
  );

  if (dirExistsSync(targetDirectoryPath)) {
    const errorMessage = `A folder named "${targetDirectoryDisplayPath}" already exists.`;
    throw new ServerlessError(errorMessage, 'TARGET_FOLDER_ALREADY_EXISTS');
  }

  fs.mkdirSync(path.dirname(targetDirectoryPath), { recursive: true });

  if (repoInformation.isSubdirectory) {
    downloadServicePath = fs.mkdtempSync(path.join(os.tmpdir(), 'serverless-template-'));
  } else {
    downloadServicePath = targetDirectoryPath;
  }

  if (isPlainGitURL(inputUrl)) {
    await spawn('git', ['clone', '--', inputUrl, downloadServicePath]);
    if (shouldRenameService) renameService(effectiveServiceName, targetDirectoryPath);
    return sourceName;
  }

  const downloadOptions = {
    timeout: 30000,
    extract: true,
    strip: 1,
    username,
    password,
    allowedAuthRedirectHostnames: authRedirectHostnames,
  };

  try {
    // download service
    await download(repoInformation.downloadUrl, downloadServicePath, downloadOptions);
    // if it's a directory inside of git
    if (repoInformation.isSubdirectory) {
      const directory = path.join(downloadServicePath, repoInformation.pathToDirectory);
      copyDirContentsSync(directory, targetDirectoryPath);
    }
    if (shouldRenameService) renameService(effectiveServiceName, targetDirectoryPath);
    return sourceName;
  } finally {
    if (repoInformation.isSubdirectory) {
      try {
        removeSync(downloadServicePath);
      } catch {
        // Ignore cleanup failures so they do not mask the primary error.
      }
    }
  }
}

module.exports = {
  downloadTemplateFromRepo,
  parseRepoURL,
};
