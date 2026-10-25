import globalState from '../lib/global-state.ts';
import logReporter from '../lib/log-reporters/node/log-reporter.ts';
import getOutputReporter from '../lib/log/get-output-reporter.ts';
import joinTextTokens from '../lib/log/join-text-tokens.ts';
import logLevels from 'log/levels.json' with { type: 'json' };

// Apply style decorators
import '../lib/log-reporters/node/style.ts';

import isInteractive2 from '../../is-interactive.ts';
import progressReporter from '../lib/log-reporters/node/progress-reporter.ts';

if (globalState.logLevelIndex != null) {
  // An edge case, of log reporter being setup second time for Node.js process
  // The only known scenario is `sls --version` being run with global v2 `serverless`
  // installation, which falls back to locally installed v2 `serverless` installation
  return;
}

if (process.env.SLS_LOG_LEVEL !== 'debug' && process.argv.includes('--verbose')) {
  process.env.SLS_LOG_LEVEL = 'info';
}

process.argv.some((flag, index) => {
  const namespace = (() => {
    if (flag === '--debug') {
      return process.argv[index + 1];
    }
    if (flag.startsWith('--debug=')) return flag.slice('--debug='.length);
    return null;
  })();
  if (!namespace) {
    return false;
  }
  if (namespace === '*') process.env.SLS_LOG_LEVEL = 'debug';
  else process.env.SLS_LOG_DEBUG = namespace;
  return true;
});

const { emitter: outputEmitter } = getOutputReporter;

const logLevelIndex = logLevels.includes(process.env.SLS_LOG_LEVEL)
  ? logLevels.indexOf(process.env.SLS_LOG_LEVEL)
  : logLevels.indexOf('notice');

const isInteractive = isInteractive2() || process.env.SLS_INTERACTIVE_SETUP_ENABLE;

// Event logs
logReporter({ logLevelIndex, debugNamespaces: process.env.SLS_LOG_DEBUG });
globalState.logLevelIndex = logLevelIndex;

// Substantial output (not subject to filtering)
outputEmitter.on('write', ({ mode, textTokens }) => {
  if (mode === 'text') process.stdout.write(joinTextTokens(textTokens));
});

globalState.logIsInteractive = isInteractive;
if (isInteractive) {
  progressReporter({ logLevelIndex });
}
