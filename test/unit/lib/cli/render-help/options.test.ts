import { expect } from 'chai';
import renderOptionsHelp from '../../../../../lib/cli/render-help/options.ts';
import observeOutput from '../../../../lib/observe-output.ts';

describe('test/unit/lib/cli/render-help/options.test.ts', () => {
  it('should list options', async () => {
    const output = await observeOutput(() =>
      renderOptionsHelp({
        foo: {
          usage: 'Some option',
          shortcut: 'b',
          required: true,
        },
        bar: {
          usage: 'Elo',
        },
        noData: {},
      })
    );
    expect(output).to.have.string('--foo');
    expect(output).to.have.string('-b');
    expect(output).to.have.string('Some option');
  });
});
