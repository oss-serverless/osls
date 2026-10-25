'use strict';

// This module should stay dependency-free because it's used at local fallback triage.

const path = require('path');
const { createRequire } = require('module');

module.exports = ({ cwd = process.cwd() } = {}) => {
  try {
    return path.resolve(
      path.dirname(createRequire(path.resolve(cwd, 'require-resolver')).resolve('serverless')),
      '..'
    );
  } catch {
    return null;
  }
};
