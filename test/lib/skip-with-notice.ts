'use strict';

const colors = require('../../lib/utils/colors');

module.exports = (context, reason, afterCallback) => {
  if (!context || typeof context.skip !== 'function') {
    throw new TypeError('Passed context is not a valid mocha suite');
  }
  if (process.env.CI) return; // Do not tolerate skips in CI environment

  process.stdout.write(colors.yellow(`\n Skipped due to: ${colors.red(reason)}\n\n`));

  if (afterCallback) {
    try {
      // Ensure teardown is called
      // (Mocha fails to do it -> https://github.com/mochajs/mocha/issues/3740)
      afterCallback();
    } catch (error) {
      process.stdout.write(colors.red(`after callback crashed with: ${error.stack}\n`));
    }
  }
  context.skip();
};
