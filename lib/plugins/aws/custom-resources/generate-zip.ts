import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import getTmpDirPath from '../../../utils/fs/get-tmp-dir-path.ts';
import createZipFile from '../../../utils/fs/create-zip-file.ts';
import ensureArtifact from '../../../utils/ensure-artifact.ts';
import safeMoveFile from '../../../utils/fs/safe-move-file.ts';
import copy from '../../../utils/fs/copy.ts';

const srcDirPath = path.join(import.meta.dirname, 'resources');

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

export default async () => {
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
