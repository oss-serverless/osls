'use strict';

module.exports = async () => {
  const cliArgs = new Set(process.argv.slice(2));

  // Unconditionally favor "serverless" for version check
  if (cliArgs.has('--version')) return 'serverless';
  if (cliArgs.has('-v')) return 'serverless';

  // Detect eventual component configuration
  const fsp = require('fs').promises;

  // Used only for osls compose, based on a simplified construction of command
  const command = (() => {
    const args = process.argv.slice(2);
    // Simplified check - if arg starts with `-` then we consider it to be
    // a param and everything before it to be a command
    const firstParamIndex = args.findIndex((element) => element.startsWith('-'));

    const commands = args.slice(0, firstParamIndex === -1 ? Infinity : firstParamIndex);
    return commands.join(' ');
  })();

  const isComposeIgnoredCommand = new Set([
    '',
    'config',
    'config credentials',
    'create',
    'doctor',
    'generate-event',
    'install',
    'plugin list',
    'plugin search',
  ]).has(command);

  // Used only for osls compose check
  const isHelpRequest = command === '' && new Set(process.argv).has('--help');

  if (!isComposeIgnoredCommand || isHelpRequest) {
    if (
      (
        await Promise.all(
          ['yml', 'yaml', 'json', 'js', 'ts'].map(async (extension) => {
            try {
              await fsp.access(`serverless-compose.${extension}`);
              return true;
            } catch {
              return false;
            }
          })
        )
      ).some(Boolean)
    ) {
      return '@osls/compose';
    }
  }

  return 'serverless';
};
