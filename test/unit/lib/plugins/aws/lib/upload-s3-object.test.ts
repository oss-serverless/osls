'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const ServerlessError = require('../../../../../../lib/serverless-error');

describe('test/unit/lib/plugins/aws/lib/upload-s3-object.test.js', () => {
  let doneStub;
  let s3Clients;
  let uploadOptions;
  let uploadS3Object;

  beforeEach(() => {
    doneStub = sinon.stub().resolves({ ETag: 'etag' });
    s3Clients = [];
    uploadOptions = [];
    uploadS3Object = proxyquire
      .noCallThru()
      .load('../../../../../../lib/plugins/aws/lib/upload-s3-object', {
        '@aws-sdk/client-s3': {
          S3Client: class S3Client {
            constructor(config) {
              this.config = config;
              s3Clients.push(this);
            }
          },
        },
        '@aws-sdk/lib-storage': {
          Upload: class Upload {
            constructor(options) {
              uploadOptions.push(options);
            }

            done() {
              return doneStub();
            }
          },
        },
      });
  });

  function createProvider({ accelerate = false } = {}) {
    const credentials = sinon.stub().resolves({ accessKeyId: 'key', secretAccessKey: 'secret' });
    const provider = {
      isS3TransferAccelerationEnabled: sinon.stub().returns(accelerate),
      getAwsSdkV3Config: sinon.stub().callsFake(async (options) => ({
        region: 'us-east-1',
        credentials,
        ...options,
      })),
    };
    provider.credentials = credentials;
    return provider;
  }

  it('passes provider config, credentials, params, and upload options', async () => {
    const provider = createProvider();
    const params = { Bucket: 'bucket', Key: 'key', Body: 'body' };

    await expect(uploadS3Object(provider, params)).to.eventually.deep.equal({ ETag: 'etag' });

    expect(provider.getAwsSdkV3Config).to.have.been.calledOnceWithExactly({
      useAccelerateEndpoint: false,
    });
    expect(s3Clients).to.have.length(1);
    expect(s3Clients[0].config).to.include({
      region: 'us-east-1',
      useAccelerateEndpoint: false,
    });
    expect(s3Clients[0].config.credentials).to.equal(provider.credentials);
    expect(uploadOptions).to.have.length(1);
    expect(uploadOptions[0]).to.deep.include({
      client: s3Clients[0],
      params,
      queueSize: 6,
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false,
    });
  });

  it('enables S3 transfer acceleration only when provider option is enabled', async () => {
    const provider = createProvider({ accelerate: true });

    await uploadS3Object(provider, { Bucket: 'bucket', Key: 'key', Body: 'body' });

    expect(provider.getAwsSdkV3Config).to.have.been.calledOnceWithExactly({
      useAccelerateEndpoint: true,
    });
    expect(s3Clients[0].config.useAccelerateEndpoint).to.equal(true);
  });

  it('reuses one S3 client for repeated uploads with the same acceleration setting', async () => {
    const provider = createProvider();
    const firstParams = { Bucket: 'bucket', Key: 'first', Body: 'first-body' };
    const secondParams = { Bucket: 'bucket', Key: 'second', Body: 'second-body' };

    await uploadS3Object(provider, firstParams);
    await uploadS3Object(provider, secondParams);

    expect(s3Clients).to.have.length(1);
    expect(provider.getAwsSdkV3Config).to.have.been.calledOnceWithExactly({
      useAccelerateEndpoint: false,
    });
    expect(uploadOptions).to.have.length(2);
    expect(uploadOptions[0]).to.deep.include({ client: s3Clients[0], params: firstParams });
    expect(uploadOptions[1]).to.deep.include({ client: s3Clients[0], params: secondParams });
  });

  it('uses distinct S3 clients for acceleration on and off', async () => {
    const provider = createProvider();
    provider.isS3TransferAccelerationEnabled.onFirstCall().returns(false);
    provider.isS3TransferAccelerationEnabled.onSecondCall().returns(true);

    await uploadS3Object(provider, { Bucket: 'bucket', Key: 'first', Body: 'body' });
    await uploadS3Object(provider, { Bucket: 'bucket', Key: 'second', Body: 'body' });

    expect(s3Clients).to.have.length(2);
    expect(s3Clients[0].config.useAccelerateEndpoint).to.equal(false);
    expect(s3Clients[1].config.useAccelerateEndpoint).to.equal(true);
  });

  for (const [providerError, expectedCode] of [
    [Object.assign(new Error('denied'), { name: 'AccessDenied' }), 'AWS_S3_UPLOAD_ACCESS_DENIED'],
    [
      Object.assign(new Error('forbidden'), { $metadata: { httpStatusCode: 403 } }),
      'AWS_S3_UPLOAD_HTTP_403_ERROR',
    ],
    [{ code: 'SlowDown', message: 'slow down' }, 'AWS_S3_UPLOAD_SLOW_DOWN'],
    [{ code: 'ECONNRESET', message: 'socket reset' }, 'AWS_S3_UPLOAD_ECONNRESET'],
    [{ Code: 'NoSuchBucket', message: 'missing bucket' }, 'AWS_S3_UPLOAD_NO_SUCH_BUCKET'],
  ]) {
    it(`normalizes upload errors as ${expectedCode}`, async () => {
      const provider = createProvider();
      doneStub.rejects(providerError);

      try {
        await uploadS3Object(provider, { Bucket: 'bucket', Key: 'key', Body: 'body' });
      } catch (error) {
        expect(error.code).to.equal(expectedCode);
        expect(error.providerError).to.equal(providerError);
        return;
      }

      throw new Error('Expected upload to reject');
    });
  }

  it('preserves framework-normalized Serverless errors', async () => {
    const provider = createProvider();
    const credentialsError = new ServerlessError(
      'AWS provider credentials not found.',
      'AWS_CREDENTIALS_NOT_FOUND'
    );
    doneStub.rejects(credentialsError);

    try {
      await uploadS3Object(provider, { Bucket: 'bucket', Key: 'key', Body: 'body' });
    } catch (error) {
      expect(error).to.equal(credentialsError);
      expect(error.code).to.equal('AWS_CREDENTIALS_NOT_FOUND');
      return;
    }

    throw new Error('Expected upload to reject');
  });
});
