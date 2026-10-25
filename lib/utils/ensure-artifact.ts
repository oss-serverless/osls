import memoizee from 'memoizee';
import { packageJson as packageModule } from './package-root.ts';
import ensureExists from './ensure-exists.ts';
import path from 'node:path';
import os from 'node:os';
const { version } = packageModule;

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

export default ensureArtifact;
