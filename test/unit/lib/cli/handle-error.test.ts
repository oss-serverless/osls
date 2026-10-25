'use strict';

const chai = require('chai');

const observeOutput = require('../../../lib/observe-output');
const handleError = require('../../../../lib/cli/handle-error');
const isStandaloneExecutable = require('../../../../lib/utils/is-standalone-executable');
const ServerlessError = require('../../../../lib/serverless-error');

const expect = chai.expect;

describe('test/unit/lib/cli/handle-error.test.js', () => {
  it('should output error', async () => {
    const output = await observeOutput(() => handleError(new ServerlessError('Test error')));
    expect(output).to.have.string('Test error');
  });

  if (isStandaloneExecutable) {
    it('should report standalone installation', async () => {
      const output = await observeOutput(() => handleError(new ServerlessError('Test error')));
      expect(output).to.have.string('(standalone)');
    });
  }

  it('should handle non-error objects', async () => {
    const output = await observeOutput(() => handleError(handleError('NON-ERROR')));
    expect(output).to.have.string('NON-ERROR');
  });
});
