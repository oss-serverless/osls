'use strict';

const sinon = require('sinon');
const chai = require('chai');
const proxyquire = require('proxyquire');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const cleanupS3BucketMixin = require('../../../../../../../lib/plugins/aws/deploy/lib/cleanup-s3-bucket');
const { retryOnThrottlingError } = require('../../../../../../../lib/aws/retry');

const fastRetry = {
  retryOnThrottlingError: (task, options) =>
    retryOnThrottlingError(task, { ...options, delayMs: 1 }),
};
const createThrottlingError = () =>
  Object.assign(new Error('Rate exceeded'), { name: 'Throttling' });
const cleanupS3BucketWithFastRetry = proxyquire(
  '../../../../../../../lib/plugins/aws/deploy/lib/cleanup-s3-bucket',
  { '../../../../aws/retry': fastRetry }
);

const expect = chai.expect;

describe('cleanupS3Bucket', () => {
  let serverless;
  let provider;
  let awsDeploy;
  let s3Key;
  let s3SendStub;
  let sandbox;

  const serviceName = 'cleanupS3Bucket';
  const stage = 'dev';
  const deploymentPrefix = 'serverless';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    serverless = {
      service: {
        service: serviceName,
        provider: {},
        package: {},
      },
    };
    provider = {
      getAwsSdkV3Config: async () => ({ region: 'us-east-1' }),
      getDeploymentPrefix: () => deploymentPrefix,
      getStage: () => stage,
      naming: {
        getServiceStateFileName: () => 'serverless-state.json',
      },
    };
    s3Key = `${deploymentPrefix}/${serviceName}/${stage}`;
    awsDeploy = {
      ...cleanupS3BucketMixin,
      bucketName: 'deployment-bucket',
      provider,
      serverless,
    };
    s3SendStub = sandbox.stub(S3Client.prototype, 'send');
  });

  const createSignatureMismatchListError = () => {
    const error = new Error('signature mismatch');
    error.providerError = {
      code: 'SignatureDoesNotMatch',
      statusCode: 403,
    };
    return error;
  };

  const createAccessDeniedListError = () => {
    const error = new Error('access denied');
    error.providerError = {
      code: 'AccessDenied',
      statusCode: 403,
    };
    return error;
  };

  const createStatusOnlyListError = () => {
    const error = new Error('forbidden');
    error.providerError = {
      statusCode: 403,
    };
    return error;
  };

  const createWrappedStatusOnlyListError = () => {
    const error = createStatusOnlyListError();
    error.code = 'AWS_S3_LIST_OBJECTS_V2_ERROR';
    return error;
  };

  afterEach(() => {
    sandbox.restore();
  });

  function expectListObjectsCall(call, input) {
    expect(call.args[0]).to.be.instanceOf(ListObjectsV2Command);
    expect(call.args[0].input).to.include(input);
  }

  function expectDeleteObjectsCall(call, input) {
    expect(call.args[0]).to.be.instanceOf(DeleteObjectsCommand);
    expect(call.args[0].input).to.deep.equal(input);
  }

  it('reuses one S3 client across cleanup list and delete steps', async () => {
    const s3Clients = [];
    class FakeCommand {
      constructor(input) {
        this.input = input;
      }
    }
    class FakeListObjectsV2Command extends FakeCommand {}
    class FakeDeleteObjectsCommand extends FakeCommand {}
    class FakeS3Client {
      constructor(config) {
        this.config = config;
        s3Clients.push(this);
      }

      async send(command) {
        if (command instanceof FakeListObjectsV2Command) {
          return {
            Contents: Array.from({ length: 6 }, (_, index) => ({
              Key: `${s3Key}/${1000000000000 + index}-2001-09-09T01:46:4${index}.000Z/artifact.zip`,
            })),
          };
        }
        if (command instanceof FakeDeleteObjectsCommand) return {};
        throw new Error(`Unexpected S3 command ${command.constructor.name}`);
      }
    }
    const cleanupS3BucketWithFakeS3 = proxyquire(
      '../../../../../../../lib/plugins/aws/deploy/lib/cleanup-s3-bucket',
      {
        '@aws-sdk/client-s3': {
          S3Client: FakeS3Client,
          DeleteObjectsCommand: FakeDeleteObjectsCommand,
          ListObjectsV2Command: FakeListObjectsV2Command,
        },
      }
    );
    Object.assign(awsDeploy, cleanupS3BucketWithFakeS3);

    const objectsToRemove = await awsDeploy.getObjectsToRemove();
    await awsDeploy.removeObjects(objectsToRemove);

    expect(objectsToRemove).to.have.length(1);
    expect(s3Clients).to.have.length(1);
  });

  describe('#getObjectsToRemove()', () => {
    it('should resolve if no objects are found', async () => {
      const serviceObjects = {
        Contents: [],
      };

      s3SendStub.resolves(serviceObjects);

      return awsDeploy.getObjectsToRemove().then(() => {
        expect(s3SendStub).to.have.been.calledOnce;
        expectListObjectsCall(s3SendStub.firstCall, {
          Bucket: awsDeploy.bucketName,
          Prefix: `${s3Key}/`,
        });
      });
    });

    it('should retry throttled list requests', async () => {
      s3SendStub.onFirstCall().rejects(createThrottlingError()).onSecondCall().resolves({});
      Object.assign(awsDeploy, cleanupS3BucketWithFastRetry);

      const objectsToRemove = await awsDeploy.getObjectsToRemove();

      expect(objectsToRemove).to.deep.equal([]);
      expect(s3SendStub).to.have.been.calledTwice;
      expectListObjectsCall(s3SendStub.secondCall, {
        Bucket: awsDeploy.bucketName,
        Prefix: `${s3Key}/`,
      });
    });

    it('should return all service objects except the default preserved deployments', async () => {
      const deploymentDirectories = [
        '1000000000000-2001-09-09T01:46:40.000Z',
        '1000000001000-2001-09-09T01:46:41.000Z',
        '1000000002000-2001-09-09T01:46:42.000Z',
        '1000000003000-2001-09-09T01:46:43.000Z',
        '1000000004000-2001-09-09T01:46:44.000Z',
        '1000000005000-2001-09-09T01:46:45.000Z',
      ];
      const serviceObjects = {
        Contents: deploymentDirectories.flatMap((directory) => [
          { Key: `${s3Key}/${directory}/artifact.zip` },
          { Key: `${s3Key}/${directory}/cloudformation.json` },
        ]),
      };

      s3SendStub.resolves(serviceObjects);

      return awsDeploy.getObjectsToRemove().then((objectsToRemove) => {
        expect(objectsToRemove).to.deep.equal([
          { Key: `${s3Key}/${deploymentDirectories[0]}/artifact.zip` },
          { Key: `${s3Key}/${deploymentDirectories[0]}/cloudformation.json` },
        ]);
        expect(s3SendStub.calledOnce).to.be.equal(true);
        expectListObjectsCall(s3SendStub.firstCall, {
          Bucket: awsDeploy.bucketName,
          Prefix: `${s3Key}/`,
        });
      });
    });

    it('should not rewrite specific S3 list authentication failures', async () => {
      const listError = createSignatureMismatchListError();
      s3SendStub.rejects(listError);

      try {
        await awsDeploy.getObjectsToRemove();
        throw new Error('Expected getObjectsToRemove to reject');
      } catch (error) {
        expect(error).to.equal(listError);
      } finally {
        expect(s3SendStub).to.have.been.calledOnce;
      }
    });

    it('should rewrite status-only S3 list access denied failures', async () => {
      const listError = createStatusOnlyListError();
      s3SendStub.rejects(listError);

      try {
        await expect(awsDeploy.getObjectsToRemove()).to.be.eventually.rejected.and.have.property(
          'code',
          'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED'
        );
      } finally {
        expect(s3SendStub).to.have.been.calledOnce;
      }
    });

    it('should rewrite wrapped status-only S3 list access denied failures', async () => {
      const listError = createWrappedStatusOnlyListError();
      s3SendStub.rejects(listError);

      try {
        await expect(awsDeploy.getObjectsToRemove()).to.be.eventually.rejected.and.have.property(
          'code',
          'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED'
        );
      } finally {
        expect(s3SendStub).to.have.been.calledOnce;
      }
    });

    it('should rewrite explicit S3 list access denied failures', async () => {
      const listError = createAccessDeniedListError();
      s3SendStub.rejects(listError);

      try {
        await expect(awsDeploy.getObjectsToRemove()).to.be.eventually.rejected.and.have.property(
          'code',
          'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED'
        );
      } finally {
        expect(s3SendStub).to.have.been.calledOnce;
      }
    });

    it('should list all paginated deployment objects before selecting objects to remove', async () => {
      serverless.service.provider.deploymentBucketObject = {
        maxPreviousDeploymentArtifacts: 1,
      };
      const oldKey = `${s3Key}/141264711231-2016-08-18T15:43:00/artifact.zip`;
      const newKey = `${s3Key}/151224711231-2016-08-18T15:42:00/artifact.zip`;
      s3SendStub
        .onFirstCall()
        .resolves({
          Contents: [{ Key: oldKey }],
          NextContinuationToken: 'next-page',
        })
        .onSecondCall()
        .resolves({
          Contents: [{ Key: newKey }],
        });

      try {
        const objectsToRemove = await awsDeploy.getObjectsToRemove();

        expect(objectsToRemove).to.deep.equal([{ Key: oldKey }]);
        expect(s3SendStub).to.have.been.calledTwice;
        expectListObjectsCall(s3SendStub.firstCall, {
          Bucket: awsDeploy.bucketName,
          Prefix: `${s3Key}/`,
        });
        expectListObjectsCall(s3SendStub.secondCall, {
          Bucket: awsDeploy.bucketName,
          Prefix: `${s3Key}/`,
          ContinuationToken: 'next-page',
        });
      } finally {
        delete serverless.service.provider.deploymentBucketObject;
      }
    });

    it('should return an empty array if there are less than 4 directories available', async () => {
      const serviceObjects = {
        Contents: [
          { Key: `${s3Key}/151224711231-2016-08-18T15:42:00/artifact.zip` },
          { Key: `${s3Key}/151224711231-2016-08-18T15:42:00/cloudformation.json` },
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json` },
          { Key: `${s3Key}/141321321541-2016-08-18T11:23:02/artifact.zip` },
          { Key: `${s3Key}/141321321541-2016-08-18T11:23:02/cloudformation.json` },
        ],
      };

      s3SendStub.resolves(serviceObjects);

      return awsDeploy.getObjectsToRemove().then((objectsToRemove) => {
        expect(objectsToRemove.length).to.equal(0);
        expect(s3SendStub.calledOnce).to.be.equal(true);
        expectListObjectsCall(s3SendStub.firstCall, {
          Bucket: awsDeploy.bucketName,
          Prefix: `${s3Key}/`,
        });
      });
    });

    it('should return an empty array if there are exactly 4 directories available', async () => {
      const serviceObjects = {
        Contents: [
          { Key: `${s3Key}/151224711231-2016-08-18T15:42:00/artifact.zip` },
          { Key: `${s3Key}/151224711231-2016-08-18T15:42:00/cloudformation.json` },
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json` },
          { Key: `${s3Key}/141321321541-2016-08-18T11:23:02/artifact.zip` },
          { Key: `${s3Key}/141321321541-2016-08-18T11:23:02/cloudformation.json` },
          { Key: `${s3Key}/142003031341-2016-08-18T12:46:04/artifact.zip` },
          { Key: `${s3Key}/142003031341-2016-08-18T12:46:04/cloudformation.json` },
        ],
      };

      s3SendStub.resolves(serviceObjects);

      return awsDeploy.getObjectsToRemove().then((objectsToRemove) => {
        expect(objectsToRemove).to.have.lengthOf(0);
        expect(s3SendStub).to.have.been.calledOnce;
        expectListObjectsCall(s3SendStub.firstCall, {
          Bucket: awsDeploy.bucketName,
          Prefix: `${s3Key}/`,
        });
      });
    });

    describe('custom maxPreviousDeploymentArtifacts', () => {
      afterEach(() => {
        // restore to not conflict with other tests
        delete serverless.service.provider.deploymentBucketObject;
      });

      it('should allow configuring the number of artifacts to preserve', async () => {
        // configure the provider to allow only a single artifact
        serverless.service.provider.deploymentBucketObject = {
          maxPreviousDeploymentArtifacts: 1,
        };

        const serviceObjects = {
          Contents: [
            { Key: `${s3Key}/141321321541-2016-08-18T11:23:02/artifact.zip` },
            { Key: `${s3Key}/141321321541-2016-08-18T11:23:02/cloudformation.json` },
            { Key: `${s3Key}/151224711231-2016-08-18T15:42:00/artifact.zip` },
            { Key: `${s3Key}/151224711231-2016-08-18T15:42:00/cloudformation.json` },
            { Key: `${s3Key}/141264711231-2016-08-18T15:43:00/artifact.zip` },
            { Key: `${s3Key}/141264711231-2016-08-18T15:43:00/cloudformation.json` },
          ],
        };

        s3SendStub.resolves(serviceObjects);

        return awsDeploy.getObjectsToRemove().then((objectsToRemove) => {
          expect(objectsToRemove).to.deep.include.members([
            { Key: `${s3Key}/141321321541-2016-08-18T11:23:02/artifact.zip` },
            { Key: `${s3Key}/141321321541-2016-08-18T11:23:02/cloudformation.json` },
            { Key: `${s3Key}/151224711231-2016-08-18T15:42:00/artifact.zip` },
            { Key: `${s3Key}/151224711231-2016-08-18T15:42:00/cloudformation.json` },
          ]);

          expect(objectsToRemove).to.not.deep.include({
            Key: `${s3Key}/141264711231-2016-08-18T15:43:00/artifact.zip`,
          });

          expect(objectsToRemove).to.not.deep.include({
            Key: `${s3Key}/141264711231-2016-08-18T15:43:00/cloudformation.json`,
          });

          expect(s3SendStub.calledOnce).to.be.equal(true);
          expectListObjectsCall(s3SendStub.firstCall, {
            Bucket: awsDeploy.bucketName,
            Prefix: `${s3Key}/`,
          });
        });
      });

      it('should preserve zero when configuring the number of artifacts to preserve', async () => {
        serverless.service.provider.deploymentBucketObject = {
          maxPreviousDeploymentArtifacts: 0,
        };

        const serviceObjects = {
          Contents: [
            { Key: `${s3Key}/141321321541-2016-08-18T11:23:02/artifact.zip` },
            { Key: `${s3Key}/141321321541-2016-08-18T11:23:02/cloudformation.json` },
            { Key: `${s3Key}/151224711231-2016-08-18T15:42:00/artifact.zip` },
            { Key: `${s3Key}/151224711231-2016-08-18T15:42:00/cloudformation.json` },
            { Key: `${s3Key}/141264711231-2016-08-18T15:43:00/artifact.zip` },
            { Key: `${s3Key}/141264711231-2016-08-18T15:43:00/cloudformation.json` },
          ],
        };

        s3SendStub.resolves(serviceObjects);

        return awsDeploy.getObjectsToRemove().then((objectsToRemove) => {
          expect(objectsToRemove).to.deep.equal(serviceObjects.Contents);

          expect(s3SendStub.calledOnce).to.be.equal(true);
          expectListObjectsCall(s3SendStub.firstCall, {
            Bucket: awsDeploy.bucketName,
            Prefix: `${s3Key}/`,
          });
        });
      });
    });
  });

  describe('#removeObjects()', () => {
    it('should resolve if no service objects are found in the S3 bucket', async () =>
      awsDeploy.removeObjects().then(() => {
        expect(s3SendStub.calledOnce).to.be.equal(false);
      }));

    it('should remove all old service files from the S3 bucket if available', async () => {
      const objectsToRemove = [
        { Key: `${s3Key}/113304333331-2016-08-18T13:40:06/artifact.zip` },
        { Key: `${s3Key}/113304333331-2016-08-18T13:40:06/cloudformation.json` },
        { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
        { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json` },
      ];
      s3SendStub.resolves();

      return awsDeploy.removeObjects(objectsToRemove).then(() => {
        expect(s3SendStub).to.have.been.calledOnce;
        expectDeleteObjectsCall(s3SendStub.firstCall, {
          Bucket: awsDeploy.bucketName,
          Delete: {
            Objects: objectsToRemove,
          },
        });
      });
    });

    it('should retry throttled delete requests', async () => {
      const objectsToRemove = [{ Key: `${s3Key}/113304333331-2016-08-18T13:40:06/artifact.zip` }];
      s3SendStub.onFirstCall().rejects(createThrottlingError()).onSecondCall().resolves({});
      Object.assign(awsDeploy, cleanupS3BucketWithFastRetry);

      await awsDeploy.removeObjects(objectsToRemove);

      expect(s3SendStub).to.have.been.calledTwice;
      expectDeleteObjectsCall(s3SendStub.secondCall, {
        Bucket: awsDeploy.bucketName,
        Delete: { Objects: objectsToRemove },
      });
    });

    it('uses an existing S3 client promise from the plugin context', async () => {
      const send = sinon.stub().resolves({});
      sinon
        .stub(awsDeploy.provider, 'getAwsSdkV3Config')
        .throws(new Error('Expected existing S3 client to be reused'));
      awsDeploy.s3ClientPromise = Promise.resolve({ send });

      try {
        await awsDeploy.removeObjects([{ Key: 'first' }]);

        expect(awsDeploy.provider.getAwsSdkV3Config).to.not.have.been.called;
        expect(send).to.have.been.calledOnce;
        expect(send.firstCall.args[0]).to.be.instanceOf(DeleteObjectsCommand);
        expect(send.firstCall.args[0].input).to.deep.equal({
          Bucket: 'deployment-bucket',
          Delete: { Objects: [{ Key: 'first' }] },
        });
      } finally {
        awsDeploy.provider.getAwsSdkV3Config.restore();
      }
    });

    it('should remove service files in batches of 1000 objects', async () => {
      const objectsToRemove = Array.from({ length: 1001 }, (ignored, index) => ({
        Key: `${s3Key}/artifact-${index}.zip`,
      }));
      s3SendStub.resolves();

      await awsDeploy.removeObjects(objectsToRemove);

      expect(s3SendStub).to.have.been.calledTwice;
      expectDeleteObjectsCall(s3SendStub.firstCall, {
        Bucket: awsDeploy.bucketName,
        Delete: {
          Objects: objectsToRemove.slice(0, 1000),
        },
      });
      expectDeleteObjectsCall(s3SendStub.secondCall, {
        Bucket: awsDeploy.bucketName,
        Delete: {
          Objects: objectsToRemove.slice(1000),
        },
      });
    });

    it('should fail when a delete objects batch returns a generic partial failure', async () => {
      s3SendStub.resolves({
        Errors: [{ Code: 'InternalError' }],
      });

      await expect(
        awsDeploy.removeObjects([{ Key: `${s3Key}/artifact.zip` }])
      ).to.be.eventually.rejected.and.have.property('code', 'CANNOT_DELETE_S3_OBJECTS_GENERIC');
    });

    it('should fail when a delete objects batch returns an access denied partial failure', async () => {
      s3SendStub.resolves({
        Errors: [{ Code: 'AccessDenied' }],
      });

      await expect(
        awsDeploy.removeObjects([{ Key: `${s3Key}/artifact.zip` }])
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'CANNOT_DELETE_S3_OBJECTS_ACCESS_DENIED'
      );
    });

    it('should treat delete object errors with lowercase code property as access denied failures', async () => {
      s3SendStub.resolves({
        Errors: [{ code: 'AccessDenied' }],
      });

      await expect(
        awsDeploy.removeObjects([{ Key: `${s3Key}/artifact.zip` }])
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'CANNOT_DELETE_S3_OBJECTS_ACCESS_DENIED'
      );
    });

    it('should treat SDK v3 access denied delete object error names as access denied failures', async () => {
      s3SendStub.resolves({
        Errors: [{ name: 'AccessDenied' }],
      });

      await expect(
        awsDeploy.removeObjects([{ Key: `${s3Key}/artifact.zip` }])
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'CANNOT_DELETE_S3_OBJECTS_ACCESS_DENIED'
      );
    });

    it('should not treat inherited delete object error codes as access denied failures', async () => {
      s3SendStub.resolves({
        Errors: [Object.create({ Code: 'AccessDenied' })],
      });

      await expect(
        awsDeploy.removeObjects([{ Key: `${s3Key}/artifact.zip` }])
      ).to.be.eventually.rejected.and.have.property('code', 'CANNOT_DELETE_S3_OBJECTS_GENERIC');
    });
  });

  describe('#cleanupArtifactsForEmptyChangeSet()', () => {
    it('should remove artifacts from all listed pages', async () => {
      const deploymentDirectory = '151224711231-2016-08-18T15:42:00';
      const firstKey = `${s3Key}/${deploymentDirectory}/artifact.zip`;
      const secondKey = `${s3Key}/${deploymentDirectory}/compiled-cloudformation-template.json`;
      awsDeploy.serverless.service.package.artifactDirectoryName = `${s3Key}/${deploymentDirectory}`;
      s3SendStub
        .onFirstCall()
        .resolves({
          Contents: [{ Key: firstKey }],
          NextContinuationToken: 'next-page',
        })
        .onSecondCall()
        .resolves({ Contents: [{ Key: secondKey }] });
      s3SendStub.onThirdCall().resolves();

      await awsDeploy.cleanupArtifactsForEmptyChangeSet();

      expectListObjectsCall(s3SendStub.firstCall, {
        Bucket: awsDeploy.bucketName,
        Prefix: `${s3Key}/${deploymentDirectory}/`,
      });
      expectListObjectsCall(s3SendStub.secondCall, {
        Bucket: awsDeploy.bucketName,
        Prefix: `${s3Key}/${deploymentDirectory}/`,
        ContinuationToken: 'next-page',
      });
      expectDeleteObjectsCall(s3SendStub.thirdCall, {
        Bucket: awsDeploy.bucketName,
        Delete: {
          Objects: [{ Key: firstKey }, { Key: secondKey }],
        },
      });
    });

    it('should list only the selected deployment directory', async () => {
      const deploymentDirectory = '151224711231-2016-08-18T15:42:00';
      const artifactDirectoryName = `${s3Key}/${deploymentDirectory}`;
      const artifactKey = `${artifactDirectoryName}/artifact.zip`;
      awsDeploy.serverless.service.package.artifactDirectoryName = artifactDirectoryName;
      s3SendStub.onFirstCall().resolves({
        Contents: [{ Key: artifactKey }],
      });
      s3SendStub.onSecondCall().resolves();

      await awsDeploy.cleanupArtifactsForEmptyChangeSet();

      expectListObjectsCall(s3SendStub.firstCall, {
        Bucket: awsDeploy.bucketName,
        Prefix: `${artifactDirectoryName}/`,
      });
    });

    it('should not rewrite specific empty-changeset S3 list authentication failures', async () => {
      const deploymentDirectory = '151224711231-2016-08-18T15:42:00';
      const listError = createSignatureMismatchListError();
      awsDeploy.serverless.service.package.artifactDirectoryName = `${s3Key}/${deploymentDirectory}`;
      s3SendStub.rejects(listError);

      try {
        await awsDeploy.cleanupArtifactsForEmptyChangeSet();
        throw new Error('Expected cleanupArtifactsForEmptyChangeSet to reject');
      } catch (error) {
        expect(error).to.equal(listError);
      } finally {
        expect(s3SendStub).to.have.been.calledOnce;
      }
    });

    it('should rewrite status-only empty-changeset S3 list access denied failures', async () => {
      const deploymentDirectory = '151224711231-2016-08-18T15:42:00';
      const listError = createStatusOnlyListError();
      awsDeploy.serverless.service.package.artifactDirectoryName = `${s3Key}/${deploymentDirectory}`;
      s3SendStub.rejects(listError);

      try {
        await expect(
          awsDeploy.cleanupArtifactsForEmptyChangeSet()
        ).to.be.eventually.rejected.and.have.property(
          'code',
          'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED'
        );
      } finally {
        expect(s3SendStub).to.have.been.calledOnce;
      }
    });

    it('should rewrite wrapped status-only empty-changeset S3 list access denied failures', async () => {
      const deploymentDirectory = '151224711231-2016-08-18T15:42:00';
      const listError = createWrappedStatusOnlyListError();
      awsDeploy.serverless.service.package.artifactDirectoryName = `${s3Key}/${deploymentDirectory}`;
      s3SendStub.rejects(listError);

      try {
        await expect(
          awsDeploy.cleanupArtifactsForEmptyChangeSet()
        ).to.be.eventually.rejected.and.have.property(
          'code',
          'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED'
        );
      } finally {
        expect(s3SendStub).to.have.been.calledOnce;
      }
    });

    for (const { description, resolveArtifactDirectoryName } of [
      {
        description: 'the artifact directory is the stage deployment root',
        resolveArtifactDirectoryName: () => s3Key,
      },
      {
        description: 'the artifact directory is the stage deployment root with a trailing slash',
        resolveArtifactDirectoryName: () => `${s3Key}/`,
      },
      {
        description: 'the artifact directory is not a deployment directory',
        resolveArtifactDirectoryName: () => `${s3Key}/not-a-deployment-directory`,
      },
      {
        description: 'the artifact directory is nested below a deployment directory',
        resolveArtifactDirectoryName: () => `${s3Key}/151224711231-2016-08-18T15:42:00/nested`,
      },
    ]) {
      it(`should reject when ${description}`, async () => {
        awsDeploy.serverless.service.package.artifactDirectoryName = resolveArtifactDirectoryName();

        await expect(
          awsDeploy.cleanupArtifactsForEmptyChangeSet()
        ).to.be.eventually.rejected.and.have.property(
          'code',
          'INVALID_EMPTY_CHANGE_SET_ARTIFACT_DIRECTORY'
        );
        expect(s3SendStub).to.not.have.been.called;
      });
    }

    it('should normalize trailing slashes for a selected deployment directory', async () => {
      const deploymentDirectory = '151224711231-2016-08-18T15:42:00';
      const artifactDirectoryName = `${s3Key}/${deploymentDirectory}`;
      const artifactKey = `${artifactDirectoryName}/artifact.zip`;
      awsDeploy.serverless.service.package.artifactDirectoryName = `${artifactDirectoryName}/`;
      s3SendStub.onFirstCall().resolves({
        Contents: [{ Key: artifactKey }],
      });
      s3SendStub.onSecondCall().resolves();

      await awsDeploy.cleanupArtifactsForEmptyChangeSet();

      expectListObjectsCall(s3SendStub.firstCall, {
        Bucket: awsDeploy.bucketName,
        Prefix: `${artifactDirectoryName}/`,
      });
    });

    it('should not rewrite delete failures as list failures', async () => {
      const deploymentDirectory = '151224711231-2016-08-18T15:42:00';
      const artifactKey = `${s3Key}/${deploymentDirectory}/artifact.zip`;
      const deleteError = new Error('delete denied');
      deleteError.statusCode = 403;
      awsDeploy.serverless.service.package.artifactDirectoryName = `${s3Key}/${deploymentDirectory}`;
      s3SendStub.onFirstCall().resolves({
        Contents: [{ Key: artifactKey }],
      });
      s3SendStub.onSecondCall().rejects(deleteError);

      try {
        await awsDeploy.cleanupArtifactsForEmptyChangeSet();
        throw new Error('Expected cleanupArtifactsForEmptyChangeSet to reject');
      } catch (error) {
        expect(error).to.equal(deleteError);
      }
    });
  });

  describe('#cleanupS3Bucket()', () => {
    it('should run promise chain in order', async () => {
      const getObjectsToRemoveStub = sinon.stub(awsDeploy, 'getObjectsToRemove').resolves();
      const removeObjectsStub = sinon.stub(awsDeploy, 'removeObjects').resolves();

      return awsDeploy.cleanupS3Bucket().then(() => {
        expect(getObjectsToRemoveStub.calledOnce).to.be.equal(true);
        expect(removeObjectsStub.calledAfter(getObjectsToRemoveStub)).to.be.equal(true);

        awsDeploy.getObjectsToRemove.restore();
        awsDeploy.removeObjects.restore();
      });
    });
  });
});
