'use strict';

const isThenable = require('type/thenable/is');
const {
  emitter: outputEmitter,
} = require('../../lib/utils/serverless-utils/lib/log/get-output-reporter');
const joinTextTokens = require('../../lib/utils/serverless-utils/lib/log/join-text-tokens');

module.exports = (callback) => {
  let output = '';
  const outputListener = ({ mode, textTokens }) => {
    if (mode === 'text') output += joinTextTokens(textTokens);
  };
  outputEmitter.on('write', outputListener);
  const cleanup = () => outputEmitter.off('write', outputListener);
  const propagateException = (error) => {
    error.output = output;
    throw error;
  };
  const result = (() => {
    try {
      return callback();
    } catch (error) {
      cleanup();
      return propagateException(error);
    }
  })();
  if (!isThenable(result)) {
    cleanup();
    return output;
  }
  return Promise.resolve(result)
    .then(() => output, propagateException)
    .finally(cleanup);
};
