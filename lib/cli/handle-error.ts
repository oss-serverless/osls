import { stripVTControlCharacters as stripAnsi } from 'node:util';
import { style, writeText, log } from '../utils/serverless-utils/log.ts';
import { packageJson as packageModule } from '../utils/package-root.ts';
import tokenizeException from '../utils/tokenize-exception.ts';
import isLocallyInstalled from './is-locally-installed.ts';
const slsVersion = packageModule.version;

export default (exception) => {
  const exceptionTokens = tokenizeException(exception);
  const isUserError = exceptionTokens.isUserError;

  const platform = process.platform;
  const nodeVersion = process.version.replace(/^[v|V]/, '');
  const installationModePostfix = (() => {
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
