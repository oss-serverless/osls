import path from 'node:path';
import resolveLocalServerlessPath from './local-serverless-path.ts';

export default ({ cwd = process.cwd() } = {}) =>
  resolveLocalServerlessPath({ cwd }) === path.resolve(import.meta.dirname, '../../');
