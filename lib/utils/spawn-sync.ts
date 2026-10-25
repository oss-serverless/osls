'use strict';

const spawn = require('cross-spawn');
const { validateSpawnInput } = require('./spawn-policy');

module.exports = (command, args = [], options = {}) => {
  if (args == null) args = [];
  options = options || {};
  validateSpawnInput(command, args, options);

  return spawn.sync(String(command), args.map(String), options);
};
