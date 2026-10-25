import * as chai from 'chai';
import observeOutput from '../../../lib/observe-output.ts';
import handleError from '../../../../lib/cli/handle-error.ts';
import ServerlessError from '../../../../lib/serverless-error.ts';

const expect = chai.expect;

describe('test/unit/lib/cli/handle-error.test.ts', () => {
  it('should output error', async () => {
    const output = await observeOutput(() => handleError(new ServerlessError('Test error')));
    expect(output).to.have.string('Test error');
  });

  it('should handle non-error objects', async () => {
    const output = await observeOutput(() => handleError(handleError('NON-ERROR')));
    expect(output).to.have.string('NON-ERROR');
  });
});
