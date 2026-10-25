'use strict';

const { stripVTControlCharacters: stripAnsi } = require('node:util');
const { style, writeText, log } = require('../utils/serverless-utils/log');
const slsVersion = require('./../../package').version;
const isStandaloneExecutable = require('../utils/is-standalone-executable');
const tokenizeException = require('../utils/tokenize-exception');
const isLocallyInstalled = require('./is-locally-installed');

module.exports = (exception) => {
  const exceptionTokens = tokenizeException(exception);
  const isUserError = exceptionTokens.isUserError;

  const platform = process.platform;
  const nodeVersion = process.version.replace(/^[v|V]/, '');
  const installationModePostfix = (() => {
    if (isStandaloneExecutable) return ' (standalone)';
    return isLocallyInstalled ? ' (local)' : '';
  })();
  const globalInstallationPostfix = (() => {
    if (EvalError.$serverlessInitInstallationVersion) {
      return ` ${EvalError.$serverlessInitInstallationVersion}v (global)`;
    }
    return '';
  })();

  const detailsTextTokens = [
    `Environment: ${platform}, node ${nodeVersion}, ` +
      `osls ${slsVersion}${installationModePostfix}${globalInstallationPostfix}`,
  ];

  detailsTextTokens.push('Docs:        github.com/oss-serverless/osls');

  log.notice(style.aside(detailsTextTokens.join('\n')));
  log.notice();

  // TODO: Ideally, once all internal error formatting is emitted through structured style tokens,
  // this strip should no longer be necessary.
  const errorMsg =
    exceptionTokens.decoratedMessage ||
    stripAnsi(
      exceptionTokens.stack && !isUserError ? exceptionTokens.stack : exceptionTokens.message
    );
  writeText(style.error('Error:'), errorMsg);

  process.exitCode = 1;

  return {};
};
