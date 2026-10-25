'use strict';

const NodeLogReporter = require('log-node/lib/writer');
const logLevels = require('log/levels');
const logEmitter = require('log/lib/emitter');
const { stderrColors } = require('../../../../colors');
const style = require('./style');

const WARNING_LEVEL_INDEX = logLevels.indexOf('warning');
const ERROR_LEVEL_INDEX = logLevels.indexOf('error');

class ServerlessLogReporter extends NodeLogReporter {
  constructor({ logLevelIndex, debugNamespaces }) {
    if (debugNamespaces) {
      debugNamespaces = debugNamespaces
        .split(',')
        .filter(Boolean)
        .map((namespace) => `serverless:${namespace}`)
        .join(',');
    }
    super({
      env: { LOG_LEVEL: logLevels[logLevelIndex], LOG_DEBUG: debugNamespaces },
      defaultNamespace: 'serverless',
    });

    // Prevent "Warning:" prefix on deprecation warnings
    logEmitter.on('init', ({ logger }) => {
      if (logger.namespace === 'serverless:deprecation') {
        logger.levelMessagePrefix = null;
      }
    });
  }
  isLoggerEnabled(logger) {
    return logger.namespaceTokens[0] === 'serverless' && logger.isEnabled;
  }
  setupLevelMessageDecorator(levelLogger) {
    if (levelLogger.levelIndex === WARNING_LEVEL_INDEX) {
      levelLogger.messageContentDecorator = style.warning;
    }
  }
  resolveMessageContent(event) {
    super.resolveMessageContent(event);
    if (event.logger.levelIndex !== ERROR_LEVEL_INDEX) {
      return;
    }
    const [firstLine, ...otherLines] = event.messageContent.split('\n');
    event.messageContent = `${style.error(firstLine)}${
      otherLines.length ? `\n  ${style.aside(otherLines.join('\n  '))}` : ''
    }`;
  }
  resolveMessageTimestamp() {
    // No log timestamp reporting at this point
  }
}

ServerlessLogReporter.levelPrefixes = {
  error: style.error(process.platform !== 'win32' && stderrColors.level >= 2 ? '✖' : '×'),
  warning: style.warning('Warning:'),
};

ServerlessLogReporter.resolveNamespaceMessagePrefix = function (logger) {
  if (logger.level !== 'debug') {
    return null;
  }
  if (logger.namespaceTokens.length < 2) {
    return null;
  }
  return `${logger.namespaceTokens.slice(1).join(':')}:`;
};

module.exports = (config) => new ServerlessLogReporter(config);
