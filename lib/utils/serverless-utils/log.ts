import ensureString from 'type/string/ensure.js';
import memoizee from 'memoizee';
import logLevels from 'log/levels.json' with { type: 'json' };
import { getterDescriptor } from '../property-descriptors.ts';
import globalState from './lib/global-state.ts';
import getOutputReporter from './lib/log/get-output-reporter.ts';
import getProgressReporter from './lib/log/get-progress-reporter.ts';
import logModule from 'log';

const log = (() => {
  if (!globalState.log) globalState.log = logModule.get('serverless').notice;
  return globalState.log;
})();

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

const writeText = getOutputReporter('serverless').get('text');

const progress = getProgressReporter('serverless');
// Method intended to clear and close indefinitely any progress writing
// Overridden with intended logic in reporter
progress.clear = () => {};

const getPluginWriters = memoizee(
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

const defaultStyle = {
  aside: (text, ...textTokens) => [text, ...textTokens],
  error: (text, ...textTokens) => [text, ...textTokens],
  link: (text, ...textTokens) => [text, ...textTokens],
  linkStrong: (text, ...textTokens) => [text, ...textTokens],
  noticeSymbol: (text, ...textTokens) => [text, ...textTokens],
  strong: (text, ...textTokens) => [text, ...textTokens],
  title: (text, ...textTokens) => [text, ...textTokens],
  warning: (text, ...textTokens) => [text, ...textTokens],
};

const style = (() => {
  if (!globalState.logStyle) return (globalState.logStyle = defaultStyle);
  for (const key of Object.keys(defaultStyle)) {
    if (!globalState.logStyle[key]) globalState.logStyle[key] = defaultStyle[key];
  }
  return globalState.logStyle;
})();

const logApi = { log, writeText, progress, getPluginWriters, style };

// The log level and interactivity are set up by the log reporter after this module loads,
// so they are exposed as (non-enumerable) getters on the default export
Object.defineProperties(logApi, {
  logLevelIndex: getterDescriptor(() =>
    globalState.logLevelIndex == null ? defaultLogLevelIndex : globalState.logLevelIndex
  ),
  isVerboseMode: getterDescriptor(() => logApi.logLevelIndex > defaultLogLevelIndex),
  isInteractive: getterDescriptor(() =>
    globalState.logIsInteractive == null ? false : globalState.logIsInteractive
  ),
});

export { log, writeText, progress, getPluginWriters, style };
export default logApi;
// CommonJS plugins load this module through the `@serverless/utils/log` alias with `require()`,
// which returns this export, so they get the getters above unchanged
export { logApi as 'module.exports' };
