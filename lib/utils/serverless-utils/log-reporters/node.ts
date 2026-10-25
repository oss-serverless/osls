import globalState from '../lib/global-state.ts';
import logReporter from '../lib/log-reporters/node/log-reporter.ts';
import { emitter as outputEmitter } from '../lib/log/get-output-reporter.ts';
import joinTextTokens from '../lib/log/join-text-tokens.ts';
import logLevels from 'log/levels.json' with { type: 'json' };

// Apply style decorators
import '../lib/log-reporters/node/style.ts';

import isInteractiveTerminal from '../../is-interactive.ts';
import progressReporter from '../lib/log-reporters/node/progress-reporter.ts';

// Skip an eventual second setup of the log reporter in the same Node.js process
// (eg. `sls --version` run with a global installation that falls back to a local one)
if (globalState.logLevelIndex == null) {
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

  const logLevelIndex = logLevels.includes(process.env.SLS_LOG_LEVEL)
    ? logLevels.indexOf(process.env.SLS_LOG_LEVEL)
    : logLevels.indexOf('notice');

  const isInteractive = isInteractiveTerminal() || process.env.SLS_INTERACTIVE_SETUP_ENABLE;

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
}
