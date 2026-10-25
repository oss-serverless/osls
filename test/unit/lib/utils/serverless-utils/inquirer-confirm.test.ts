import * as sinon from 'sinon';
import { expect } from 'chai';
import esmock from 'esmock';

describe('serverless-utils/inquirer/confirm', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('returns the configured confirmation result', async () => {
    const prompt = sinon.stub().resolves({ shouldConfirm: true });
    const confirm = (
      await esmock('../../../../../lib/utils/serverless-utils/inquirer/confirm.ts', {
        '../../../../../lib/utils/serverless-utils/inquirer/index.ts': { prompt },
      })
    ).default;

    expect(await confirm('Should?', { name: 'shouldConfirm' })).to.equal(true);
    expect(
      prompt.calledOnceWithExactly({
        message: 'Should?',
        type: 'confirm',
        name: 'shouldConfirm',
      })
    ).to.equal(true);
  });

  it('defaults the answer name to isConfirmed', async () => {
    const prompt = sinon.stub().resolves({ isConfirmed: false });
    const confirm = (
      await esmock('../../../../../lib/utils/serverless-utils/inquirer/confirm.ts', {
        '../../../../../lib/utils/serverless-utils/inquirer/index.ts': { prompt },
      })
    ).default;

    expect(await confirm('Should?')).to.equal(false);
    expect(
      prompt.calledOnceWithExactly({
        message: 'Should?',
        type: 'confirm',
        name: 'isConfirmed',
      })
    ).to.equal(true);
  });
});
