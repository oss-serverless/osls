'use strict';

const fsp = require('fs').promises;
const path = require('path');
const { fileURLToPath } = require('url');
const { denyExternalRef, throwOptionsError } = require('./external-ref-errors');
const { assertKnownOptions, assertOptionsObject } = require('./option-validation');

const DEFAULT_ALLOWED_ROOTS = ['.'];
const FILE_REF_POLICY_HINT =
  'The code calling yamlParser.parse can allow this path by adding a trusted root ' +
  'to externalRefs.file.allowedRoots.';

const realpathIfExists = async (filePath) => {
  try {
    return await fsp.realpath(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }

  const parentPath = path.dirname(filePath);
  if (parentPath === filePath) return filePath;

  return path.join(await realpathIfExists(parentPath), path.basename(filePath));
};

const isPathInside = (rootPath, candidatePath) => {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
};

const normalizeAllowedRoot = async (documentDir, rootPath) => {
  if (typeof rootPath !== 'string') {
    throwOptionsError(
      'YAML parser option externalRefs.file.allowedRoots must contain only strings.'
    );
  }

  let absolutePath;
  try {
    absolutePath = rootPath.toLowerCase().startsWith('file:')
      ? fileURLToPath(rootPath)
      : path.resolve(documentDir, rootPath);
  } catch {
    throwOptionsError(
      `YAML parser option externalRefs.file.allowedRoots contains an invalid file URL: ${rootPath}`
    );
  }

  return {
    path: absolutePath,
    realpath: await realpathIfExists(absolutePath),
  };
};

const normalizeFileRefOptions = async (documentDir, options = {}) => {
  assertOptionsObject(options, 'externalRefs.file');
  assertKnownOptions(options, 'externalRefs.file', ['allowedRoots']);

  let allowedRootValues;

  if (options.allowedRoots !== undefined) {
    if (options.allowedRoots === null) return { allowedRoots: null };
    allowedRootValues = options.allowedRoots;
  } else {
    allowedRootValues = DEFAULT_ALLOWED_ROOTS;
  }

  const allowedRoots = Array.isArray(allowedRootValues) ? allowedRootValues : [allowedRootValues];

  return {
    allowedRoots: await Promise.all(
      allowedRoots.map((allowedRoot) => normalizeAllowedRoot(documentDir, allowedRoot))
    ),
  };
};

const getRefFilePath = (documentUrl) => {
  try {
    const url = new URL(documentUrl);
    if (url.protocol === 'file:') return fileURLToPath(url);
    return null;
  } catch {
    return path.resolve(documentUrl);
  }
};

const isFileRefAllowedByPath = (candidatePath, allowedRoots, rootProperty) =>
  allowedRoots.some((allowedRoot) => isPathInside(allowedRoot[rootProperty], candidatePath));

const denyFileRefOutsideAllowedRoots = (documentUrl) => {
  denyExternalRef(
    `Blocked YAML $ref file outside allowed roots: ${documentUrl}. ${FILE_REF_POLICY_HINT}`
  );
};

const assertFileRefAllowed = async (documentUrl, options) => {
  if (options.allowedRoots == null) return;

  const candidatePath = getRefFilePath(documentUrl);
  if (!candidatePath) {
    denyFileRefOutsideAllowedRoots(documentUrl);
  }

  if (!isFileRefAllowedByPath(candidatePath, options.allowedRoots, 'path')) {
    denyFileRefOutsideAllowedRoots(documentUrl);
  }

  const candidateRealpath = await realpathIfExists(candidatePath);

  if (!isFileRefAllowedByPath(candidateRealpath, options.allowedRoots, 'realpath')) {
    denyFileRefOutsideAllowedRoots(documentUrl);
  }
};

module.exports = {
  assertFileRefAllowed,
  normalizeFileRefOptions,
};
