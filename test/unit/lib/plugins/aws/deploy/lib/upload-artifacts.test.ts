'use strict';

const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const chai = require('chai');
const { Upload } = require('@aws-sdk/lib-storage');
const normalizeFiles = require('../../../../../../../lib/plugins/aws/lib/normalize-files');
const AwsProvider = require('../../../../../../../lib/plugins/aws/provider');
const AwsDeploy = require('../../../../../../../lib/plugins/aws/deploy/index');
const Serverless = require('../../../../../../../lib/serverless');
const { progress } = require('../../../../../../../lib/utils/serverless-utils/log');
const skipOnDisabledSymlinksInWindows = require('../../../../../../lib/skip-on-disabled-symlinks-in-windows');
const { createTmpDir, ensureFileSync, getTmpDirPath } = require('../../../../../../utils/fs');
const runServerless = require('../../../../../../utils/run-serverless');

const expect = chai.expect;

describe('uploadArtifacts', () => {
  let serverless;
  let awsDeploy;
  let cryptoStub;

  beforeEach(() => {
    serverless = new Serverless({ commands: [], options: {} });
    serverless.serviceDir = 'foo';
    serverless.setProvider('aws', new AwsProvider(serverless, {}));
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    awsDeploy = new AwsDeploy(serverless, options);
    awsDeploy.bucketName = 'deployment-bucket';
    awsDeploy.serverless.service.package.artifactDirectoryName = 'somedir';
    awsDeploy.serverless.service.functions = {
      first: {
        handler: 'foo',
      },
    };
    awsDeploy.serverless.service.provider.compiledCloudFormationTemplate = {
      foo: 'bar',
    };
    awsDeploy.serverless.cli = new serverless.classes.CLI();

    cryptoStub = {
      setEncoding: sinon.stub(),
      write: sinon.stub(),
      end: sinon.stub(),
      read: sinon.stub(),
      update() {
        return this;
      },
      digest: sinon.stub(),
    };
    sinon.stub(crypto, 'createHash').callsFake(() => {
      return cryptoStub;
    });
  });

  afterEach(() => sinon.restore());

  it('should format single artifact upload progress with the shared filesize helper', async () => {
    const noticeStub = sinon.stub(progress.get('main'), 'notice');

    sinon.stub(awsDeploy, 'getFunctionArtifactFilePaths').resolves(['artifact.zip']);
    sinon.stub(awsDeploy, 'getLayerArtifactFilePaths').returns([]);
    sinon.stub(awsDeploy, 'getFileStats').resolves({ size: 1123 });
    sinon.stub(awsDeploy, 'uploadCloudFormationFile').resolves();
    sinon.stub(awsDeploy, 'uploadStateFile').resolves();
    sinon.stub(awsDeploy, 'uploadFunctionsAndLayers').resolves();
    sinon.stub(awsDeploy, 'uploadCustomResources').resolves();

    await awsDeploy.uploadArtifacts();

    expect(noticeStub).to.have.been.calledWithExactly('Uploading (1.1 kB)');
  });

  function getUploadParams(uploadStub) {
    return uploadStub.firstCall.thisValue.params;
  }

  function createAwsError(name) {
    return Object.assign(new Error('access denied'), {
      name,
      $metadata: { httpStatusCode: 403 },
    });
  }

  async function expectNormalizedUploadError(promise, providerError) {
    try {
      await promise;
    } catch (error) {
      expect(error.code).to.equal('AWS_S3_UPLOAD_ACCESS_DENIED');
      expect(error.providerError).to.equal(providerError);
      return;
    }

    throw new Error('Expected upload to reject');
  }

  function writeStateFile(state) {
    const serviceDirPath = createTmpDir();
    const stateFileName = awsDeploy.provider.naming.getServiceStateFileName();
    const stateObject = {
      ...state,
      service: {
        provider: {},
        ...(state.service || {}),
      },
      package: state.package || {},
    };
    const stateFileContent = JSON.stringify(stateObject);

    serverless.serviceDir = serviceDirPath;
    serverless.utils.writeFileSync(
      path.join(serviceDirPath, '.serverless', stateFileName),
      stateFileContent
    );

    return stateFileContent;
  }

  describe('#uploadCloudFormationFile()', () => {
    let normalizeCloudFormationTemplateStub;
    let uploadStub;

    beforeEach(() => {
      normalizeCloudFormationTemplateStub = sinon
        .stub(normalizeFiles, 'normalizeCloudFormationTemplate')
        .returns();
      uploadStub = sinon.stub(Upload.prototype, 'done').resolves();
    });

    afterEach(() => {
      normalizeCloudFormationTemplateStub.restore();
      uploadStub.restore();
    });

    it('should upload the CloudFormation file to the S3 bucket', async () => {
      crypto.createHash().update().digest.onCall(0).returns('local-hash-cf-template');

      return awsDeploy.uploadCloudFormationFile().then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(uploadStub).to.have.been.calledOnce;
        expect(getUploadParams(uploadStub)).to.deep.include({
          Bucket: awsDeploy.bucketName,
          Key: `${awsDeploy.serverless.service.package.artifactDirectoryName}/compiled-cloudformation-template.json`,
          Body: JSON.stringify({ foo: 'bar' }),
          ContentType: 'application/json',
        });
        expect(getUploadParams(uploadStub).Metadata).to.deep.equal({
          filesha256: 'local-hash-cf-template',
        });
        expect(uploadStub.firstCall.thisValue).to.include({
          queueSize: 6,
          partSize: 5 * 1024 * 1024,
          leavePartsOnError: false,
        });
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly({ foo: 'bar' });
      });
    });

    it('should configure S3 transfer acceleration for CloudFormation file uploads', async () => {
      crypto.createHash().update().digest.onCall(0).returns('local-hash-cf-template');
      awsDeploy.provider.options['aws-s3-accelerate'] = true;

      return awsDeploy.uploadCloudFormationFile().then(() => {
        expect(uploadStub).to.have.been.calledOnce;
        expect(uploadStub.firstCall.thisValue.client.config.useAccelerateEndpoint).to.equal(true);
      });
    });

    it('should upload the CloudFormation file to a bucket with SSE bucket policy', async () => {
      crypto.createHash().update().digest.onCall(0).returns('local-hash-cf-template');
      awsDeploy.serverless.service.provider.deploymentBucketObject = {
        serverSideEncryption: 'AES256',
      };

      return awsDeploy.uploadCloudFormationFile().then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(uploadStub).to.have.been.calledOnce;
        expect(getUploadParams(uploadStub)).to.deep.include({
          Bucket: awsDeploy.bucketName,
          Key: `${awsDeploy.serverless.service.package.artifactDirectoryName}/compiled-cloudformation-template.json`,
          Body: JSON.stringify({ foo: 'bar' }),
          ContentType: 'application/json',
          Metadata: {
            filesha256: 'local-hash-cf-template',
          },
          ServerSideEncryption: 'AES256',
        });
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly({ foo: 'bar' });
      });
    });

    it('should upload the CloudFormation file with KMS encryption options', async () => {
      crypto.createHash().update().digest.onCall(0).returns('local-hash-cf-template');
      awsDeploy.serverless.service.provider.deploymentBucketObject = {
        serverSideEncryption: 'aws:kms',
        sseKMSKeyId: 'kms-key-id',
      };

      await awsDeploy.uploadCloudFormationFile();

      expect(uploadStub).to.have.been.calledOnce;
      expect(getUploadParams(uploadStub)).to.deep.equal({
        Bucket: awsDeploy.bucketName,
        Key: `${awsDeploy.serverless.service.package.artifactDirectoryName}/compiled-cloudformation-template.json`,
        Body: JSON.stringify({ foo: 'bar' }),
        ContentType: 'application/json',
        Metadata: {
          filesha256: 'local-hash-cf-template',
        },
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: 'kms-key-id',
      });
    });

    it('should normalize CloudFormation upload errors', async () => {
      const error = createAwsError('AccessDenied');
      crypto.createHash().update().digest.onCall(0).returns('local-hash-cf-template');
      uploadStub.rejects(error);

      await expectNormalizedUploadError(awsDeploy.uploadCloudFormationFile(), error);
    });

    it('should normalize status-only CloudFormation upload errors', async () => {
      const error = Object.assign(new Error('forbidden'), {
        $metadata: { httpStatusCode: 403 },
      });
      crypto.createHash().update().digest.onCall(0).returns('local-hash-cf-template');
      uploadStub.rejects(error);

      try {
        await awsDeploy.uploadCloudFormationFile();
      } catch (caughtError) {
        expect(caughtError.code).to.equal('AWS_S3_UPLOAD_HTTP_403_ERROR');
        expect(caughtError.providerError).to.equal(error);
        return;
      }

      throw new Error('Expected upload to reject');
    });
  });

  describe('#uploadStateFile()', () => {
    let uploadStub;

    beforeEach(() => {
      uploadStub = sinon.stub(Upload.prototype, 'done').resolves();
    });

    afterEach(() => {
      uploadStub.restore();
    });

    it('should upload the state file to the S3 bucket', async () => {
      const stateFileContent = writeStateFile({ service: { service: 'new-service' } });
      crypto.createHash().update().digest.onCall(0).returns('local-hash-state-file');

      await awsDeploy.uploadStateFile();

      expect(uploadStub).to.have.been.calledOnce;
      expect(getUploadParams(uploadStub)).to.deep.include({
        Bucket: awsDeploy.bucketName,
        Key: `${awsDeploy.serverless.service.package.artifactDirectoryName}/serverless-state.json`,
        Body: stateFileContent,
        ContentType: 'application/json',
      });
      expect(getUploadParams(uploadStub).Metadata).to.deep.equal({
        filesha256: 'local-hash-state-file',
      });
      expect(uploadStub.firstCall.thisValue).to.include({
        queueSize: 6,
        partSize: 5 * 1024 * 1024,
        leavePartsOnError: false,
      });
    });

    it('should configure S3 transfer acceleration for state file uploads', async () => {
      writeStateFile({ service: { service: 'new-service' } });
      crypto.createHash().update().digest.onCall(0).returns('local-hash-state-file');
      awsDeploy.provider.options['aws-s3-accelerate'] = true;

      await awsDeploy.uploadStateFile();

      expect(uploadStub).to.have.been.calledOnce;
      expect(uploadStub.firstCall.thisValue.client.config.useAccelerateEndpoint).to.equal(true);
    });

    it('should upload the state file with KMS encryption options', async () => {
      const stateFileContent = writeStateFile({ service: { service: 'new-service' } });
      crypto.createHash().update().digest.onCall(0).returns('local-hash-state-file');
      awsDeploy.serverless.service.provider.deploymentBucketObject = {
        serverSideEncryption: 'aws:kms',
        sseKMSKeyId: 'kms-key-id',
      };

      await awsDeploy.uploadStateFile();

      expect(uploadStub).to.have.been.calledOnce;
      expect(getUploadParams(uploadStub)).to.deep.equal({
        Bucket: awsDeploy.bucketName,
        Key: `${awsDeploy.serverless.service.package.artifactDirectoryName}/serverless-state.json`,
        Body: stateFileContent,
        ContentType: 'application/json',
        Metadata: {
          filesha256: 'local-hash-state-file',
        },
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: 'kms-key-id',
      });
    });

    it('should normalize state file upload errors', async () => {
      const error = createAwsError('AccessDenied');
      writeStateFile({ service: { service: 'new-service' } });
      crypto.createHash().update().digest.onCall(0).returns('local-hash-state-file');
      uploadStub.rejects(error);

      await expectNormalizedUploadError(awsDeploy.uploadStateFile(), error);
    });
  });

  describe('#uploadZipFile()', () => {
    let readFileSyncStub;
    let uploadStub;

    beforeEach(() => {
      readFileSyncStub = sinon.stub(fs, 'readFileSync').returns();
      uploadStub = sinon.stub(Upload.prototype, 'done').resolves();
    });

    afterEach(() => {
      readFileSyncStub.restore();
      uploadStub.restore();
    });

    it('should throw for null artifact paths', async () => {
      await expect(awsDeploy.uploadZipFile(null)).to.be.rejectedWith(Error);
    });

    it('should upload the .zip file to the S3 bucket', async () => {
      cryptoStub.read.onCall(0).returns('local-hash-zip-file');

      const tmpDirPath = getTmpDirPath();
      const artifactFilePath = path.join(tmpDirPath, 'artifact.zip');
      serverless.utils.writeFileSync(artifactFilePath, 'artifact.zip file content');

      return awsDeploy
        .uploadZipFile({
          filename: artifactFilePath,
          s3KeyDirname: awsDeploy.serverless.service.package.artifactDirectoryName,
        })
        .then(() => {
          expect(uploadStub).to.have.been.calledOnce;
          expect(getUploadParams(uploadStub)).to.deep.include({
            Bucket: awsDeploy.bucketName,
            Key: `${awsDeploy.serverless.service.package.artifactDirectoryName}/artifact.zip`,
            ContentLength: 25,
            ContentType: 'application/zip',
          });
          expect(getUploadParams(uploadStub).Body.path).to.equal(artifactFilePath);
          expect(getUploadParams(uploadStub).Metadata).to.deep.equal({
            filesha256: 'local-hash-zip-file',
          });
          expect(uploadStub.firstCall.thisValue).to.include({
            queueSize: 6,
            partSize: 5 * 1024 * 1024,
            leavePartsOnError: false,
          });
          expect(readFileSyncStub).to.not.have.been.called;
        });
    });

    it('should declare the size of the target file for symlinked artifacts', async function () {
      cryptoStub.read.onCall(0).returns('local-hash-zip-file');

      const tmpDirPath = getTmpDirPath();
      const targetFilePath = path.join(tmpDirPath, 'cached-artifact.zip');
      const artifactFilePath = path.join(tmpDirPath, 'artifact.zip');
      serverless.utils.writeFileSync(targetFilePath, 'artifact.zip file content');
      try {
        fs.symlinkSync(targetFilePath, artifactFilePath);
      } catch (error) {
        skipOnDisabledSymlinksInWindows(error, this);
        throw error;
      }

      await awsDeploy.uploadZipFile({
        filename: artifactFilePath,
        s3KeyDirname: awsDeploy.serverless.service.package.artifactDirectoryName,
      });

      expect(getUploadParams(uploadStub).ContentLength).to.equal(25);
    });

    it('should configure S3 transfer acceleration for .zip file uploads', async () => {
      crypto.createHash().update().digest.onCall(0).returns('local-hash-zip-file');
      awsDeploy.provider.options['aws-s3-accelerate'] = true;

      const tmpDirPath = getTmpDirPath();
      const artifactFilePath = path.join(tmpDirPath, 'artifact.zip');
      serverless.utils.writeFileSync(artifactFilePath, 'artifact.zip file content');

      await awsDeploy.uploadZipFile({
        filename: artifactFilePath,
        s3KeyDirname: awsDeploy.serverless.service.package.artifactDirectoryName,
      });

      expect(uploadStub).to.have.been.calledOnce;
      expect(uploadStub.firstCall.thisValue.client.config.useAccelerateEndpoint).to.equal(true);
    });

    it('should throw observed stream errors after upload completes', async () => {
      const streamError = new Error('stream failed');
      cryptoStub.read.onCall(0).returns('local-hash-zip-file');
      const artifactFilePath = path.join(getTmpDirPath(), 'artifact.zip');
      serverless.utils.writeFileSync(artifactFilePath, 'artifact.zip file content');
      sinon
        .stub(fs, 'createReadStream')
        .onFirstCall()
        .returns({
          on(eventName, listener) {
            if (eventName === 'data') listener(Buffer.from('artifact'));
            if (eventName === 'close') listener();
            return this;
          },
        })
        .onSecondCall()
        .returns({
          path: artifactFilePath,
          on(eventName, listener) {
            if (eventName === 'error') listener(streamError);
            return this;
          },
        });

      await expect(
        awsDeploy.uploadZipFile({
          filename: artifactFilePath,
          s3KeyDirname: awsDeploy.serverless.service.package.artifactDirectoryName,
        })
      ).to.be.rejectedWith(streamError);
    });

    it('should upload the .zip file to a bucket with SSE bucket policy', async () => {
      cryptoStub.read.onCall(0).returns('local-hash-zip-file');

      const tmpDirPath = getTmpDirPath();
      const artifactFilePath = path.join(tmpDirPath, 'artifact.zip');
      serverless.utils.writeFileSync(artifactFilePath, 'artifact.zip file content');
      awsDeploy.serverless.service.provider.deploymentBucketObject = {
        serverSideEncryption: 'AES256',
      };

      return awsDeploy
        .uploadZipFile({
          filename: artifactFilePath,
          s3KeyDirname: awsDeploy.serverless.service.package.artifactDirectoryName,
        })
        .then(() => {
          expect(uploadStub).to.have.been.calledOnce;
          expect(readFileSyncStub).to.not.have.been.called;
          expect(getUploadParams(uploadStub)).to.deep.include({
            Bucket: awsDeploy.bucketName,
            Key: `${awsDeploy.serverless.service.package.artifactDirectoryName}/artifact.zip`,
            ContentType: 'application/zip',
            ServerSideEncryption: 'AES256',
            Metadata: {
              filesha256: 'local-hash-zip-file',
            },
          });
          expect(getUploadParams(uploadStub).Body.path).to.equal(artifactFilePath);
        });
    });

    it('should upload the .zip file with SSE-C encryption options', async () => {
      cryptoStub.read.onCall(0).returns('local-hash-zip-file');

      const tmpDirPath = getTmpDirPath();
      const artifactFilePath = path.join(tmpDirPath, 'artifact.zip');
      serverless.utils.writeFileSync(artifactFilePath, 'artifact.zip file content');
      awsDeploy.serverless.service.provider.deploymentBucketObject = {
        sseCustomerAlgorithim: 'AES256',
        sseCustomerKey: 'customer-key',
        sseCustomerKeyMD5: 'customer-key-md5',
      };

      await awsDeploy.uploadZipFile({
        filename: artifactFilePath,
        s3KeyDirname: awsDeploy.serverless.service.package.artifactDirectoryName,
      });

      const uploadParams = getUploadParams(uploadStub);
      expect({
        ...uploadParams,
        Body: uploadParams.Body.path,
      }).to.deep.equal({
        Bucket: awsDeploy.bucketName,
        Key: `${awsDeploy.serverless.service.package.artifactDirectoryName}/artifact.zip`,
        Body: artifactFilePath,
        ContentLength: 25,
        ContentType: 'application/zip',
        Metadata: {
          filesha256: 'local-hash-zip-file',
        },
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: 'customer-key',
        SSECustomerKeyMD5: 'customer-key-md5',
      });
    });

    it('should normalize zip upload errors', async () => {
      const error = createAwsError('AccessDenied');
      crypto.createHash().update().digest.onCall(0).returns('local-hash-zip-file');

      const tmpDirPath = getTmpDirPath();
      const artifactFilePath = path.join(tmpDirPath, 'artifact.zip');
      serverless.utils.writeFileSync(artifactFilePath, 'artifact.zip file content');
      uploadStub.rejects(error);

      await expectNormalizedUploadError(
        awsDeploy.uploadZipFile({
          filename: artifactFilePath,
          s3KeyDirname: awsDeploy.serverless.service.package.artifactDirectoryName,
        }),
        error
      );
    });
  });

  describe('#uploadFunctionsAndLayers()', () => {
    let uploadZipFileStub;

    beforeEach(async () => {
      sinon.stub(fs.promises, 'stat').resolves({ size: 1024 });
      uploadZipFileStub = sinon.stub(awsDeploy, 'uploadZipFile').resolves();
    });

    afterEach(async () => {
      fs.promises.stat.restore();
      uploadZipFileStub.restore();
    });

    it('should upload the service artifact file to the S3 bucket', async () => {
      awsDeploy.serverless.serviceDir = 'some/path';
      awsDeploy.serverless.service.service = 'new-service';

      return awsDeploy.uploadFunctionsAndLayers().then(() => {
        expect(uploadZipFileStub.calledOnce).to.be.equal(true);
        const expectedPath = path.join('foo', '.serverless', 'new-service.zip');
        expect(uploadZipFileStub.args[0][0].filename).to.be.equal(expectedPath);
      });
    });

    it('should upload a single .zip file to the S3 bucket when not packaging individually', async () => {
      awsDeploy.serverless.service.functions = {
        first: {
          package: {
            artifact: 'artifact.zip',
          },
        },
        second: {
          package: {
            artifact: 'artifact.zip',
          },
        },
      };

      return awsDeploy.uploadFunctionsAndLayers().then(() => {
        expect(uploadZipFileStub.calledOnce).to.be.equal(true);
        expect(uploadZipFileStub.args[0][0].filename).to.be.equal('artifact.zip');
      });
    });

    it('should upload the function .zip files to the S3 bucket', async () => {
      awsDeploy.serverless.service.package.individually = true;
      awsDeploy.serverless.service.functions = {
        first: {
          package: {
            artifact: 'first-artifact.zip',
          },
        },
        second: {
          package: {
            artifact: 'second-artifact.zip',
          },
        },
      };

      return awsDeploy.uploadFunctionsAndLayers().then(() => {
        expect(uploadZipFileStub.calledTwice).to.be.equal(true);
        expect(uploadZipFileStub.args[0][0].filename).to.be.equal(
          awsDeploy.serverless.service.functions.first.package.artifact
        );
        expect(uploadZipFileStub.args[1][0].filename).to.be.equal(
          awsDeploy.serverless.service.functions.second.package.artifact
        );
      });
    });

    it('should upload single function artifact and service artifact', async () => {
      awsDeploy.serverless.service.package.artifact = 'second-artifact.zip';
      awsDeploy.serverless.service.functions = {
        first: {
          handler: 'bar',
          package: {
            artifact: 'first-artifact.zip',
            individually: true,
          },
        },
        second: {
          handler: 'foo',
        },
      };

      return awsDeploy.uploadFunctionsAndLayers().then(() => {
        expect(uploadZipFileStub.calledTwice).to.be.equal(true);
        expect(uploadZipFileStub.args[0][0].filename).to.be.equal(
          awsDeploy.serverless.service.functions.first.package.artifact
        );
        expect(uploadZipFileStub.args[1][0].filename).to.be.equal(
          awsDeploy.serverless.service.package.artifact
        );
      });
    });
  });

  describe('#uploadCustomResources()', () => {
    let uploadStub;
    let serviceDirPath;
    let customResourcesFilePath;

    beforeEach(() => {
      uploadStub = sinon.stub(Upload.prototype, 'done').resolves();
      serviceDirPath = createTmpDir();
      customResourcesFilePath = path.join(serviceDirPath, '.serverless', 'custom-resources.zip');
      // Ensure no file stream is created, as the stubbed upload does not consume it.
      // File stream points file in temporary home folder which is cleaned after this test file is run.
      // There were observed race conditions where this temporary home folder was cleaned
      // before stream initialized fully, hence throwing uncaught ENOENT exception into the air.
      sinon.stub(fs, 'createReadStream').callsFake(() => {
        const stream = new PassThrough();
        stream.path = customResourcesFilePath;
        process.nextTick(() => stream.end());
        return stream;
      });
      serverless.serviceDir = serviceDirPath;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should not attempt to upload a custom resources if the artifact does not exist', async () => {
      return expect(awsDeploy.uploadCustomResources()).to.eventually.be.fulfilled.then(() => {
        expect(uploadStub).not.to.be.calledOnce;
      });
    });

    it('should upload the custom resources .zip file to the S3 bucket', async () => {
      ensureFileSync(customResourcesFilePath);

      cryptoStub.read.onCall(0).returns('local-hash-zip-file');

      return expect(awsDeploy.uploadCustomResources()).to.eventually.be.fulfilled.then(() => {
        expect(uploadStub).to.have.been.calledOnce;
        expect(getUploadParams(uploadStub)).to.deep.include({
          Bucket: awsDeploy.bucketName,
          Key: `${awsDeploy.serverless.service.package.artifactDirectoryName}/custom-resources.zip`,
          ContentType: 'application/zip',
          Metadata: {
            filesha256: 'local-hash-zip-file',
          },
        });
        expect(getUploadParams(uploadStub).Body.path).to.equal(customResourcesFilePath);
      });
    });

    it('should configure S3 transfer acceleration for custom resources uploads', async () => {
      ensureFileSync(customResourcesFilePath);
      cryptoStub.read.onCall(0).returns('local-hash-zip-file');
      awsDeploy.provider.options['aws-s3-accelerate'] = true;

      await awsDeploy.uploadCustomResources();

      expect(uploadStub).to.have.been.calledOnce;
      expect(uploadStub.firstCall.thisValue.client.config.useAccelerateEndpoint).to.equal(true);
    });

    it('should upload custom resources with SSE bucket policy', async () => {
      ensureFileSync(customResourcesFilePath);
      cryptoStub.read.onCall(0).returns('local-hash-zip-file');
      awsDeploy.serverless.service.provider.deploymentBucketObject = {
        serverSideEncryption: 'AES256',
      };

      await awsDeploy.uploadCustomResources();

      expect(uploadStub).to.have.been.calledOnce;
      expect(getUploadParams(uploadStub)).to.deep.include({
        Bucket: awsDeploy.bucketName,
        Key: `${awsDeploy.serverless.service.package.artifactDirectoryName}/custom-resources.zip`,
        ContentType: 'application/zip',
        ServerSideEncryption: 'AES256',
        Metadata: {
          filesha256: 'local-hash-zip-file',
        },
      });
      expect(getUploadParams(uploadStub).Body.path).to.equal(customResourcesFilePath);
    });
  });
});

describe('test/unit/lib/plugins/aws/deploy/lib/upload-artifacts.test.js', () => {
  it('should upload state file', async () => {
    const uploadStub = sinon.stub().resolves({});
    const { awsNaming } = await runServerless({
      fixture: 'function',
      command: 'deploy',
      lastLifecycleHookName: 'aws:deploy:deploy:uploadArtifacts',
      awsSdkV3StubMap: {
        CloudFormation: {
          describeStacks: { Stacks: [{}] },
          describeStackResource: {
            StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
          },
        },
        Lambda: {
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
            },
          },
        },
        S3: {
          headObject: {
            Metadata: { filesha256: 'RRYyTm4Ri8mocpvx44pvas4JKLYtdJS3Z8MOlrZrDXA=' },
          },
          listObjectsV2: {
            Contents: [
              {
                Key: 'serverless/test-package-artifact/dev/1589988704359-2020-05-20T15:31:44.359Z/artifact.zip',
                LastModified: new Date(),
                ETag: '"5102a4cf710cae6497dba9e61b85d0a4"',
                Size: 356,
                StorageClass: 'STANDARD',
              },
            ],
          },
          headBucket: {},
          upload: uploadStub,
        },
        STS: {
          getCallerIdentity: {
            ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
            UserId: 'XXXXXXXXXXXXXXXXXXXXX',
            Account: '999999999999',
            Arn: 'arn:aws:iam::999999999999:user/test',
          },
        },
      },
    });

    const [statePayload] = uploadStub.args.find(([params]) =>
      params.Key.endsWith(awsNaming.getServiceStateFileName())
    );
    expect(statePayload.Body.includes('"service":')).to.be.true;
    expect(statePayload.ContentType).to.equal('application/json');
  });
});
