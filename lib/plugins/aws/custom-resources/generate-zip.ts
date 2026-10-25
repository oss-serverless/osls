'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const getTmpDirPath = require('../../../utils/fs/get-tmp-dir-path');
const createZipFile = require('../../../utils/fs/create-zip-file');
const ensureArtifact = require('../../../utils/ensure-artifact');
const safeMoveFile = require('../../../utils/fs/safe-move-file');
const copy = require('../../../utils/fs/copy');

const srcDirPath = path.join(__dirname, 'resources');

const artifactName = 'custom-resources.zip';

const listFilesSorted = (dir) => {
  const result = [];
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFilesSorted(fullPath));
    else result.push(fullPath);
  }
  return result;
};

const resolveSourcesHash = () => {
  const hash = crypto.createHash('md5');
  for (const filePath of listFilesSorted(srcDirPath)) {
    hash.update(path.relative(srcDirPath, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
};

module.exports = async () => {
  const resultPath = await ensureArtifact(
    artifactName,
    async (cachePath) => {
      const tmpDirPath = getTmpDirPath();
      const tmpInstalledLambdaPath = path.resolve(tmpDirPath, 'resource-lambda');
      const tmpZipFilePath = path.resolve(tmpDirPath, 'resource-lambda.zip');
      const cachedZipFilePath = path.resolve(cachePath, artifactName);
      await copy(srcDirPath, tmpInstalledLambdaPath);
      await createZipFile(tmpInstalledLambdaPath, tmpZipFilePath);
      await safeMoveFile(tmpZipFilePath, cachedZipFilePath);
    },
    { artifactVersion: `custom-resources-${resolveSourcesHash()}` }
  );
  return path.resolve(resultPath, artifactName);
};
