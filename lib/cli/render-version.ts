import path from 'node:path';
import packageModule from '../../package.json' with { type: 'json' };
import isStandaloneExecutable from '../utils/is-standalone-executable.ts';
import resolveLocalServerlessPath from './local-serverless-path.ts';
import log from '../utils/serverless-utils/log.ts';
const { version } = packageModule;
const { writeText } = log;

const serverlessPath = path.resolve(import.meta.dirname, '../..');

export default async () => {
  const localServerlessPath = resolveLocalServerlessPath();
  const installationModePostfix = (() => {
    if (isStandaloneExecutable) return ' (standalone)';
    if (serverlessPath === localServerlessPath) return ' (local)';
    return '';
  })();

  const globalInstallationPostfix = (() => {
    if (EvalError.$serverlessInitInstallationVersion) {
      return ` ${EvalError.$serverlessInitInstallationVersion} (global)`;
    }
    return '';
  })();

  writeText(`osls version: ${version}${installationModePostfix}${globalInstallationPostfix}`);
};
