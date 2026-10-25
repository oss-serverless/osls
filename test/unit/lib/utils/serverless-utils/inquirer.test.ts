import * as sinon from 'sinon';
import { expect } from 'chai';
import esmock from 'esmock';

describe('serverless-utils/inquirer', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('returns the confirmation answer from the local prompt facade', async () => {
    const question = sinon.stub().resolves('yes');
    const close = sinon.stub();
    const createInterface = sinon.stub().returns({
      question,
      close,
    });

    const inquirer = (
      await esmock('../../../../../lib/utils/serverless-utils/inquirer/index.ts', {
        'node:readline/promises': {
          createInterface,
        },
      })
    ).default;

    const result = await inquirer.prompt({
      message: 'Should?',
      type: 'confirm',
      name: 'shouldConfirm',
    });

    expect(result.shouldConfirm).to.equal(true);
    expect(question.calledOnceWithExactly('? Should? (Y/n) ')).to.equal(true);
    expect(close.calledOnce).to.equal(true);
  });

  it('defaults blank confirmation answers to yes', async () => {
    const question = sinon.stub().resolves('');
    const createInterface = sinon.stub().returns({
      question,
      close: sinon.stub(),
    });

    const inquirer = (
      await esmock('../../../../../lib/utils/serverless-utils/inquirer/index.ts', {
        'node:readline/promises': {
          createInterface,
        },
      })
    ).default;

    const result = await inquirer.prompt({
      message: 'Should?',
      type: 'confirm',
      name: 'shouldConfirm',
    });

    expect(result.shouldConfirm).to.equal(true);
  });

  it('defaults blank confirmation answers to no when default is false', async () => {
    const question = sinon.stub().resolves('');
    const createInterface = sinon.stub().returns({
      question,
      close: sinon.stub(),
    });

    const inquirer = (
      await esmock('../../../../../lib/utils/serverless-utils/inquirer/index.ts', {
        'node:readline/promises': {
          createInterface,
        },
      })
    ).default;

    const result = await inquirer.prompt({
      message: 'Should?',
      type: 'confirm',
      name: 'shouldConfirm',
      default: false,
    });

    expect(result.shouldConfirm).to.equal(false);
    expect(question.calledOnceWithExactly('? Should? (y/N) ')).to.equal(true);
  });

  it('re-prompts until it receives a valid confirmation answer', async () => {
    const question = sinon.stub();
    question.onFirstCall().resolves('maybe');
    question.onSecondCall().resolves('n');
    const close = sinon.stub();
    const createInterface = sinon.stub().returns({
      question,
      close,
    });

    const inquirer = (
      await esmock('../../../../../lib/utils/serverless-utils/inquirer/index.ts', {
        'node:readline/promises': {
          createInterface,
        },
      })
    ).default;

    const result = await inquirer.prompt({
      message: 'Should?',
      type: 'confirm',
      name: 'shouldConfirm',
    });

    expect(result.shouldConfirm).to.equal(false);
    expect(question.calledTwice).to.equal(true);
    expect(close.calledOnce).to.equal(true);
  });
});
