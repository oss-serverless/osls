'use strict';

const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const ServerlessError = require('../../../../lib/serverless-error');
const {
  retryOnThrottlingError,
  retryOnTransientNetworkError,
} = require('../../../../lib/aws/retry');

const { expect } = chai;

describe('test/unit/lib/aws/retry.test.js', () => {
  const createThrottlingError = () =>
    Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });

  it('retries throttling errors until the task succeeds', async () => {
    const task = sinon.stub();
    task.onCall(0).rejects(createThrottlingError());
    task.onCall(1).resolves('result');

    await expect(retryOnThrottlingError(task, { delayMs: 1 })).to.eventually.equal('result');
    expect(task).to.have.been.calledTwice;
  });

  it('retries errors the SDK marks as retryable throttling', async () => {
    const error = Object.assign(new Error('Slow down'), { $retryable: { throttling: true } });
    const task = sinon.stub();
    task.onCall(0).rejects(error);
    task.onCall(1).resolves('result');

    await expect(retryOnThrottlingError(task, { delayMs: 1 })).to.eventually.equal('result');
    expect(task).to.have.been.calledTwice;
  });

  it('retries throttling errors carried in wrapped provider errors', async () => {
    const wrappedError = Object.assign(
      new ServerlessError('Upload failed', 'AWS_S3_UPLOAD_SLOW_DOWN'),
      {
        // Both throttling signals the SDK emits, on the wrapped error only
        providerError: Object.assign(new Error('Please reduce your request rate.'), {
          name: 'SlowDown',
          $retryable: { throttling: true },
        }),
      }
    );
    const task = sinon.stub();
    task.onCall(0).rejects(wrappedError);
    task.onCall(1).resolves('result');

    await expect(retryOnThrottlingError(task, { delayMs: 1 })).to.eventually.equal('result');
    expect(task).to.have.been.calledTwice;
  });

  it('retries when only the wrapped provider error carries the retryable flag', async () => {
    const wrappedError = Object.assign(
      new ServerlessError('Upload failed', 'AWS_S3_UPLOAD_ERROR'),
      {
        providerError: Object.assign(new Error('Reduce rate'), {
          name: 'UnfamiliarThrottleName',
          $retryable: { throttling: true },
        }),
      }
    );
    const task = sinon.stub();
    task.onCall(0).rejects(wrappedError);
    task.onCall(1).resolves('result');

    await expect(retryOnThrottlingError(task, { delayMs: 1 })).to.eventually.equal('result');
    expect(task).to.have.been.calledTwice;
  });

  it('rethrows after exhausting the retry budget', async () => {
    const task = sinon.stub().rejects(createThrottlingError());

    await expect(retryOnThrottlingError(task, { delayMs: 1, maxRetries: 2 })).to.be.rejectedWith(
      'Rate exceeded'
    );
    expect(task).to.have.been.calledThrice;
  });

  it('jitters the retry delay between 0.8 and 1.4 times the base delay', async () => {
    const sleepStub = sinon.stub().resolves();
    const { retryOnThrottlingError: retryWithSleepStub } = proxyquire('../../../../lib/aws/retry', {
      '../utils/sleep': sleepStub,
    });
    const randomStub = sinon.stub(Math, 'random');
    randomStub.onFirstCall().returns(0);
    randomStub.onSecondCall().returns(0.999999);
    const task = sinon.stub();
    task.onCall(0).rejects(createThrottlingError());
    task.onCall(1).rejects(createThrottlingError());
    task.onCall(2).resolves('result');

    try {
      await expect(retryWithSleepStub(task, { delayMs: 5000 })).to.eventually.equal('result');
    } finally {
      randomStub.restore();
    }

    expect(sleepStub).to.have.been.calledTwice;
    expect(sleepStub.firstCall.args[0]).to.equal(4000);
    expect(sleepStub.secondCall.args[0]).to.equal(7000);
  });

  it('does not retry non-throttling errors', async () => {
    const error = Object.assign(new Error('Access denied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
    const task = sinon.stub().rejects(error);

    await expect(retryOnThrottlingError(task, { delayMs: 1 })).to.be.rejectedWith('Access denied');
    expect(task).to.have.been.calledOnce;
  });

  it('retries transient network errors', async () => {
    const task = sinon.stub();
    task.onCall(0).rejects(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    task.onCall(1).resolves('result');

    await expect(retryOnTransientNetworkError(task, { delayMs: 1 })).to.eventually.equal('result');
    expect(task).to.have.been.calledTwice;
  });

  it('does not retry persistent errors as transient network failures', async () => {
    const task = sinon.stub().rejects(new Error('The specified key does not exist.'));

    await expect(retryOnTransientNetworkError(task, { delayMs: 1 })).to.be.rejectedWith(
      'The specified key does not exist.'
    );
    expect(task).to.have.been.calledOnce;
  });
});
