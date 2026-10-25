'use strict';

const path = require('path');
const fsp = require('fs').promises;
const weakMemoizee = require('memoizee/weak');
const resolveTmpdir = require('./resolve-process-tmp-dir');
const ServerlessError = require('../serverless-error');
const safeMoveFile = require('./fs/safe-move-file');
const { style, log } = require('./serverless-utils/log');
const healthStatusFilename = require('./health-status-filename');

const triggeredDeprecations = new Set();
const bufferedDeprecations = [];

const deprecationLogger = log.get('deprecation');

function extractCodes(codesStr) {
  if (!codesStr) {
    return new Set();
  }
  return new Set(codesStr.split(','));
}

const resolveDisabledDeprecationsByService = weakMemoizee((serviceConfig) => {
  const disabledDeprecations =
    typeof serviceConfig.disabledDeprecations === 'string'
      ? [serviceConfig.disabledDeprecations]
      : Array.from(serviceConfig.disabledDeprecations || []);
  return new Set(disabledDeprecations);
});

const resolveMode = (serviceConfig) => {
  const notificationModeByEnv = process.env.SLS_DEPRECATION_NOTIFICATION_MODE;

  switch (notificationModeByEnv) {
    case 'error':
    case 'warn':
      return notificationModeByEnv;
    default:
  }
  const modeByConfig = serviceConfig && serviceConfig.deprecationNotificationMode;
  switch (modeByConfig) {
    case 'error':
    case 'warn':
      return modeByConfig;
    default:
      return module.exports.defaultMode;
  }
};

function writeDeprecation(code, message) {
  const messageLines = message.split('\n');
  log.warning(messageLines.join('\n'));
}

const isDisabledByEnv = (code) => {
  const disabledDeprecationCodesByEnv = extractCodes(process.env.SLS_DEPRECATION_DISABLE);
  return disabledDeprecationCodesByEnv.has(code) || disabledDeprecationCodesByEnv.has('*');
};

module.exports = (code, message, { serviceConfig } = {}) => {
  try {
    if (triggeredDeprecations.has(code) || isDisabledByEnv(code)) {
      return;
    }

    if (serviceConfig) {
      const serviceDisabledCodes = resolveDisabledDeprecationsByService(serviceConfig);
      if (serviceDisabledCodes.has(code) || serviceDisabledCodes.has('*')) {
        return;
      }
    }

    switch (resolveMode(serviceConfig)) {
      case 'error':
        throw new ServerlessError(
          `${message}\n  More Info: https://github.com/oss-serverless/osls/blob/4.x/docs/guides/deprecations.md#${code}`,
          `REJECTED_DEPRECATION_${code}`
        );
      case 'warn':
        writeDeprecation(code, message);
        return;
      default:
        bufferedDeprecations.push({ message, code });
    }
  } finally {
    triggeredDeprecations.add(code);
  }
};

module.exports.triggeredDeprecations = triggeredDeprecations;
module.exports.defaultMode = 'warn:summary';

module.exports.printSummary = async () => {
  if (!bufferedDeprecations.length) {
    try {
      await fsp.unlink(healthStatusFilename);
    } catch {
      // ignore
    }
    return;
  }

  try {
    const healthStatus = [];

    deprecationLogger.warning();

    if (bufferedDeprecations.length === 1) {
      healthStatus.push('1 deprecation triggered in the last command:', '');
      deprecationLogger.warning(
        style.aside("1 deprecation found: run 'serverless doctor' for more details")
      );
    } else {
      healthStatus.push(
        `${bufferedDeprecations.length} deprecations triggered in the last command:`,
        ''
      );
      deprecationLogger.warning(
        style.aside(
          `${bufferedDeprecations.length} deprecations found: run 'serverless doctor' for more details`
        )
      );
    }
    for (const { code, message } of bufferedDeprecations) {
      healthStatus.push(message);
      if (!code.startsWith('EXT_')) {
        healthStatus.push(
          style.aside(
            `More info: https://github.com/oss-serverless/osls/blob/4.x/docs/guides/deprecations.md#${code}`
          )
        );
      }
    }

    const tmpHealthStatusFilename = path.resolve(await resolveTmpdir(), 'health-status');
    await Promise.all([
      fsp.mkdir(path.dirname(healthStatusFilename), { recursive: true }),
      fsp.writeFile(tmpHealthStatusFilename, healthStatus.join('\n')),
    ]);
    try {
      await safeMoveFile(tmpHealthStatusFilename, healthStatusFilename);
    } catch (error) {
      if (error.code === 'EACCES') {
        log.error(
          'Cannot store information on approached deprecation. Please ensure process has write access to the ~/.serverless directory'
        );
      } else {
        throw error;
      }
    }
  } finally {
    bufferedDeprecations.length = 0;
  }
};
