import semver from 'semver';
import { packageJson } from '../utils/package-root.ts';

const supportedRange = packageJson.engines.node;

const isSupportedNodeVersion = (version: string): boolean => {
  const normalizedVersion = semver.coerce(version);

  return Boolean(normalizedVersion && semver.satisfies(normalizedVersion.version, supportedRange));
};

isSupportedNodeVersion.supportedRange = supportedRange;

export { supportedRange };
export default isSupportedNodeVersion;
