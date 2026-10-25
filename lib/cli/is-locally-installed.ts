import resolveLocalServerlessPath from './local-serverless-path.ts';
import { packageRoot } from '../utils/package-root.ts';

export default ({ cwd = process.cwd() } = {}) =>
  resolveLocalServerlessPath({ cwd }) === packageRoot;
