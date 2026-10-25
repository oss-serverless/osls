import { expect } from 'chai';
import listVersion from '../../../../lib/cli/render-version.ts';
import observeOutput from '../../../lib/observe-output.ts';

describe('test/unit/lib/cli/list-version.test.ts', () => {
  it('should log version', async () => {
    const output = await observeOutput(() => listVersion());
    expect(output).to.have.string('osls version: ');
  });
});
