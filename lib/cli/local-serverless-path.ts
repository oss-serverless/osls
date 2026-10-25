// This module should stay dependency-free because it's used at local fallback triage.

import path from 'node:path';

import { createRequire } from 'node:module';

export default ({ cwd = process.cwd() } = {}) => {
  try {
    return path.resolve(
      path.dirname(createRequire(path.resolve(cwd, 'require-resolver')).resolve('serverless')),
      '..'
    );
  } catch {
    return null;
  }
};
