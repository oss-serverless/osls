import path from 'node:path';
import resolveFrom from '../utils/resolve-from.ts';

export default ({ cwd = process.cwd() } = {}) => {
  try {
    return path.resolve(path.dirname(resolveFrom(cwd, 'serverless')), '..');
  } catch {
    return null;
  }
};
