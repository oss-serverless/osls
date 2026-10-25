import { packageJson as packageModule, packageRoot } from '../utils/package-root.ts';
import resolveLocalServerlessPath from './local-serverless-path.ts';
import { writeText } from '../utils/serverless-utils/log.ts';
const { version } = packageModule;

const serverlessPath = packageRoot;

export default async () => {
  const localServerlessPath = resolveLocalServerlessPath();
  const installationModePostfix = (() => {
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
