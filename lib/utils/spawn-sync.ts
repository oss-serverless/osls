import spawn from 'cross-spawn';
import { validateSpawnInput } from './spawn-policy.ts';

export default (command, args = [], options = {}) => {
  if (args == null) args = [];
  options = options || {};
  validateSpawnInput(command, args, options);

  return spawn.sync(String(command), args.map(String), options);
};
