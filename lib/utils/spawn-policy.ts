'use strict';

const ServerlessError = require('../serverless-error');

const validateSpawnInput = (command, args, options = {}) => {
  options = options || {};

  if (typeof command !== 'string' || command.length === 0) {
    throw new ServerlessError('Spawn command must be a non-empty string.', 'INVALID_SPAWN_INPUT');
  }

  if (!Array.isArray(args)) {
    throw new ServerlessError('Spawn args must be an array.', 'INVALID_SPAWN_INPUT');
  }

  if (command.includes('\0') || args.some((arg) => String(arg).includes('\0'))) {
    throw new ServerlessError('Refusing to spawn command with null bytes.', 'INVALID_SPAWN_INPUT');
  }

  if (options.shell) {
    throw new ServerlessError(
      `Refusing to spawn "${command}" with shell enabled.`,
      'UNSAFE_SHELL_SPAWN'
    );
  }
};

module.exports = { validateSpawnInput };
