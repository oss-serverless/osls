'use strict';

const ensureString = require('type/string/ensure');
const memoizee = require('memoizee');
const logLevels = require('log/levels');
const { getterDescriptor } = require('../property-descriptors');
const globalState = require('./lib/global-state');
const getOutputReporter = require('./lib/log/get-output-reporter');
const getProgressReporter = require('./lib/log/get-progress-reporter');

const log = (() => {
  if (!globalState.log) globalState.log = require('log').get('serverless').notice;
  return globalState.log;
})();

module.exports.log = log;

if (!log.verbose) {
  // Initialize log instance (we do not share one setup over `globalState`)

  // Notice level message common message decorators
  Object.defineProperties(log, {
    success: getterDescriptor(function () {
      return this.notice;
    }),
    skip: getterDescriptor(function () {
      return this.notice;
    }),
  });

  Object.defineProperties(log, {
    verbose: getterDescriptor(function () {
      return this.info;
    }),
  });
}

const defaultLogLevelIndex = logLevels.indexOf('notice');
Object.defineProperties(module.exports, {
  logLevelIndex: getterDescriptor(() => {
    return globalState.logLevelIndex == null ? defaultLogLevelIndex : globalState.logLevelIndex;
  }),
  isVerboseMode: getterDescriptor(() => module.exports.logLevelIndex > defaultLogLevelIndex),
  isInteractive: getterDescriptor(() => {
    return globalState.logIsInteractive == null ? false : globalState.logIsInteractive;
  }),
});

module.exports.writeText = getOutputReporter('serverless').get('text');

module.exports.progress = getProgressReporter('serverless');
// Method intended to clear and close indefinitely any progress writing
// Overridden with intended logic in reporter
module.exports.progress.clear = () => {};

module.exports.getPluginWriters = memoizee(
  (pluginName) => {
    pluginName = ensureString(pluginName, { name: 'pluginName' });
    // "log" namespace can contain only [a-z0-9-] chars, therefore we normalize plugin name to
    // avoid exceptions
    const pluginLog = log.get('plugin').get(pluginName.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
    pluginLog.pluginName = pluginName;
    return {
      log: pluginLog.notice,
      writeText: getOutputReporter(`serverless:plugin:${pluginName}`).get('text'),
      progress: getProgressReporter(`serverless:plugin:${pluginName}`),
    };
  },
  { primitive: true }
);

const style = {
  aside: (text, ...textTokens) => [text, ...textTokens],
  error: (text, ...textTokens) => [text, ...textTokens],
  link: (text, ...textTokens) => [text, ...textTokens],
  linkStrong: (text, ...textTokens) => [text, ...textTokens],
  noticeSymbol: (text, ...textTokens) => [text, ...textTokens],
  strong: (text, ...textTokens) => [text, ...textTokens],
  title: (text, ...textTokens) => [text, ...textTokens],
  warning: (text, ...textTokens) => [text, ...textTokens],
};

if (globalState.logStyle) {
  module.exports.style = globalState.logStyle;
  for (const key of Object.keys(style)) {
    if (!globalState.logStyle[key]) globalState.logStyle[key] = style[key];
  }
} else {
  module.exports.style = globalState.logStyle = style;
}
