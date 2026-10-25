'use strict';

const memoizee = require('memoizee');
const { version } = require('../../package');
const ensureExists = require('./ensure-exists');
const path = require('path');
const os = require('os');

const ensureArtifactInCache = memoizee(
  async (filename, cachePath, generate) => {
    await ensureExists(path.resolve(cachePath, filename), generate);
    return cachePath;
  },
  { length: 2, promise: true, primitive: true }
);

const ensureArtifact = (
  filename,
  generate,
  { homeDir = os.homedir(), artifactVersion = version } = {}
) => {
  const cachePath = path.resolve(homeDir, '.serverless/artifacts', artifactVersion);

  return ensureArtifactInCache(filename, cachePath, generate);
};

ensureArtifact.clear = ensureArtifactInCache.clear;
ensureArtifact.delete = (filename, options = {}) => {
  const homeDir = options.homeDir || os.homedir();
  const artifactVersion = options.artifactVersion || version;
  const cachePath = path.resolve(homeDir, '.serverless/artifacts', artifactVersion);

  return ensureArtifactInCache.delete(filename, cachePath);
};

module.exports = ensureArtifact;
