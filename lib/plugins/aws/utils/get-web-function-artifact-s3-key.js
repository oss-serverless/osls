'use strict';

const getHashForFilePath = require('../../../utils/get-hash-for-file-path');

/**
 * @param artifactFilePath {string}
 * @param webFunctionName {string}
 * @param naming
 * @returns {Promise<string>}
 */
module.exports = async (artifactFilePath, webFunctionName, naming) => {
  // The key follows the content, so that an unchanged zip keeps its key and with it the revision
  const artifactHash = Buffer.from(await getHashForFilePath(artifactFilePath), 'base64').toString(
    'hex'
  );
  return `${naming.getWebFunctionArtifactS3KeyDirname()}/${webFunctionName}-${artifactHash}.zip`;
};
