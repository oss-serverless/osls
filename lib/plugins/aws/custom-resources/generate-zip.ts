import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import getTmpDirPath from '../../../utils/fs/get-tmp-dir-path.ts';
import createZipFile from '../../../utils/fs/create-zip-file.ts';
import ensureArtifact from '../../../utils/ensure-artifact.ts';
import safeMoveFile from '../../../utils/fs/safe-move-file.ts';

const srcDirPath = path.join(import.meta.dirname, 'resources');

const artifactName = 'custom-resources.zip';

// Relative `.ts` import specifiers of the TypeScript sources, rewritten to `.js` once stripped
const relativeTypeScriptSpecifier = /((?:from|import)\s*\(?\s*['"]\.{1,2}\/[^'"]+)\.ts(['"])/g;

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

// The resource handlers run on AWS Lambda as ES modules, which runs JavaScript only. In `dist/`
// they are compiled already; when running from the TypeScript sources their types are stripped
const writeLambdaSources = async (targetDirPath) => {
  for (const filePath of listFilesSorted(srcDirPath)) {
    let relativePath = path.relative(srcDirPath, filePath);
    if (relativePath.endsWith('.d.ts') || relativePath.endsWith('.map')) continue;
    let content = await fs.promises.readFile(filePath);
    if (relativePath.endsWith('.ts')) {
      content = Buffer.from(
        stripTypeScriptTypes(content.toString('utf8')).replace(
          relativeTypeScriptSpecifier,
          '$1.js$2'
        )
      );
      relativePath = `${relativePath.slice(0, -'.ts'.length)}.js`;
    }
    const targetPath = path.join(targetDirPath, relativePath);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, content);
  }
  await fs.promises.writeFile(
    path.join(targetDirPath, 'package.json'),
    `${JSON.stringify({ type: 'module' })}\n`
  );
};

export default async () => {
  const resultPath = await ensureArtifact(
    artifactName,
    async (cachePath) => {
      const tmpDirPath = getTmpDirPath();
      const tmpInstalledLambdaPath = path.resolve(tmpDirPath, 'resource-lambda');
      const tmpZipFilePath = path.resolve(tmpDirPath, 'resource-lambda.zip');
      const cachedZipFilePath = path.resolve(cachePath, artifactName);
      await writeLambdaSources(tmpInstalledLambdaPath);
      await createZipFile(tmpInstalledLambdaPath, tmpZipFilePath);
      await safeMoveFile(tmpZipFilePath, cachedZipFilePath);
    },
    { artifactVersion: `custom-resources-${resolveSourcesHash()}` }
  );
  return path.resolve(resultPath, artifactName);
};
