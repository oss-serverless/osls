'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const checkIfBucketExists = require('../../../../../../lib/plugins/aws/lib/check-if-bucket-exists');

describe('test/unit/lib/plugins/aws/lib/check-if-bucket-exists.test.js', () => {
  let context;
  let headBucketStub;

  beforeEach(() => {
    context = {
      provider: {
        getAwsSdkV3Config: sinon
          .stub()
          .resolves({ region: 'us-east-1', credentials: sinon.stub() }),
      },
      ...checkIfBucketExists,
    };
    headBucketStub = sinon.stub(S3Client.prototype, 'send');
  });

  afterEach(() => {
    S3Client.prototype.send.restore();
  });

  it('returns true when HeadBucket succeeds', async () => {
    headBucketStub.resolves({});

    await expect(context.checkIfBucketExists('bucket')).to.eventually.equal(true);

    expect(headBucketStub).to.have.been.calledOnce;
    expect(headBucketStub.firstCall.args[0]).to.be.instanceOf(HeadBucketCommand);
    expect(headBucketStub.firstCall.args[0].input).to.deep.equal({ Bucket: 'bucket' });
  });

  it('uses an existing S3 client promise from the plugin context', async () => {
    const send = sinon.stub().resolves({});
    context.provider.getAwsSdkV3Config.throws(
      new Error('Expected existing S3 client to be reused')
    );
    context.s3ClientPromise = Promise.resolve({ send });

    await expect(context.checkIfBucketExists('bucket')).to.eventually.equal(true);

    expect(context.provider.getAwsSdkV3Config).to.not.have.been.called;
    expect(send).to.have.been.calledOnce;
    expect(send.firstCall.args[0]).to.be.instanceOf(HeadBucketCommand);
    expect(send.firstCall.args[0].input).to.deep.equal({ Bucket: 'bucket' });
  });

  for (const error of [
    { code: 'AWS_S3_HEAD_BUCKET_NOT_FOUND' },
    { name: 'NotFound' },
    { name: 'NoSuchBucket' },
    { $metadata: { httpStatusCode: 404 } },
  ]) {
    it(`returns false for missing bucket shape ${JSON.stringify(error)}`, async () => {
      headBucketStub.rejects(error);

      await expect(context.checkIfBucketExists('bucket')).to.eventually.equal(false);
    });
  }

  for (const error of [
    { code: 'AWS_S3_HEAD_BUCKET_FORBIDDEN' },
    { name: 'Forbidden' },
    { name: 'AccessDenied' },
    { $metadata: { httpStatusCode: 403 } },
  ]) {
    it(`throws stable forbidden error for shape ${JSON.stringify(error)}`, async () => {
      headBucketStub.rejects(error);

      try {
        await context.checkIfBucketExists('bucket');
        throw new Error('Expected checkIfBucketExists to reject');
      } catch (caughtError) {
        expect(caughtError.code).to.equal('AWS_S3_HEAD_BUCKET_FORBIDDEN');
      }
    });
  }

  it('rethrows unexpected errors', async () => {
    headBucketStub.rejects(new Error('boom'));

    await expect(context.checkIfBucketExists('bucket')).to.be.rejectedWith('boom');
  });
});
