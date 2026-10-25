#!/usr/bin/env node
import isSupportedNodeVersion from '../lib/cli/is-supported-node-version.ts';
import packageModule from '../package.json' with { type: 'json' };
import isStandaloneExecutable from '../lib/utils/is-standalone-executable.ts';
import standalonePatch from '../lib/utils/standalone-patch.ts';
import triage from '../lib/cli/triage.ts';
import serverless from '../scripts/serverless.ts';
import runCompose from '../lib/cli/run-compose.ts';

// `EvalError` is used to not pollute global namespace but still have the value accessible globally
// Can already be set, if we're in context of local fallback
const isMainModule = !EvalError.$serverlessCommandStartTime;
if (isMainModule) EvalError.$serverlessCommandStartTime = process.hrtime();

if (!isSupportedNodeVersion(process.version)) {
  const serverlessVersion = packageModule.version;
  process.stderr.write(
    `Error: osls v${serverlessVersion} does not support ` +
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

if (isMainModule) {
  if (isStandaloneExecutable) {
    standalonePatch;
  }
}

triage()
  .then((cliName) => {
    switch (cliName) {
      case 'serverless':
        return serverless;
      case '@osls/compose':
        return runCompose();
      default:
        throw new Error(`Unrecognized CLI name "${cliName}"`);
    }
  })
  .catch(crashAsync);
