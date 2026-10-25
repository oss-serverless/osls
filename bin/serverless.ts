#!/usr/bin/env node
// Only the Node.js version check is imported statically, everything else is imported after
// the check passes, so unsupported Node.js versions get a readable error
import isSupportedNodeVersion from '../lib/cli/is-supported-node-version.ts';
import { packageJson } from '../lib/utils/package-root.ts';

// `EvalError` is used to not pollute global namespace but still have the value accessible globally
// Can already be set, if we're in context of local fallback
if (!EvalError.$serverlessCommandStartTime)
  EvalError.$serverlessCommandStartTime = process.hrtime();

if (!isSupportedNodeVersion(process.version)) {
  process.stderr.write(
    `Error: osls v${packageJson.version} does not support ` +
      `Node.js ${process.version}. Please use a supported release. ` +
      `Supported versions: ${isSupportedNodeVersion.supportedRange}.\n`
  );
  process.exit(1);
}

const crashAsync = (error) => {
  process.nextTick(() => {
    throw error;
  });
};

const { default: triage } = await import('../lib/cli/triage.ts');

triage()
  .then(async (cliName) => {
    switch (cliName) {
      case 'serverless':
        return import('../scripts/serverless.ts');
      case '@osls/compose':
        return (await import('../lib/cli/run-compose.ts')).default();
      default:
        throw new Error(`Unrecognized CLI name "${cliName}"`);
    }
  })
  .catch(crashAsync);
