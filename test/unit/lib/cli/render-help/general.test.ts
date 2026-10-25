import { expect } from 'chai';
import renderGeneralHelp from '../../../../../lib/cli/render-help/general.ts';
import observeOutput from '../../../../lib/observe-output.ts';

describe('test/unit/lib/cli/render-help/general.test.ts', () => {
  it('should show help', async () => {
    const output = await observeOutput(() => renderGeneralHelp(new Set()));
    expect(output).to.have.string('Usage');
    expect(output).to.have.string('deploy function');
  });
});
