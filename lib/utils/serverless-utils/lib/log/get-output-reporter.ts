'use strict';

const { EventEmitter } = require('events');
const globalState = require('../global-state');
const memoizee = require('memoizee');

const outputEmitter = (() => {
  if (!globalState.outputEmitter) {
    globalState.outputEmitter = new EventEmitter();
    globalState.outputEmitter.setMaxListeners(0);
  }
  return globalState.outputEmitter;
})();

module.exports = memoizee(
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
