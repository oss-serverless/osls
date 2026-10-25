#!/usr/bin/env node

'use strict';

// `EvalError` is used to not pollute global namespace but still have the value accessible globally
// Can already be set, if we're in context of local fallback
const isMainModule = !EvalError.$serverlessCommandStartTime;
if (isMainModule) EvalError.$serverlessCommandStartTime = process.hrtime();

const isSupportedNodeVersion = require('../lib/cli/is-supported-node-version');

if (!isSupportedNodeVersion(process.version)) {
  const serverlessVersion = require('../package.json').version;
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
  if (require('../lib/utils/is-standalone-executable')) {
    require('../lib/utils/standalone-patch');
  }
}

require('../lib/cli/triage')()
  .then((cliName) => {
    switch (cliName) {
      case 'serverless':
        return require('../scripts/serverless');
      case '@osls/compose':
        return require('../lib/cli/run-compose')();
      default:
        throw new Error(`Unrecognized CLI name "${cliName}"`);
    }
  })
  .catch(crashAsync);
