'use strict';

const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();

describe('serverless-utils/inquirer/confirm', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('returns the configured confirmation result', async () => {
    const prompt = sinon.stub().resolves({ shouldConfirm: true });
    const confirm = proxyquire('../../../../../lib/utils/serverless-utils/inquirer/confirm', {
      './': { prompt },
    });

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
    const confirm = proxyquire('../../../../../lib/utils/serverless-utils/inquirer/confirm', {
      './': { prompt },
    });

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
