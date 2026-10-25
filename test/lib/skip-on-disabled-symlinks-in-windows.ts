'use strict';

module.exports = (error, context, afterCallback) => {
  if (error.code !== 'EPERM' || process.platform !== 'win32') return;

  if (!context || typeof context.skip !== 'function') {
    throw new TypeError('Passed context is not a valid Mocha context');
  }

  if (afterCallback) afterCallback();
  context.skip();
};
