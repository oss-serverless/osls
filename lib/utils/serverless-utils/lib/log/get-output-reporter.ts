import { EventEmitter } from 'node:events';
import globalState from '../global-state.ts';
import memoizee from 'memoizee';

const outputEmitter = (() => {
  if (!globalState.outputEmitter) {
    globalState.outputEmitter = new EventEmitter();
    globalState.outputEmitter.setMaxListeners(0);
  }
  return globalState.outputEmitter;
})();

export default memoizee(
  (namespace) => {
    return {
      get: memoizee(
        (mode) =>
          (text, ...textTokens) => {
            outputEmitter.emit('write', {
              namespace,
              mode,
              textTokens: [text, ...textTokens],
            });
          },
        { primitive: true }
      ),
    };
  },
  { primitive: true }
);

module.exports.emitter = outputEmitter;
