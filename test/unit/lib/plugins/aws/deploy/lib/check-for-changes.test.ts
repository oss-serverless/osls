'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const glob = require('../../../../../../../lib/utils/glob');
const sandbox = require('sinon');
const proxyquire = require('proxyquire');
const normalizeFiles = require('../../../../../../../lib/plugins/aws/lib/normalize-files');
const AwsProvider = require('../../../../../../../lib/plugins/aws/provider');
const AwsDeploy = require('../../../../../../../lib/plugins/aws/deploy/index');
const Serverless = require('../../../../../../../lib/serverless');
const ServerlessError = require('../../../../../../../lib/serverless-error');
const runServerless = require('../../../../../../utils/run-serverless');
const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { LambdaClient, GetFunctionCommand } = require('@aws-sdk/client-lambda');
const {
  CloudWatchLogsClient,
  DeleteSubscriptionFilterCommand,
  DescribeSubscriptionFiltersCommand,
} = require('@aws-sdk/client-cloudwatch-logs');
const {
  CloudFormationClient,
  DescribeStackResourceCommand,
} = require('@aws-sdk/client-cloudformation');
const releasePendingRequestsUntilSettled = require('../../../../../../utils/release-pending-requests-until-settled');

const fsp = fs.promises;

// Configure chai
const expect = require('chai').expect;

function createAwsDeployTestInstance() {
  const options = {
    stage: 'dev',
    region: 'us-east-1',
  };
  const serverless = new Serverless({ commands: [], options: {} });
  const provider = new AwsProvider(serverless, options);
  serverless.setProvider('aws', provider);
  serverless.service.service = 'my-service';
  return new AwsDeploy(serverless, options);
}

async function waitForPendingRequests(pendingResolvers, count) {
  for (let index = 0; index < 20 && pendingResolvers.length < count; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  if (pendingResolvers.length < count) {
    throw new Error(
      `Timed out waiting for ${count} pending requests; observed ${pendingResolvers.length}`
    );
  }
}

describe('checkForChanges', () => {
  let serverless;
  let provider;
  let awsDeploy;
  let s3Key;
  let cryptoStub;
  let getHashForFilePathStub;

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    serverless = new Serverless({ commands: [], options: {} });
    serverless.serviceDir = 'my-service';
    provider = new AwsProvider(serverless, options);
    serverless.setProvider('aws', provider);
    serverless.service.service = 'my-service';
    serverless.service.provider.shouldNotDeploy = false;
    awsDeploy = new AwsDeploy(serverless, options);
    awsDeploy.bucketName = 'deployment-bucket';
    awsDeploy.serverless.service.provider.compiledCloudFormationTemplate = {
      foo: 'bar',
    };
    s3Key = `serverless/${serverless.service.service}/${provider.getStage()}`;
    cryptoStub = {
      createHash() {
        return this;
      },
      update() {
        return this;
      },
      digest: sandbox.stub(),
    };
    getHashForFilePathStub = sandbox
      .stub()
      .callsFake(async () => cryptoStub.createHash().update().digest('base64'));
    const checkForChanges = proxyquire(
      '../../../../../../../lib/plugins/aws/deploy/lib/check-for-changes.js',
      {
        'crypto': cryptoStub,
        '../../../../utils/get-hash-for-file-path': getHashForFilePathStub,
      }
    );
    Object.assign(awsDeploy, checkForChanges);
  });

  describe('#checkForChanges()', () => {
    let getMostRecentObjectsStub;
    let getObjectMetadataStub;
    let checkIfDeploymentIsNecessaryStub;
    let checkLogGroupSubscriptionFilterResourceLimitExceededStub;

    beforeEach(() => {
      getMostRecentObjectsStub = sandbox.stub(awsDeploy, 'getMostRecentObjects').resolves();
      getObjectMetadataStub = sandbox.stub(awsDeploy, 'getObjectMetadata').resolves();
      checkIfDeploymentIsNecessaryStub = sandbox
        .stub(awsDeploy, 'checkIfDeploymentIsNecessary')
        .resolves();
      checkLogGroupSubscriptionFilterResourceLimitExceededStub = sandbox
        .stub(awsDeploy, 'checkLogGroupSubscriptionFilterResourceLimitExceeded')
        .resolves();
    });

    afterEach(() => {
      awsDeploy.getMostRecentObjects.restore();
      awsDeploy.getObjectMetadata.restore();
      awsDeploy.checkIfDeploymentIsNecessary.restore();
      awsDeploy.checkLogGroupSubscriptionFilterResourceLimitExceeded.restore();
      checkLogGroupSubscriptionFilterResourceLimitExceededStub.restore();
    });

    it('should resolve if the "force" option is used', async () => {
      awsDeploy.options.force = true;

      return expect(awsDeploy.checkForChanges()).to.be.fulfilled.then(() => {
        expect(getMostRecentObjectsStub).to.not.have.been.called;
        expect(getObjectMetadataStub).to.not.have.been.called;
        expect(checkIfDeploymentIsNecessaryStub).to.not.have.been.called;

        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(false);
      });
    });

    it('should skip subscription filter checks when deployment is not required', async () => {
      checkIfDeploymentIsNecessaryStub.callsFake(async () => {
        awsDeploy.serverless.service.provider.shouldNotDeploy = true;
      });

      await awsDeploy.checkForChanges();

      expect(checkLogGroupSubscriptionFilterResourceLimitExceededStub).to.not.have.been.called;
    });
  });

  describe('#getMostRecentObjects()', () => {
    let listObjectsV2Stub;

    beforeEach(() => {
      listObjectsV2Stub = sandbox.stub(S3Client.prototype, 'send');
    });

    afterEach(() => {
      S3Client.prototype.send.restore();
    });

    it('should translate error if rejected due to missing bucket', () => {
      listObjectsV2Stub.rejects(new ServerlessError('The specified bucket does not exist'));

      return expect(awsDeploy.getMostRecentObjects()).to.be.rejectedWith(
        [
          `The serverless deployment bucket "${awsDeploy.bucketName}" does not exist.`,
          'Create it manually if you want to reuse the CloudFormation stack "my-service-dev",',
          'or delete the stack if it is no longer required.',
        ].join(' ')
      );
    });

    it('should throw original error if rejected not due to missing bucket', () => {
      listObjectsV2Stub.rejects(new ServerlessError('Other reason'));
      return expect(awsDeploy.getMostRecentObjects()).to.be.rejectedWith('Other reason');
    });

    it('should resolve if result array is empty', async () => {
      const serviceObjects = {
        Contents: [],
      };

      listObjectsV2Stub.resolves(serviceObjects);

      return expect(awsDeploy.getMostRecentObjects()).to.be.fulfilled.then((result) => {
        expect(listObjectsV2Stub.firstCall.args[0]).to.be.instanceOf(ListObjectsV2Command);
        expect(listObjectsV2Stub.firstCall.args[0].input).to.include({
          Bucket: awsDeploy.bucketName,
          Prefix: 'serverless/my-service/dev/',
        });
        expect(result).to.deep.equal([]);
      });
    });

    it('should resolve with the most recently deployed objects', async () => {
      const serviceObjects = {
        Contents: [
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json` },
        ],
      };

      listObjectsV2Stub.resolves(serviceObjects);

      return expect(awsDeploy.getMostRecentObjects()).to.be.fulfilled.then((result) => {
        expect(listObjectsV2Stub.firstCall.args[0]).to.be.instanceOf(ListObjectsV2Command);
        expect(listObjectsV2Stub.firstCall.args[0].input).to.include({
          Bucket: awsDeploy.bucketName,
          Prefix: 'serverless/my-service/dev/',
        });
        expect(result).to.deep.equal([
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
        ]);
      });
    });

    it('should select the newest deployment directory from unsorted keys', async () => {
      const serviceObjects = {
        Contents: [
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json` },
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
        ],
      };

      listObjectsV2Stub.resolves(serviceObjects);

      const result = await awsDeploy.getMostRecentObjects();

      expect(result).to.deep.equal([
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
      ]);
    });

    it('should select the newest deployment directory by timestamp', async () => {
      listObjectsV2Stub.resolves({
        Contents: [
          { Key: `${s3Key}/999-1970-01-01T00:00:00/artifact.zip` },
          { Key: `${s3Key}/1000-1970-01-01T00:00:01/artifact.zip` },
          { Key: `${s3Key}/999-1970-01-01T00:00:00/cloudformation.json` },
          { Key: `${s3Key}/1000-1970-01-01T00:00:01/cloudformation.json` },
        ],
      });

      const result = await awsDeploy.getMostRecentObjects();

      expect(result).to.deep.equal([
        { Key: `${s3Key}/1000-1970-01-01T00:00:01/cloudformation.json` },
        { Key: `${s3Key}/1000-1970-01-01T00:00:01/artifact.zip` },
      ]);
    });

    it('should select the newest deployment directory with a slash in deployment prefix', async () => {
      serverless.service.provider.deploymentPrefix = 'foo/bar';
      const customS3Key = `foo/bar/${serverless.service.service}/${provider.getStage()}`;
      listObjectsV2Stub.resolves({
        Contents: [
          { Key: `${customS3Key}/999-1970-01-01T00:00:00/artifact.zip` },
          { Key: `${customS3Key}/1000-1970-01-01T00:00:01/artifact.zip` },
          { Key: `${customS3Key}/999-1970-01-01T00:00:00/cloudformation.json` },
          { Key: `${customS3Key}/1000-1970-01-01T00:00:01/cloudformation.json` },
        ],
      });

      const result = await awsDeploy.getMostRecentObjects();

      expect(listObjectsV2Stub.firstCall.args[0]).to.be.instanceOf(ListObjectsV2Command);
      expect(listObjectsV2Stub.firstCall.args[0].input).to.include({
        Bucket: awsDeploy.bucketName,
        Prefix: 'foo/bar/my-service/dev/',
      });
      expect(result).to.deep.equal([
        { Key: `${customS3Key}/1000-1970-01-01T00:00:01/cloudformation.json` },
        { Key: `${customS3Key}/1000-1970-01-01T00:00:01/artifact.zip` },
      ]);
    });

    it('should ignore keys outside deployment timestamp directories', async () => {
      listObjectsV2Stub.resolves({
        Contents: [
          { Key: `${s3Key}/not-a-deploy-dir/artifact.zip` },
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
        ],
      });

      const result = await awsDeploy.getMostRecentObjects();

      expect(result).to.deep.equal([
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
      ]);
    });

    it('should select the newest deployment directory across paginated results', async () => {
      listObjectsV2Stub
        .onFirstCall()
        .resolves({
          Contents: [
            { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json` },
            { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
          ],
          NextContinuationToken: 'next-page',
        })
        .onSecondCall()
        .resolves({
          Contents: [
            { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
            { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
          ],
        });

      const result = await awsDeploy.getMostRecentObjects();

      expect(listObjectsV2Stub).to.have.been.calledTwice;
      expect(listObjectsV2Stub.secondCall.args[0].input).to.include({
        ContinuationToken: 'next-page',
      });
      expect(result).to.deep.equal([
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
      ]);
    });

    it('should collect the latest deployment directory when it is split across pages', async () => {
      listObjectsV2Stub
        .onFirstCall()
        .resolves({
          Contents: [
            { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
            { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
          ],
          NextContinuationToken: 'next-page',
        })
        .onSecondCall()
        .resolves({
          Contents: [
            { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
            { Key: `${s3Key}/not-a-deploy-dir/ignored.zip` },
          ],
        });

      const result = await awsDeploy.getMostRecentObjects();

      expect(listObjectsV2Stub).to.have.been.calledTwice;
      expect(result).to.deep.equal([
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
      ]);
    });

    it('should translate missing bucket errors from later pages', async () => {
      listObjectsV2Stub
        .onFirstCall()
        .resolves({ Contents: [], NextContinuationToken: 'next-page' })
        .onSecondCall()
        .rejects(new ServerlessError('The specified bucket does not exist'));

      let error;
      try {
        await awsDeploy.getMostRecentObjects();
      } catch (caughtError) {
        error = caughtError;
      }

      expect(listObjectsV2Stub).to.have.been.calledTwice;
      expect(listObjectsV2Stub.secondCall.args[0].input).to.include({
        ContinuationToken: 'next-page',
      });
      expect(error).to.have.property('code', 'DEPLOYMENT_BUCKET_DOES_NOT_EXIST');
      expect(error).to.have.property(
        'message',
        [
          `The serverless deployment bucket "${awsDeploy.bucketName}" does not exist.`,
          'Create it manually if you want to reuse the CloudFormation stack "my-service-dev",',
          'or delete the stack if it is no longer required.',
        ].join(' ')
      );
    });

    it('should discard older directories encountered after the latest directory', async () => {
      listObjectsV2Stub.resolves({
        Contents: [
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json` },
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
          { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
        ],
      });

      const result = await awsDeploy.getMostRecentObjects();

      expect(result).to.deep.equal([
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
      ]);
    });
  });

  describe('#getFunctionsEarliestLastModifiedDate()', () => {
    let requestStub;
    let getAllFunctionsStub;
    let getFunctionStub;

    beforeEach(() => {
      requestStub = sandbox.stub(LambdaClient.prototype, 'send');
      getAllFunctionsStub = sandbox.stub(awsDeploy.serverless.service, 'getAllFunctions');
      getFunctionStub = sandbox.stub(awsDeploy.serverless.service, 'getFunction');
    });

    afterEach(() => {
      LambdaClient.prototype.send.restore();
      awsDeploy.serverless.service.getAllFunctions.restore();
      awsDeploy.serverless.service.getFunction.restore();
    });

    it('returns the earliest function last modified date', async () => {
      getAllFunctionsStub.returns(['a', 'b']);
      getFunctionStub.withArgs('a').returns({ name: 'func-a' });
      getFunctionStub.withArgs('b').returns({ name: 'func-b' });
      requestStub
        .onFirstCall()
        .resolves({ Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } })
        .onSecondCall()
        .resolves({ Configuration: { LastModified: '2021-05-19T15:34:16.494+0000' } });

      const result = await awsDeploy.getFunctionsEarliestLastModifiedDate();

      expect(requestStub.firstCall.args[0]).to.be.instanceOf(GetFunctionCommand);
      expect(requestStub.firstCall.args[0].input).to.deep.equal({ FunctionName: 'func-a' });
      expect(result.toISOString()).to.equal(new Date('2021-05-19T15:34:16.494+0000').toISOString());
    });

    it('reuses one Lambda client across function lookups', async () => {
      const lambdaClients = [];
      const sentInputs = [];
      class FakeGetFunctionCommand {
        constructor(input) {
          this.input = input;
        }
      }
      class FakeLambdaClient {
        constructor(config) {
          this.config = config;
          lambdaClients.push(this);
        }

        async send(command) {
          expect(command).to.be.instanceOf(FakeGetFunctionCommand);
          sentInputs.push(command.input);
          return { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } };
        }
      }
      const checkForChanges = proxyquire(
        '../../../../../../../lib/plugins/aws/deploy/lib/check-for-changes.js',
        {
          '@aws-sdk/client-lambda': {
            LambdaClient: FakeLambdaClient,
            GetFunctionCommand: FakeGetFunctionCommand,
          },
        }
      );
      const awsDeployWithClientStub = createAwsDeployTestInstance();
      Object.assign(awsDeployWithClientStub, checkForChanges);
      const getAllFunctions = sandbox
        .stub(awsDeployWithClientStub.serverless.service, 'getAllFunctions')
        .returns(['a', 'b']);
      const getFunction = sandbox
        .stub(awsDeployWithClientStub.serverless.service, 'getFunction')
        .callsFake((functionName) => ({ name: `func-${functionName}` }));

      try {
        await awsDeployWithClientStub.getFunctionsEarliestLastModifiedDate();

        expect(lambdaClients).to.have.length(1);
        expect(sentInputs).to.deep.equal([{ FunctionName: 'func-a' }, { FunctionName: 'func-b' }]);
      } finally {
        getAllFunctions.restore();
        getFunction.restore();
      }
    });

    it('limits concurrent Lambda getFunction requests to 6', async () => {
      const functionNames = Array.from({ length: 10 }, (_, index) => `func${index}`);
      getAllFunctionsStub.returns(functionNames);
      getFunctionStub.callsFake((functionName) => ({ name: functionName }));
      let activeRequests = 0;
      let observedMaxActiveRequests = 0;
      const pendingResolvers = [];
      requestStub.callsFake(async () => {
        activeRequests += 1;
        observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
        expect(activeRequests).to.be.at.most(6);
        await new Promise((resolve) => pendingResolvers.push(resolve));
        activeRequests -= 1;
        return { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } };
      });

      const promise = awsDeploy.getFunctionsEarliestLastModifiedDate();

      await waitForPendingRequests(pendingResolvers, 6);
      expect(observedMaxActiveRequests).to.equal(6);
      await releasePendingRequestsUntilSettled(pendingResolvers, promise);
      expect(observedMaxActiveRequests).to.equal(6);
    });
  });

  describe('#getObjectMetadata()', () => {
    let headObjectStub;

    beforeEach(() => {
      headObjectStub = sandbox.stub(S3Client.prototype, 'send').resolves({});
    });

    afterEach(() => {
      S3Client.prototype.send.restore();
    });

    it('should resolve if no objects are provided as input', async () => {
      const input = [];

      return expect(awsDeploy.getObjectMetadata(input)).to.be.fulfilled.then((result) => {
        expect(headObjectStub).to.not.have.been.called;
        expect(result).to.deep.equal([]);
      });
    });

    it('should request the object detailed information', async () => {
      const input = [
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
        { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
        { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/artifact.zip` },
        { Key: `${s3Key}/141264711231-2016-08-18T15:42:00/cloudformation.json` },
      ];

      return expect(awsDeploy.getObjectMetadata(input)).to.be.fulfilled.then(() => {
        expect(headObjectStub.callCount).to.equal(4);
        for (const [index, { Key }] of input.entries()) {
          expect(headObjectStub.getCall(index).args[0]).to.be.instanceOf(HeadObjectCommand);
          expect(headObjectStub.getCall(index).args[0].input).to.deep.equal({
            Bucket: awsDeploy.bucketName,
            Key,
          });
        }
      });
    });

    it('uses an existing S3 client promise from the plugin context', async () => {
      const send = sandbox.stub().resolves({});
      sandbox
        .stub(awsDeploy.provider, 'getAwsSdkV3Config')
        .throws(new Error('Expected existing S3 client to be reused'));
      awsDeploy.s3ClientPromise = Promise.resolve({ send });

      try {
        await awsDeploy.getObjectMetadata([{ Key: `${s3Key}/artifact.zip` }]);

        expect(awsDeploy.provider.getAwsSdkV3Config).to.not.have.been.called;
        expect(send).to.have.been.calledOnce;
        expect(send.firstCall.args[0]).to.be.instanceOf(HeadObjectCommand);
        expect(send.firstCall.args[0].input).to.deep.equal({
          Bucket: awsDeploy.bucketName,
          Key: `${s3Key}/artifact.zip`,
        });
      } finally {
        awsDeploy.provider.getAwsSdkV3Config.restore();
      }
    });

    it('reuses one S3 client across list and headObject checks', async () => {
      const s3Clients = [];
      const paginatorClients = [];
      const sentInputs = [];
      class FakeHeadObjectCommand {
        constructor(input) {
          this.input = input;
        }
      }
      class FakeS3Client {
        constructor(config) {
          this.config = config;
          s3Clients.push(this);
        }

        async send(command) {
          expect(command).to.be.instanceOf(FakeHeadObjectCommand);
          sentInputs.push(command.input);
          return { Metadata: { filesha256: 'hash' } };
        }
      }
      async function* paginateListObjectsV2({ client }) {
        paginatorClients.push(client);
        yield {
          Contents: [
            { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
            { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/cloudformation.json` },
          ],
        };
      }
      const checkForChanges = proxyquire(
        '../../../../../../../lib/plugins/aws/deploy/lib/check-for-changes.js',
        {
          '@aws-sdk/client-s3': {
            S3Client: FakeS3Client,
            HeadObjectCommand: FakeHeadObjectCommand,
            paginateListObjectsV2,
          },
        }
      );
      const awsDeployWithClientStub = createAwsDeployTestInstance();
      awsDeployWithClientStub.bucketName = 'deployment-bucket';
      Object.assign(awsDeployWithClientStub, checkForChanges);

      const objects = await awsDeployWithClientStub.getMostRecentObjects();
      await awsDeployWithClientStub.getObjectMetadata(objects);

      expect(s3Clients).to.have.length(1);
      expect(paginatorClients).to.deep.equal([s3Clients[0]]);
      expect(sentInputs).to.have.length(2);
    });

    it('should translate v3 forbidden errors', async () => {
      headObjectStub.rejects({ $metadata: { httpStatusCode: 403 } });

      try {
        await awsDeploy.getObjectMetadata([
          { Key: `${s3Key}/151224711231-2016-08-18T15:43:00/artifact.zip` },
        ]);
        throw new Error('Expected getObjectMetadata to reject');
      } catch (error) {
        expect(error.code).to.equal('AWS_S3_HEAD_OBJECT_FORBIDDEN');
      }
    });

    it('limits concurrent S3 headObject requests to 6', async () => {
      const input = Array.from({ length: 10 }, (_, index) => ({
        Key: `${s3Key}/151224711231-2016-08-18T15:43:00/file-${index}.zip`,
      }));
      let activeRequests = 0;
      let observedMaxActiveRequests = 0;
      const pendingResolvers = [];
      headObjectStub.callsFake(async () => {
        activeRequests += 1;
        observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
        expect(activeRequests).to.be.at.most(6);
        await new Promise((resolve) => pendingResolvers.push(resolve));
        activeRequests -= 1;
        return { Metadata: { filesha256: 'hash' } };
      });

      const promise = awsDeploy.getObjectMetadata(input);

      await waitForPendingRequests(pendingResolvers, 6);
      expect(observedMaxActiveRequests).to.equal(6);
      await releasePendingRequestsUntilSettled(pendingResolvers, promise);
      expect(observedMaxActiveRequests).to.equal(6);
    });
  });

  describe('#checkIfDeploymentIsNecessary()', () => {
    let normalizeCloudFormationTemplateStub;
    let globSyncStub;
    let readFileStub;

    beforeEach(async () => {
      normalizeCloudFormationTemplateStub = sandbox
        .stub(normalizeFiles, 'normalizeCloudFormationTemplate')
        .returns();
      globSyncStub = sandbox.stub(glob, 'sync');
      readFileStub = sandbox
        .stub(fsp, 'readFile')
        .returns(Promise.resolve('{"service":{"provider":{}},"package":{}}'));
    });

    afterEach(() => {
      normalizeFiles.normalizeCloudFormationTemplate.restore();
      glob.sync.restore();
      fsp.readFile.restore();
    });

    it('should resolve if no input is provided', async () =>
      expect(awsDeploy.checkIfDeploymentIsNecessary([])).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.not.have.been.called;
        expect(globSyncStub).to.not.have.been.called;
        expect(readFileStub).to.not.have.been.called;
      }));

    it('should resolve if no objects are provided as input', async () => {
      const input = [];

      return expect(awsDeploy.checkIfDeploymentIsNecessary(input)).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.not.have.been.called;
        expect(globSyncStub).to.not.have.been.called;
        expect(readFileStub).to.not.have.been.called;
      });
    });

    it('configures local zip hash concurrency with ext/promise/limit', async () => {
      let configuredLimit;
      const fakeLimit = function (limitValue, callback) {
        configuredLimit = limitValue;
        return (...args) => callback(...args);
      };
      const hashStub = sandbox.stub().resolves('local-hash-zip-file-1');
      const checkForChanges = proxyquire(
        '../../../../../../../lib/plugins/aws/deploy/lib/check-for-changes.js',
        {
          'crypto': cryptoStub,
          'ext/promise/limit': fakeLimit,
          '../../../../utils/get-hash-for-file-path': hashStub,
        }
      );
      globSyncStub.returns(['my-service.zip']);
      cryptoStub.createHash().update().digest.onCall(0).returns('local-hash-cf-template');

      await checkForChanges.checkIfDeploymentIsNecessary.call(awsDeploy, [
        { Metadata: { filesha256: 'remote-hash-cf-template' } },
      ]);

      expect(configuredLimit).to.equal(3);
    });

    it('should resolve if objects are given, but no function last modified date', async () => {
      globSyncStub.returns(['my-service.zip']);
      cryptoStub.createHash().update().digest.onCall(0).returns('local-hash-cf-template');

      const input = [{ Metadata: { filesha256: 'remote-hash-cf-template' } }];

      await awsDeploy.checkIfDeploymentIsNecessary(input);
      expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
      expect(globSyncStub).to.have.been.calledOnce;
      expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly(
        awsDeploy.serverless.service.provider.compiledCloudFormationTemplate
      );
      expect(globSyncStub).to.have.been.calledWithExactly(['**.zip'], {
        cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
        dot: true,
        silent: true,
      });
      expect(getHashForFilePathStub).to.have.been.calledWithExactly(
        path.resolve(awsDeploy.serverless.serviceDir, '.serverless/my-service.zip')
      );
      expect(readFileStub).to.not.have.been.calledWith(
        path.resolve(awsDeploy.serverless.serviceDir, '.serverless/my-service.zip')
      );
      expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(false);
    });

    it('should not set a flag if there are more remote hashes', async () => {
      globSyncStub.returns(['my-service.zip']);
      cryptoStub.createHash().update().digest.onCall(0).returns('local-hash-cf-template');
      cryptoStub.createHash().update().digest.onCall(1).returns('local-hash-zip-file-1');

      const input = [
        { Metadata: { filesha256: 'remote-hash-cf-template' } },
        { Metadata: { filesha256: 'remote-hash-zip-file-1' } },
        {
          Metadata: {/* no filesha256 available */},
        }, // will be translated to ''
      ];

      return expect(awsDeploy.checkIfDeploymentIsNecessary(input)).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(globSyncStub).to.have.been.calledOnce;
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate
        );
        expect(globSyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        });
        expect(getHashForFilePathStub).to.have.been.calledWithExactly(
          path.resolve(awsDeploy.serverless.serviceDir, '.serverless/my-service.zip')
        );
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(false);
      });
    });

    it('should not set a flag if remote and local hashes are different', async () => {
      globSyncStub.returns(['my-service.zip']);
      cryptoStub.createHash().update().digest.onCall(0).returns('local-hash-cf-template');
      cryptoStub.createHash().update().digest.onCall(1).returns('local-hash-zip-file-1');

      const input = [
        { Metadata: { filesha256: 'remote-hash-cf-template' } },
        { Metadata: { filesha256: 'remote-hash-zip-file-1' } },
      ];

      return expect(awsDeploy.checkIfDeploymentIsNecessary(input)).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(globSyncStub).to.have.been.calledOnce;
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate
        );
        expect(globSyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        });
        expect(getHashForFilePathStub).to.have.been.calledWithExactly(
          path.resolve(awsDeploy.serverless.serviceDir, '.serverless/my-service.zip')
        );
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(false);
      });
    });

    it('should not set a flag if remote and local hashes are the same but are duplicated', async () => {
      globSyncStub.returns(['func1.zip', 'func2.zip']);
      cryptoStub.createHash().update().digest.onCall(0).returns('remote-hash-cf-template');
      // happens when package.individually is used
      cryptoStub.createHash().update().digest.onCall(1).returns('remote-hash-zip-file-1');
      cryptoStub.createHash().update().digest.onCall(2).returns('remote-hash-zip-file-1');

      const input = [
        { Metadata: { filesha256: 'remote-hash-cf-template' } },
        { Metadata: { filesha256: 'remote-hash-zip-file-1' } },
      ];

      return expect(awsDeploy.checkIfDeploymentIsNecessary(input)).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(globSyncStub).to.have.been.calledOnce;
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate
        );
        expect(globSyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        });
        expect(getHashForFilePathStub).to.have.been.calledWithExactly(
          path.resolve(awsDeploy.serverless.serviceDir, '.serverless/func1.zip')
        );
        expect(getHashForFilePathStub).to.have.been.calledWithExactly(
          path.resolve(awsDeploy.serverless.serviceDir, '.serverless/func2.zip')
        );
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(false);
      });
    });

    it('should not set a flag if the hashes are equal, but the objects were modified after their functions', async () => {
      globSyncStub.returns(['my-service.zip']);
      cryptoStub.createHash().update().digest.onCall(0).returns('hash-cf-template');
      cryptoStub.createHash().update().digest.onCall(1).returns('hash-zip-file-1');

      const now = new Date();
      const inThePast = new Date(new Date().getTime() - 100000);
      const inTheFuture = new Date(new Date().getTime() + 100000);

      const input = [
        { Metadata: { filesha256: 'hash-cf-template' }, LastModified: inThePast },
        { Metadata: { filesha256: 'hash-zip-file-1' }, LastModified: inTheFuture },
      ];

      return expect(awsDeploy.checkIfDeploymentIsNecessary(input, now)).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(globSyncStub).to.have.been.calledOnce;
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate
        );
        expect(globSyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        });
        expect(getHashForFilePathStub).to.have.been.calledWithExactly(
          path.resolve(awsDeploy.serverless.serviceDir, '.serverless/my-service.zip')
        );
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(false);
      });
    });

    it('should set a flag if the remote and local hashes are equal', async () => {
      globSyncStub.returns(['my-service.zip']);
      cryptoStub.createHash().update().digest.onCall(0).returns('hash-cf-template');
      cryptoStub.createHash().update().digest.onCall(1).returns('hash-state');
      cryptoStub.createHash().update().digest.onCall(2).returns('hash-zip-file-1');

      const input = [
        { Metadata: { filesha256: 'hash-cf-template' }, Key: 'file1.zip' },
        { Metadata: { filesha256: 'hash-state' }, Key: 'file2.zip' },
        { Metadata: { filesha256: 'hash-zip-file-1' }, Key: 'file3.zip' },
      ];

      return expect(awsDeploy.checkIfDeploymentIsNecessary(input)).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(globSyncStub).to.have.been.calledOnce;
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate
        );
        expect(globSyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        });
        expect(getHashForFilePathStub).to.have.been.calledWithExactly(
          path.resolve(awsDeploy.serverless.serviceDir, '.serverless/my-service.zip')
        );
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(true);
      });
    });

    it('should set a flag if the remote and local hashes are equal, and the edit times are ordered', async () => {
      globSyncStub.returns(['my-service.zip']);
      cryptoStub.createHash().update().digest.onCall(0).returns('hash-cf-template');
      cryptoStub.createHash().update().digest.onCall(1).returns('hash-state');
      cryptoStub.createHash().update().digest.onCall(2).returns('hash-zip-file-1');

      const longAgo = new Date(new Date().getTime() - 100000);
      const longerAgo = new Date(new Date().getTime() - 200000);

      const input = [
        {
          Metadata: { filesha256: 'hash-cf-template' },
          LastModified: longerAgo,
          Key: 'file1.zip',
        },
        {
          Metadata: { filesha256: 'hash-state' },
          LastModified: longerAgo,
          Key: 'file2.zip',
        },
        {
          Metadata: { filesha256: 'hash-zip-file-1' },
          LastModified: longerAgo,
          Key: 'file3.zip',
        },
      ];

      return expect(awsDeploy.checkIfDeploymentIsNecessary(input, longAgo)).to.be.fulfilled.then(
        () => {
          expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
          expect(globSyncStub).to.have.been.calledOnce;
          expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly(
            awsDeploy.serverless.service.provider.compiledCloudFormationTemplate
          );
          expect(globSyncStub).to.have.been.calledWithExactly(['**.zip'], {
            cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
            dot: true,
            silent: true,
          });
          expect(getHashForFilePathStub).to.have.been.calledWithExactly(
            path.resolve(awsDeploy.serverless.serviceDir, '.serverless/my-service.zip')
          );
          expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(true);
        }
      );
    });

    it('should set a flag if the remote and local hashes are duplicated and equal', async () => {
      globSyncStub.returns(['func1.zip', 'func2.zip']);
      cryptoStub.createHash().update().digest.onCall(0).returns('hash-cf-template');
      cryptoStub.createHash().update().digest.onCall(1).returns('hash-state');
      // happens when package.individually is used
      cryptoStub.createHash().update().digest.onCall(2).returns('hash-zip-file-1');
      cryptoStub.createHash().update().digest.onCall(3).returns('hash-zip-file-1');

      const input = [
        { Metadata: { filesha256: 'hash-cf-template' }, Key: 'file1.zip' },
        { Metadata: { filesha256: 'hash-state' }, Key: 'file2.zip' },
        { Metadata: { filesha256: 'hash-zip-file-1' }, Key: 'file3.zip' },
        { Metadata: { filesha256: 'hash-zip-file-1' }, Key: 'file4.zip' },
      ];

      return expect(awsDeploy.checkIfDeploymentIsNecessary(input)).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(globSyncStub).to.have.been.calledOnce;
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate
        );
        expect(globSyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        });
        expect(getHashForFilePathStub).to.have.been.calledWithExactly(
          path.resolve(awsDeploy.serverless.serviceDir, '.serverless/func1.zip')
        );
        expect(getHashForFilePathStub).to.have.been.calledWithExactly(
          path.resolve(awsDeploy.serverless.serviceDir, '.serverless/func2.zip')
        );
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(true);
      });
    });

    it('should not set a flag if the remote and local hashes are different for package.artifact', async () => {
      awsDeploy.serverless.service.package = {
        artifact: 'foo/bar/my-own.zip',
      };

      globSyncStub.returns([]);
      cryptoStub.createHash().update().digest.onCall(0).returns('hash-cf-template');
      cryptoStub.createHash().update().digest.onCall(1).returns('hash-state');
      cryptoStub.createHash().update().digest.onCall(2).returns('local-my-own-hash');

      const input = [
        { Metadata: { filesha256: 'hash-cf-template' }, Key: 'file1.zip' },
        { Metadata: { filesha256: 'hash-state' }, Key: 'file2.zip' },
        { Metadata: { filesha256: 'remote-my-own-hash' }, Key: 'file3.zip' },
      ];

      return expect(awsDeploy.checkIfDeploymentIsNecessary(input)).to.be.fulfilled.then(() => {
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledOnce;
        expect(globSyncStub).to.have.been.calledOnce;
        expect(normalizeCloudFormationTemplateStub).to.have.been.calledWithExactly(
          awsDeploy.serverless.service.provider.compiledCloudFormationTemplate
        );
        expect(globSyncStub).to.have.been.calledWithExactly(['**.zip'], {
          cwd: path.join(awsDeploy.serverless.serviceDir, '.serverless'),
          dot: true,
          silent: true,
        });
        expect(getHashForFilePathStub).to.have.been.calledWithExactly(
          path.resolve(awsDeploy.serverless.serviceDir, 'foo/bar/my-own.zip')
        );
        expect(awsDeploy.serverless.service.provider.shouldNotDeploy).to.equal(false);
      });
    });
  });
});

describe('checkForChanges #2', () => {
  it('Should recognize package.artifact', async () =>
    runServerless({
      fixture: 'package-artifact',
      command: 'deploy',
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
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
    }).then(({ cfTemplate }) => {
      expect(cfTemplate.Resources.FooLambdaFunction.Properties.Code.S3Key.endsWith('/artifact.zip'))
        .to.be.true;
    }));
});

const checkForChangesServiceName = 'check-for-changes-service';
const checkForChangesDeploymentDirectory = '1589988704359-2020-05-20T15:31:44.359Z';
const olderCheckForChangesDeploymentDirectory = '1489988704359-2017-03-20T15:31:44.359Z';
const remoteArtifactLastModified = new Date('2020-05-20T15:30:16.494+0000');
const deployedFunctionLastModified = '2021-05-20T15:34:16.494+0000';

const commonAwsSdkV3StubMap = {
  CloudFormation: {
    describeStacks: { Stacks: [{}] },
    describeStackResource: {
      StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
    },
  },
  STS: {
    getCallerIdentity: {
      ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
      UserId: 'XXXXXXXXXXXXXXXXXXXXX',
      Account: '999999999999',
      Arn: 'arn:aws:iam::999999999999:user/test',
    },
  },
};

const getDeploymentBase = (serverless) => {
  const provider = serverless.getProvider('aws');
  return `${provider.getDeploymentPrefix()}/${serverless.service.service}/${provider.getStage()}`;
};

const getDeploymentObjectBasenames = async (serverless) => {
  const packagePath = path.resolve(serverless.serviceDir, '.serverless');
  const artifactNames = (await glob('*.zip', { cwd: packagePath })).map((filename) =>
    path.basename(filename)
  );

  if (serverless.service.package.artifact) {
    artifactNames.push(path.basename(serverless.service.package.artifact));
  }

  artifactNames.push(
    'compiled-cloudformation-template.json',
    serverless.getProvider('aws').naming.getServiceStateFileName()
  );

  return Array.from(new Set(artifactNames));
};

const createDeploymentObjects = (serverless, artifactNames, options = {}) => {
  const deploymentBase = getDeploymentBase(serverless);
  const directory = options.directory || checkForChangesDeploymentDirectory;
  const lastModified = options.lastModified || remoteArtifactLastModified;

  return artifactNames.map((artifactName) => ({
    Key: `${deploymentBase}/${directory}/${artifactName}`,
    LastModified: lastModified,
  }));
};

const generateMatchingListObjectsResponse = async (serverless, options = {}) => {
  const deploymentBase = getDeploymentBase(serverless);
  const artifactNames = options.artifactNames || (await getDeploymentObjectBasenames(serverless));

  return {
    Contents: [
      {
        Key: `${deploymentBase}/code-artifacts/sls-otel.0.2.2.zip`,
        LastModified: remoteArtifactLastModified,
      },
      ...createDeploymentObjects(serverless, artifactNames, options),
      ...(options.extraContents || []),
    ],
  };
};

const generateListObjectsResponseWithOlderDeployment = async (serverless) => {
  const artifactNames = await getDeploymentObjectBasenames(serverless);
  const currentDeploymentResponse = await generateMatchingListObjectsResponse(serverless, {
    artifactNames,
  });

  return {
    Contents: [
      ...createDeploymentObjects(serverless, artifactNames, {
        directory: olderCheckForChangesDeploymentDirectory,
        lastModified: new Date('2022-05-20T15:30:16.494+0000'),
      }),
      ...currentDeploymentResponse.Contents,
    ],
  };
};

const getHashForFixtureFile = async (filename) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filename);
    stream.on('data', (data) => hash.update(data));
    stream.on('error', reject);
    stream.on('close', () => resolve(hash.digest('base64')));
  });
};

const getExistingLocalArtifactPath = async (serverless, basename) => {
  const candidates = [path.resolve(serverless.serviceDir, '.serverless', basename)];
  if (
    serverless.service.package.artifact &&
    path.basename(serverless.service.package.artifact) === basename
  ) {
    candidates.push(path.resolve(serverless.serviceDir, serverless.service.package.artifact));
  }

  for (const candidate of candidates) {
    const isFile = await fsp.stat(candidate).then(
      (stat) => stat.isFile(),
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    );
    if (isFile) return candidate;
  }

  return candidates[0];
};

const generateMatchingHeadObjectResponse = async (serverless, { Key: key }) => {
  const provider = serverless.getProvider('aws');
  if (path.basename(key) === 'compiled-cloudformation-template.json') {
    const compiledCfTemplate = serverless.service.provider.compiledCloudFormationTemplate;
    const normCfTemplate = normalizeFiles.normalizeCloudFormationTemplate(compiledCfTemplate);
    const fileHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(normCfTemplate))
      .digest('base64');
    return {
      LastModified: remoteArtifactLastModified,
      Metadata: { filesha256: fileHash },
    };
  }
  if (path.basename(key) === provider.naming.getServiceStateFileName()) {
    const basename = provider.naming.getServiceStateFileName();
    const content = await fsp.readFile(
      path.join(serverless.serviceDir, '.serverless', basename),
      'utf-8'
    );

    const stateObject = JSON.parse(content);
    const fileHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(normalizeFiles.normalizeState(stateObject)))
      .digest('base64');
    return {
      LastModified: remoteArtifactLastModified,
      Metadata: { filesha256: fileHash },
    };
  }
  const fileHash = await getHashForFixtureFile(
    await getExistingLocalArtifactPath(serverless, path.basename(key))
  );
  return {
    LastModified: remoteArtifactLastModified,
    Metadata: { filesha256: fileHash },
  };
};

const generateMatchingHeadObjectResponseMap = async (serverless, listObjectsResponse) => {
  const metadataByKey = new Map();

  await Promise.all(
    listObjectsResponse.Contents.map(async ({ Key }) => {
      if (path.basename(Key) === 'sls-otel.0.2.2.zip') return;
      metadataByKey.set(Key, await generateMatchingHeadObjectResponse(serverless, { Key }));
    })
  );

  return metadataByKey;
};

const generateMatchingRemoteState = async (serverless) => {
  const listObjectsResponse = await generateMatchingListObjectsResponse(serverless);
  const headObjectResponseMap = await generateMatchingHeadObjectResponseMap(
    serverless,
    listObjectsResponse
  );

  return {
    listObjectsResponse,
    headObject: ({ Key }) => {
      const response = headObjectResponseMap.get(Key);
      if (!response) throw new Error(`Unexpected S3 object metadata request for ${Key}`);
      return { ...response, Metadata: { ...response.Metadata } };
    },
  };
};

const createCheckForChangesAwsSdkV3StubMap = (getServerless, overrides = {}) => ({
  CloudFormation: {
    ...commonAwsSdkV3StubMap.CloudFormation,
    ...overrides.CloudFormation,
  },
  Lambda: {
    getFunction: { Configuration: { LastModified: deployedFunctionLastModified } },
    ...overrides.Lambda,
  },
  S3: {
    headBucket: {},
    listObjectsV2: () => generateMatchingListObjectsResponse(getServerless()),
    headObject: (input) => generateMatchingHeadObjectResponse(getServerless(), input),
    ...overrides.S3,
  },
  STS: {
    ...commonAwsSdkV3StubMap.STS,
    ...overrides.STS,
  },
});

const runCheckForChanges = async ({
  configExt = {},
  cwd,
  options,
  awsSdkV3StubMap,
  awsSdkV3StubMapOverrides,
  lastLifecycleHookName = 'aws:deploy:deploy:checkForChanges',
} = {}) => {
  let serverless;
  const getServerless = () => serverless;
  const resolvedAwsSdkV3StubMapOverrides =
    typeof awsSdkV3StubMapOverrides === 'function'
      ? awsSdkV3StubMapOverrides(getServerless)
      : awsSdkV3StubMapOverrides;
  const runOptions = {
    command: 'deploy',
    options,
    lastLifecycleHookName: lastLifecycleHookName || undefined,
    env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
    hooks: {
      beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
    },
    awsSdkV3StubMap:
      awsSdkV3StubMap ||
      createCheckForChangesAwsSdkV3StubMap(getServerless, resolvedAwsSdkV3StubMapOverrides),
  };

  if (cwd) {
    runOptions.cwd = cwd;
  } else {
    runOptions.fixture = 'check-for-changes';
    runOptions.configExt = { service: checkForChangesServiceName, ...configExt };
  }

  return runServerless(runOptions);
};

const packageCheckForChangesFixture = async (configExt = {}) => {
  let serverless;
  const result = await runServerless({
    fixture: 'check-for-changes',
    command: 'package',
    configExt: { service: checkForChangesServiceName, ...configExt },
    hooks: {
      beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
    },
  });

  return { ...result, serverless };
};

describe('test/unit/lib/plugins/aws/deploy/lib/checkForChanges.test.js', () => {
  // Note: Deploy is skipped if:
  // 1. Generated cloudFormation stack is same as one previously deployed (with normalization applied that clears random and time generated values)
  // 2. Collection of generated artifacts (any in package folder) is exactly same (hashes are compared) as one uploaded to S3 bucket with last deployment
  // 3. There's no "--force" CLI param used
  // 4. All Deployed functions configuration modification dates are newer than S3 uploaded artifacts modification dates (if it's not the case, it may mean that previous deployment failed, and in such situation we should deploy unconditionally)

  it('should not deploy if matching artifacts are older than all functions', async () => {
    const { serverless, awsSdkV3Stub } = await runCheckForChanges();

    expect(serverless.service.provider.shouldNotDeploy).to.equal(true);

    const sentMethods = awsSdkV3Stub.sends.map(({ method }) => method);
    expect(sentMethods).to.include('headBucket');
    expect(sentMethods).to.include('listObjectsV2');
    expect(sentMethods).to.include('headObject');
    expect(sentMethods).to.include('getFunction');
  });

  it('should still reconcile deletion protection when the deployment is skipped', async () => {
    const updateTerminationProtectionStub = sandbox.stub().resolves({});

    const { serverless, awsSdkV3Stub } = await runCheckForChanges({
      configExt: { provider: { deletionProtection: true } },
      lastLifecycleHookName: null,
      awsSdkV3StubMapOverrides: {
        CloudFormation: {
          updateTerminationProtection: updateTerminationProtectionStub,
          listStackResources: {},
        },
      },
    });

    expect(serverless.service.provider.shouldNotDeploy).to.equal(true);
    const sentMethods = awsSdkV3Stub.sends.map(({ method }) => method);
    expect(sentMethods).to.not.include('updateStack');
    expect(sentMethods).to.not.include('createChangeSet');
    expect(updateTerminationProtectionStub).to.have.been.calledOnce;
    expect(updateTerminationProtectionStub.firstCall.args[0]).to.deep.equal({
      StackName: `${checkForChangesServiceName}-dev`,
      EnableTerminationProtection: true,
    });
  });

  it('should deploy with --force option', async () => {
    const { serverless, awsSdkV3Stub } = await runCheckForChanges({ options: { force: true } });

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false);

    const sentMethods = awsSdkV3Stub.sends.map(({ method }) => method);
    expect(sentMethods).to.not.include('listObjectsV2');
    expect(sentMethods).to.not.include('headObject');
    expect(sentMethods).to.not.include('getFunction');
  });

  it('should deploy when deployment bucket is empty', async () => {
    const getFunctionStub = sandbox
      .stub()
      .rejects(
        Object.assign(new Error('Function not found'), { name: 'ResourceNotFoundException' })
      );

    const { serverless } = await runCheckForChanges({
      awsSdkV3StubMapOverrides: {
        Lambda: {
          getFunction: getFunctionStub,
        },
        S3: {
          listObjectsV2: { Contents: [] },
        },
      },
    });

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false);
    expect(getFunctionStub).to.have.been.called;
  });

  it('should compare against latest deployment artifacts', async () => {
    const { serverless, awsSdkV3Stub } = await runCheckForChanges({
      awsSdkV3StubMapOverrides: (getServerless) => ({
        S3: {
          listObjectsV2: () => generateListObjectsResponseWithOlderDeployment(getServerless()),
          headObject: (input) => {
            if (input.Key.includes(olderCheckForChangesDeploymentDirectory)) {
              throw new Error('Older deployment artifacts should be ignored');
            }
            return generateMatchingHeadObjectResponse(getServerless(), input);
          },
        },
      }),
    });

    expect(serverless.service.provider.shouldNotDeploy).to.equal(true);

    const headObjectKeys = awsSdkV3Stub.sends
      .filter(({ method }) => method === 'headObject')
      .map(({ input }) => input.Key);
    expect(headObjectKeys.length).to.be.greaterThan(0);
    expect(
      headObjectKeys.every((key) => key.includes(checkForChangesDeploymentDirectory))
    ).to.equal(true);
  });

  it('should deploy if new function was introduced and otherwise there were no other changes', async () => {
    const getFunctionStub = sandbox.stub().callsFake(async ({ FunctionName }) => {
      if (FunctionName.endsWith('-newFn')) {
        throw Object.assign(new Error('Function not found'), {
          name: 'ResourceNotFoundException',
        });
      }
      return { Configuration: { LastModified: deployedFunctionLastModified } };
    });

    const { serverless } = await runCheckForChanges({
      configExt: {
        functions: {
          newFn: { handler: 'fn.handler' },
        },
      },
      awsSdkV3StubMapOverrides: {
        Lambda: {
          getFunction: getFunctionStub,
        },
      },
    });

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false);
    expect(getFunctionStub.getCalls().map(({ args }) => args[0].FunctionName)).to.include(
      serverless.service.getFunction('newFn').name
    );
  });

  it('should deploy if individually packaged function was removed', async () => {
    const {
      serverless: previousServerless,
      fixtureData: { updateConfig, servicePath: serviceDir },
    } = await packageCheckForChangesFixture({ package: { individually: true } });
    const remoteState = await generateMatchingRemoteState(previousServerless);
    // Service#setFunctionNames removes null function entries after config load.
    await updateConfig({ functions: { fnIndividually: null } });

    const { serverless } = await runCheckForChanges({
      cwd: serviceDir,
      awsSdkV3StubMapOverrides: {
        S3: {
          listObjectsV2: remoteState.listObjectsResponse,
          headObject: remoteState.headObject,
        },
      },
    });

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false);
  });

  it('should deploy if remote hashes are different', async () => {
    const { serverless } = await runCheckForChanges({
      awsSdkV3StubMapOverrides: (getServerless) => ({
        S3: {
          headObject: async (input) => {
            const response = await generateMatchingHeadObjectResponse(getServerless(), input);
            if (path.basename(input.Key) === 'compiled-cloudformation-template.json') {
              return { Metadata: { filesha256: 'remote-hash-mismatch' } };
            }
            return response;
          },
        },
      }),
    });

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false);
  });

  it('should deploy if count of hashes differs', async () => {
    const { serverless } = await runCheckForChanges({
      configExt: {
        package: { individually: true },
      },
      awsSdkV3StubMapOverrides: (getServerless) => ({
        S3: {
          listObjectsV2: async () => {
            const response = await generateMatchingListObjectsResponse(getServerless());
            return {
              Contents: response.Contents.filter(({ Key }) => path.basename(Key) !== 'fn2.zip'),
            };
          },
        },
      }),
    });

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false);
  });

  it('should deploy if uploaded artifacts are newer than function configuration modification date', async () => {
    const newerArtifactLastModified = new Date('2022-05-20T15:30:16.494+0000');
    const { serverless } = await runCheckForChanges({
      configExt: {
        package: { individually: true },
      },
      awsSdkV3StubMapOverrides: (getServerless) => ({
        S3: {
          listObjectsV2: () =>
            generateMatchingListObjectsResponse(getServerless(), {
              lastModified: newerArtifactLastModified,
            }),
          headObject: async (input) => ({
            ...(await generateMatchingHeadObjectResponse(getServerless(), input)),
            LastModified: newerArtifactLastModified,
          }),
        },
      }),
    });

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false);
  });

  it('should deploy if custom package.artifact changed', async () => {
    const { serverless } = await runCheckForChanges({
      configExt: {
        package: { artifact: 'artifact.zip' },
      },
      awsSdkV3StubMapOverrides: (getServerless) => ({
        S3: {
          headObject: async (input) => {
            const response = await generateMatchingHeadObjectResponse(getServerless(), input);
            if (path.basename(input.Key) === 'artifact.zip') {
              return { Metadata: { filesha256: 'changed-custom-artifact-hash' } };
            }
            return response;
          },
        },
      }),
    });

    expect(serverless.service.provider.shouldNotDeploy).to.equal(false);
  });

  it('should skip a deployment with identical hashes and package.artifact targeting .serverless directory', async () => {
    let serverless;
    await runServerless({
      fixture: 'package-artifact-in-serverless-dir',
      command: 'deploy',
      configExt: {
        // runServerless by default makes this: `test-${fixtureName}-${TIME_BASED_HASH}`
        // for safety of concurrent test runs. Unfortunately this will make our
        // normalized CF template values **different** in a way that defeats the entire
        // purpose of this test. So, for this test only, use a single, deterministic
        // service name to allow consistent, known hashing.
        service: 'test-packageArtifactInServerlessDir',
      },
      env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      hooks: {
        beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
      },
      awsSdkV3StubMap: {
        ...commonAwsSdkV3StubMap,
        Lambda: {
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
            },
          },
        },
        S3: {
          headBucket: {},
          headObject: async (params) => generateMatchingHeadObjectResponse(serverless, params),
          listObjectsV2: async () => generateMatchingListObjectsResponse(serverless),
        },
      },
    });
    expect(serverless.service.provider.shouldNotDeploy).to.equal(true);
  });

  it('should fail meaningfully if bucket does not exist', () => {
    return expect(
      runCheckForChanges({
        awsSdkV3StubMapOverrides: {
          S3: {
            listObjectsV2: () => {
              throw Object.assign(new Error('The specified bucket does not exist'), {
                name: 'NoSuchBucket',
              });
            },
          },
        },
      })
    ).to.eventually.be.rejected.and.have.property('code', 'DEPLOYMENT_BUCKET_DOES_NOT_EXIST');
  });

  it('should surface other listObjectsV2 errors', () => {
    return expect(
      runCheckForChanges({
        awsSdkV3StubMapOverrides: {
          S3: {
            listObjectsV2: () => {
              throw new Error('Other reason');
            },
          },
        },
      })
    ).to.be.rejectedWith('Other reason');
  });

  it('should gently handle error of accessing objects from S3 bucket', async () => {
    await expect(
      runCheckForChanges({
        awsSdkV3StubMapOverrides: {
          S3: {
            headObject: () => {
              throw Object.assign(new Error('err'), { name: 'AccessDenied' });
            },
          },
        },
      })
    ).to.eventually.be.rejected.and.have.property('code', 'AWS_S3_HEAD_OBJECT_FORBIDDEN');
  });

  describe('checkLogGroupSubscriptionFilterResourceLimitExceeded', () => {
    it('treats omitted subscriptionFilters as no filters', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      const cloudWatchLogsStub = sandbox.stub(CloudWatchLogsClient.prototype, 'send').resolves({});
      const cloudFormationStub = sandbox
        .stub(CloudFormationClient.prototype, 'send')
        .rejects(new Error('CloudFormation should not classify omitted subscription filters'));

      try {
        const result = await awsDeploy.fixLogGroupSubscriptionFilters({
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          logGroupName: 'someLogGroupName',
          cloudwatchLogEvents: [],
        });

        expect(result).to.equal(false);
        expect(cloudWatchLogsStub).to.have.been.calledOnce;
        expect(cloudWatchLogsStub.firstCall.args[0]).to.be.instanceOf(
          DescribeSubscriptionFiltersCommand
        );
        expect(cloudFormationStub).to.not.have.been.called;
      } finally {
        CloudWatchLogsClient.prototype.send.restore();
        CloudFormationClient.prototype.send.restore();
      }
    });

    it('uses an existing CloudWatch Logs client promise during subscription filter discovery', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      const send = sandbox.stub().resolves({ subscriptionFilters: [] });
      sandbox
        .stub(awsDeploy.provider, 'getAwsSdkV3Config')
        .throws(new Error('Expected existing CloudWatch Logs client to be reused'));
      awsDeploy.cloudWatchLogsClientPromise = Promise.resolve({ send });

      try {
        const result = await awsDeploy.fixLogGroupSubscriptionFilters({
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          logGroupName: 'someLogGroupName',
          cloudwatchLogEvents: [],
        });

        expect(result).to.equal(false);
        expect(awsDeploy.provider.getAwsSdkV3Config).to.not.have.been.called;
        expect(send).to.have.been.calledOnce;
        expect(send.firstCall.args[0]).to.be.instanceOf(DescribeSubscriptionFiltersCommand);
      } finally {
        awsDeploy.provider.getAwsSdkV3Config.restore();
      }
    });

    it('uses an existing CloudFormation client promise during subscription filter classification', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      const send = sandbox.stub().resolves({
        StackResourceDetail: { PhysicalResourceId: 'physical-id' },
      });
      sandbox
        .stub(awsDeploy.provider, 'getAwsSdkV3Config')
        .throws(new Error('Expected existing CloudFormation client to be reused'));
      awsDeploy.cloudFormationClientPromise = Promise.resolve({ send });

      try {
        const result = await awsDeploy.isInternalSubscriptionFilter(
          awsDeploy.provider.naming.getStackName(),
          awsDeploy.provider.naming.getCloudWatchLogLogicalId('Fn1', 1),
          'physical-id'
        );

        expect(result).to.equal(true);
        expect(awsDeploy.provider.getAwsSdkV3Config).to.not.have.been.called;
        expect(send).to.have.been.calledOnce;
        expect(send.firstCall.args[0]).to.be.instanceOf(DescribeStackResourceCommand);
      } finally {
        awsDeploy.provider.getAwsSdkV3Config.restore();
      }
    });

    it('limits concurrent CloudWatch Logs describeSubscriptionFilters requests to 2', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      let activeRequests = 0;
      let observedMaxActiveRequests = 0;
      const pendingResolvers = [];
      const describeSubscriptionFiltersStub = sandbox
        .stub(CloudWatchLogsClient.prototype, 'send')
        .callsFake(async (command) => {
          expect(command).to.be.instanceOf(DescribeSubscriptionFiltersCommand);
          activeRequests += 1;
          observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
          expect(activeRequests).to.be.at.most(2);
          await new Promise((resolve) => pendingResolvers.push(resolve));
          activeRequests -= 1;
          return { subscriptionFilters: [] };
        });

      try {
        const promise = Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            awsDeploy.fixLogGroupSubscriptionFilters({
              accountId: '123456789012',
              region: 'us-east-1',
              partition: 'aws',
              logGroupName: `log-group-${index}`,
              cloudwatchLogEvents: [],
            })
          )
        );

        await waitForPendingRequests(pendingResolvers, 2);
        expect(observedMaxActiveRequests).to.equal(2);
        await releasePendingRequestsUntilSettled(pendingResolvers, promise);
        expect(observedMaxActiveRequests).to.equal(2);
        expect(describeSubscriptionFiltersStub).to.have.callCount(10);
      } finally {
        CloudWatchLogsClient.prototype.send.restore();
      }
    });

    it('limits concurrent CloudFormation describeStackResource requests to 2', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      const stackName = awsDeploy.provider.naming.getStackName();
      const logicalResourceId = awsDeploy.provider.naming.getCloudWatchLogLogicalId('Fn1', 1);
      const filterName = `${stackName}-${logicalResourceId}-xxxxx`;
      const cloudWatchLogsStub = sandbox.stub(CloudWatchLogsClient.prototype, 'send').resolves({
        subscriptionFilters: Array.from({ length: 10 }, () => ({
          filterName,
          destinationArn: 'arn:aws:lambda:us-east-1:123456789012:function:service-dev-fn1',
        })),
      });
      let activeRequests = 0;
      let observedMaxActiveRequests = 0;
      const pendingResolvers = [];
      const describeStackResourceStub = sandbox
        .stub(CloudFormationClient.prototype, 'send')
        .callsFake(async (command) => {
          expect(command).to.be.instanceOf(DescribeStackResourceCommand);
          activeRequests += 1;
          observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
          expect(activeRequests).to.be.at.most(2);
          await new Promise((resolve) => pendingResolvers.push(resolve));
          activeRequests -= 1;
          return { StackResourceDetail: { PhysicalResourceId: filterName } };
        });

      try {
        const promise = awsDeploy.fixLogGroupSubscriptionFilters({
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          logGroupName: 'someLogGroupName',
          cloudwatchLogEvents: [
            {
              FunctionName: 'service-dev-fn1',
              functionName: 'Fn1',
              logGroupName: 'someLogGroupName',
              logSubscriptionSerialNumber: 1,
            },
          ],
        });

        await waitForPendingRequests(pendingResolvers, 2);
        expect(observedMaxActiveRequests).to.equal(2);
        await releasePendingRequestsUntilSettled(pendingResolvers, promise);
        expect(observedMaxActiveRequests).to.equal(2);
        expect(cloudWatchLogsStub).to.have.been.calledOnce;
        expect(describeStackResourceStub).to.have.callCount(10);
      } finally {
        CloudWatchLogsClient.prototype.send.restore();
        CloudFormationClient.prototype.send.restore();
      }
    });

    it('limits concurrent CloudWatch Logs deleteSubscriptionFilter requests to 2', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      const stackName = awsDeploy.provider.naming.getStackName();
      const filters = Array.from({ length: 6 }, (_, index) => {
        const logicalResourceId = awsDeploy.provider.naming.getCloudWatchLogLogicalId(
          `Fn${index}`,
          1
        );
        return {
          filterName: `${stackName}-${logicalResourceId}-xxxxx`,
          destinationArn: `arn:aws:lambda:us-east-1:123456789012:function:old-${index}`,
        };
      });
      let activeDeletes = 0;
      let observedMaxActiveDeletes = 0;
      const pendingResolvers = [];
      const cloudWatchLogsStub = sandbox
        .stub(CloudWatchLogsClient.prototype, 'send')
        .callsFake(async (command) => {
          if (command instanceof DescribeSubscriptionFiltersCommand) {
            return { subscriptionFilters: filters };
          }
          if (command instanceof DeleteSubscriptionFilterCommand) {
            activeDeletes += 1;
            observedMaxActiveDeletes = Math.max(observedMaxActiveDeletes, activeDeletes);
            expect(activeDeletes).to.be.at.most(2);
            await new Promise((resolve) => pendingResolvers.push(resolve));
            activeDeletes -= 1;
            return {};
          }
          throw new Error(`Unexpected CloudWatch Logs command: ${command.constructor.name}`);
        });
      const cloudFormationStub = sandbox
        .stub(CloudFormationClient.prototype, 'send')
        .callsFake(async (command) => {
          expect(command).to.be.instanceOf(DescribeStackResourceCommand);
          return {
            StackResourceDetail: {
              PhysicalResourceId: `${stackName}-${command.input.LogicalResourceId}-xxxxx`,
            },
          };
        });

      try {
        const promise = awsDeploy.fixLogGroupSubscriptionFilters({
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          logGroupName: 'someLogGroupName',
          cloudwatchLogEvents: [],
        });

        await waitForPendingRequests(pendingResolvers, 2);
        await releasePendingRequestsUntilSettled(pendingResolvers, promise);
        expect(observedMaxActiveDeletes).to.equal(2);
        expect(
          cloudWatchLogsStub
            .getCalls()
            .map((call) => call.args[0])
            .filter((command) => command instanceof DeleteSubscriptionFilterCommand)
        ).to.have.length(6);
        expect(cloudFormationStub).to.have.callCount(6);
      } finally {
        CloudWatchLogsClient.prototype.send.restore();
        CloudFormationClient.prototype.send.restore();
      }
    });

    it('treats missing log groups during describeSubscriptionFilters as no filters', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      const cloudWatchLogsStub = sandbox
        .stub(CloudWatchLogsClient.prototype, 'send')
        .callsFake(async (command) => {
          expect(command).to.be.instanceOf(DescribeSubscriptionFiltersCommand);
          throw Object.assign(new Error('missing log group'), {
            name: 'ResourceNotFoundException',
          });
        });

      try {
        const result = await awsDeploy.fixLogGroupSubscriptionFilters({
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          logGroupName: 'missingLogGroup',
          cloudwatchLogEvents: [],
        });

        expect(result).to.equal(false);
        expect(cloudWatchLogsStub).to.have.been.calledOnce;
      } finally {
        CloudWatchLogsClient.prototype.send.restore();
      }
    });

    it('surfaces credential and authorization errors from describeSubscriptionFilters', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      sandbox.stub(CloudWatchLogsClient.prototype, 'send').callsFake(async (command) => {
        expect(command).to.be.instanceOf(DescribeSubscriptionFiltersCommand);
        throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
      });

      try {
        await expect(
          awsDeploy.fixLogGroupSubscriptionFilters({
            accountId: '123456789012',
            region: 'us-east-1',
            partition: 'aws',
            logGroupName: 'someLogGroupName',
            cloudwatchLogEvents: [],
          })
        ).to.be.rejectedWith('denied');
      } finally {
        CloudWatchLogsClient.prototype.send.restore();
      }
    });

    it('treats missing CloudFormation subscription-filter resources as external', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      sandbox.stub(CloudFormationClient.prototype, 'send').callsFake(async (command) => {
        expect(command).to.be.instanceOf(DescribeStackResourceCommand);
        throw Object.assign(new Error('Resource does not exist'), { name: 'ValidationError' });
      });

      try {
        const result = await awsDeploy.isInternalSubscriptionFilter(
          awsDeploy.provider.naming.getStackName(),
          'MissingLogicalId',
          'physical-id'
        );

        expect(result).to.equal(false);
      } finally {
        CloudFormationClient.prototype.send.restore();
      }
    });

    it('treats malformed external subscription filter names as external without CloudFormation lookup', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      const cloudWatchLogsStub = sandbox
        .stub(CloudWatchLogsClient.prototype, 'send')
        .callsFake(async (command) => {
          if (command instanceof DescribeSubscriptionFiltersCommand) {
            return {
              subscriptionFilters: [
                {
                  filterName: 'externalFilter',
                  destinationArn: 'arn:aws:lambda:us-east-1:123456789012:function:external-1',
                },
                {
                  filterName: 'external--suffix',
                  destinationArn: 'arn:aws:lambda:us-east-1:123456789012:function:external-2',
                },
              ],
            };
          }
          throw new Error(`Unexpected CloudWatch Logs command: ${command.constructor.name}`);
        });
      const cloudFormationStub = sandbox
        .stub(CloudFormationClient.prototype, 'send')
        .rejects(new Error('CloudFormation should not classify malformed external filters'));

      try {
        await expect(
          awsDeploy.fixLogGroupSubscriptionFilters({
            accountId: '123456789012',
            region: 'us-east-1',
            partition: 'aws',
            logGroupName: 'someLogGroupName',
            cloudwatchLogEvents: [
              {
                FunctionName: 'service-dev-fn1',
                functionName: 'Fn1',
                logGroupName: 'someLogGroupName',
                logSubscriptionSerialNumber: 1,
              },
            ],
          })
        ).to.eventually.be.rejected.and.have.property(
          'code',
          'CLOUDWATCHLOG_LOG_GROUP_EVENT_PER_FUNCTION_LIMIT_EXCEEDED'
        );
        expect(cloudWatchLogsStub).to.have.been.calledOnce;
        expect(cloudFormationStub).to.not.have.been.called;
        expect(
          cloudWatchLogsStub
            .getCalls()
            .map((call) => call.args[0])
            .filter((command) => command instanceof DeleteSubscriptionFilterCommand)
        ).to.have.length(0);
      } finally {
        CloudWatchLogsClient.prototype.send.restore();
        CloudFormationClient.prototype.send.restore();
      }
    });

    it('surfaces credential and authorization errors from CloudFormation classification', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      sandbox.stub(CloudFormationClient.prototype, 'send').callsFake(async (command) => {
        expect(command).to.be.instanceOf(DescribeStackResourceCommand);
        throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
      });

      try {
        await expect(
          awsDeploy.isInternalSubscriptionFilter(
            awsDeploy.provider.naming.getStackName(),
            'LogicalId',
            'physical-id'
          )
        ).to.be.rejectedWith('denied');
      } finally {
        CloudFormationClient.prototype.send.restore();
      }
    });

    it('does not treat non-CloudFormation does-not-exist messages as missing resources', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      sandbox.stub(CloudFormationClient.prototype, 'send').callsFake(async (command) => {
        expect(command).to.be.instanceOf(DescribeStackResourceCommand);
        throw Object.assign(new Error('credentials file does not exist'), {
          name: 'CredentialsProviderError',
        });
      });

      try {
        await expect(
          awsDeploy.isInternalSubscriptionFilter(
            awsDeploy.provider.naming.getStackName(),
            'LogicalId',
            'physical-id'
          )
        ).to.be.rejectedWith('credentials file does not exist');
      } finally {
        CloudFormationClient.prototype.send.restore();
      }
    });

    it('passes credential provider functions to CloudWatch Logs and CloudFormation clients', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      const credentials = async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' });
      const cloudWatchLogsClients = [];
      const cloudFormationClients = [];
      class FakeCommand {
        constructor(input) {
          this.input = input;
        }
      }
      class FakeDescribeSubscriptionFiltersCommand extends FakeCommand {}
      class FakeDeleteSubscriptionFilterCommand extends FakeCommand {}
      class FakeDescribeStackResourceCommand extends FakeCommand {}
      const stackName = awsDeploy.provider.naming.getStackName();
      const logicalResourceId = awsDeploy.provider.naming.getCloudWatchLogLogicalId('Fn1', 1);
      const filterName = `${stackName}-${logicalResourceId}-xxxxx`;
      class FakeCloudWatchLogsClient {
        constructor(config) {
          this.config = config;
          cloudWatchLogsClients.push(this);
        }

        async send(command) {
          if (command instanceof FakeDescribeSubscriptionFiltersCommand) {
            return {
              subscriptionFilters: [
                {
                  filterName,
                  destinationArn: 'arn:aws:lambda:us-east-1:123456789012:function:old',
                },
              ],
            };
          }
          if (command instanceof FakeDeleteSubscriptionFilterCommand) return {};
          throw new Error(`Unexpected CloudWatch Logs command: ${command.constructor.name}`);
        }
      }
      class FakeCloudFormationClient {
        constructor(config) {
          this.config = config;
          cloudFormationClients.push(this);
        }

        async send(command) {
          expect(command).to.be.instanceOf(FakeDescribeStackResourceCommand);
          return { StackResourceDetail: { PhysicalResourceId: filterName } };
        }
      }
      const checkForChanges = proxyquire(
        '../../../../../../../lib/plugins/aws/deploy/lib/check-for-changes.js',
        {
          '@aws-sdk/client-cloudwatch-logs': {
            CloudWatchLogsClient: FakeCloudWatchLogsClient,
            DeleteSubscriptionFilterCommand: FakeDeleteSubscriptionFilterCommand,
            DescribeSubscriptionFiltersCommand: FakeDescribeSubscriptionFiltersCommand,
          },
          '@aws-sdk/client-cloudformation': {
            CloudFormationClient: FakeCloudFormationClient,
            DescribeStackResourceCommand: FakeDescribeStackResourceCommand,
          },
        }
      );
      Object.assign(awsDeploy, checkForChanges);
      const getAwsSdkV3ConfigStub = sandbox.stub(awsDeploy.provider, 'getAwsSdkV3Config').resolves({
        credentials,
        region: 'us-east-1',
      });

      try {
        await awsDeploy.fixLogGroupSubscriptionFilters({
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          logGroupName: 'someLogGroupName',
          cloudwatchLogEvents: [],
        });

        expect(getAwsSdkV3ConfigStub.callCount).to.be.greaterThan(1);
        expect(cloudWatchLogsClients).to.have.length(1);
        expect(cloudFormationClients).to.have.length(1);
        expect(cloudWatchLogsClients[0].config.credentials).to.equal(credentials);
        expect(cloudFormationClients[0].config.credentials).to.equal(credentials);
      } finally {
        getAwsSdkV3ConfigStub.restore();
      }
    });

    it('reuses CloudWatch Logs and CloudFormation clients across subscription filter fan-out', async () => {
      const awsDeploy = createAwsDeployTestInstance();
      const cloudWatchLogsClients = [];
      const cloudFormationClients = [];
      class FakeCommand {
        constructor(input) {
          this.input = input;
        }
      }
      class FakeDescribeSubscriptionFiltersCommand extends FakeCommand {}
      class FakeDeleteSubscriptionFilterCommand extends FakeCommand {}
      class FakeDescribeStackResourceCommand extends FakeCommand {}
      const stackName = awsDeploy.provider.naming.getStackName();
      const logicalResourceId = 'Fn1LogSubscriptionFilter';
      const filterName = `${stackName}-${logicalResourceId}-xxxxx`;
      class FakeCloudWatchLogsClient {
        constructor(config) {
          this.config = config;
          cloudWatchLogsClients.push(this);
        }

        async send(command) {
          if (command instanceof FakeDescribeSubscriptionFiltersCommand) {
            return {
              subscriptionFilters: [
                {
                  filterName,
                  destinationArn: 'arn:aws:lambda:us-east-1:123456789012:function:old',
                },
              ],
            };
          }
          if (command instanceof FakeDeleteSubscriptionFilterCommand) return {};
          throw new Error(`Unexpected CloudWatch Logs command ${command.constructor.name}`);
        }
      }
      class FakeCloudFormationClient {
        constructor(config) {
          this.config = config;
          cloudFormationClients.push(this);
        }

        async send(command) {
          expect(command).to.be.instanceOf(FakeDescribeStackResourceCommand);
          return { StackResourceDetail: { PhysicalResourceId: filterName } };
        }
      }
      const checkForChanges = proxyquire(
        '../../../../../../../lib/plugins/aws/deploy/lib/check-for-changes.js',
        {
          '@aws-sdk/client-cloudwatch-logs': {
            CloudWatchLogsClient: FakeCloudWatchLogsClient,
            DeleteSubscriptionFilterCommand: FakeDeleteSubscriptionFilterCommand,
            DescribeSubscriptionFiltersCommand: FakeDescribeSubscriptionFiltersCommand,
          },
          '@aws-sdk/client-cloudformation': {
            CloudFormationClient: FakeCloudFormationClient,
            DescribeStackResourceCommand: FakeDescribeStackResourceCommand,
          },
        }
      );
      Object.assign(awsDeploy, checkForChanges);

      await Promise.all([
        awsDeploy.fixLogGroupSubscriptionFilters({
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          logGroupName: 'firstLogGroup',
          cloudwatchLogEvents: [],
        }),
        awsDeploy.fixLogGroupSubscriptionFilters({
          accountId: '123456789012',
          region: 'us-east-1',
          partition: 'aws',
          logGroupName: 'secondLogGroup',
          cloudwatchLogEvents: [],
        }),
      ]);

      expect(cloudWatchLogsClients).to.have.length(1);
      expect(cloudFormationClients).to.have.length(1);
    });

    it('does not crash when cloudwatchLog event uses __proto__ as the log group name', async () => {
      const deleteStub = sandbox.stub();
      let serverless;
      await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: {
              events: [{ cloudwatchLog: '__proto__' }, { cloudwatchLog: '__proto__' }],
            },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
        },
        awsSdkV3StubMap: {
          ...commonAwsSdkV3StubMap,
          Lambda: {
            getFunction: { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } },
          },
          S3: {
            listObjectsV2: async () => generateMatchingListObjectsResponse(serverless),
            headObject: async (params) => generateMatchingHeadObjectResponse(serverless, params),
            headBucket: {},
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: async () => ({ subscriptionFilters: [] }),
          },
        },
      });
      expect({}.polluted).to.equal(undefined);
    });

    it('does not crash when cloudwatchLog event uses constructor as the log group name', async () => {
      const deleteStub = sandbox.stub();
      let serverless;
      await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: { fn1: { events: [{ cloudwatchLog: 'constructor' }] } },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
        },
        awsSdkV3StubMap: {
          ...commonAwsSdkV3StubMap,
          Lambda: {
            getFunction: { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } },
          },
          S3: {
            listObjectsV2: async () => generateMatchingListObjectsResponse(serverless),
            headObject: async (params) => generateMatchingHeadObjectResponse(serverless, params),
            headBucket: {},
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: async () => ({ subscriptionFilters: [] }),
          },
        },
      });
    });

    it('should not attempt to delete and add filter for same destination', async () => {
      const deleteStub = sandbox.stub();
      let serverless;
      await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: { fn1: { events: [{ cloudwatchLog: 'someLogGroupName' }] } },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
        },
        awsSdkV3StubMap: {
          ...commonAwsSdkV3StubMap,
          Lambda: {
            getFunction: { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } },
          },
          S3: {
            listObjectsV2: async () => generateMatchingListObjectsResponse(serverless),
            headObject: async (params) => generateMatchingHeadObjectResponse(serverless, params),
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkV3StubMap.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming;
                return {
                  StackResourceDetail: {
                    StackName: naming.getStackName(),
                    LogicalResourceId: params.LogicalResourceId,
                    PhysicalResourceId: `${naming.getStackName()}-${
                      params.LogicalResourceId
                    }-xxxxx`,
                  },
                };
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: async () => {
              const functionName = serverless.service.getFunction('fn1').name;
              const naming = serverless.getProvider('aws').naming;
              return {
                subscriptionFilters: [
                  {
                    // destinationArn `arn:{partition}:lambda:{region}:{accountId}:function:{functionName}`
                    // filterName {stack name}-{logical id}-{random alphanumeric characters}
                    filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                      'Fn1',
                      1
                    )}-xxxxx`,
                    destinationArn: `arn:aws:lambda:us-east-1:999999999999:function:${functionName}`,
                  },
                ],
              };
            },
          },
        },
      });
      expect(deleteStub).to.not.have.been.called;
    });

    it('should not attempt to delete filter for 2 subscription filter per log group include externals', async () => {
      const deleteStub = sandbox.stub();
      let serverless;
      await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: { fn1: { events: [{ cloudwatchLog: 'someLogGroupName' }] } },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
        },
        awsSdkV3StubMap: {
          ...commonAwsSdkV3StubMap,
          Lambda: {
            getFunction: { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } },
          },
          S3: {
            listObjectsV2: async () => generateMatchingListObjectsResponse(serverless),
            headObject: async (params) => generateMatchingHeadObjectResponse(serverless, params),
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkV3StubMap.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming;
                throw Object.assign(
                  new Error(
                    `Resource ${
                      params.LogicalResourceId
                    } does not exist for stack ${naming.getStackName()}`
                  ),
                  { name: 'ValidationError', code: 'ValidationError' }
                );
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: async () => {
              const naming = serverless.getProvider('aws').naming;
              return {
                subscriptionFilters: [
                  {
                    // destinationArn `arn:{partition}:lambda:{region}:{accountId}:function:{functionName}`
                    // filterName {stack name}-{logical id}-{random alphanumeric characters}
                    filterName: `external-stack-dev-${naming.getCloudWatchLogLogicalId(
                      'Fn1',
                      1
                    )}-xxxxx`,
                    destinationArn:
                      'arn:aws:lambda:us-east-1:999999999999:function:test-checkForChanges-cdr3ogg-dev-fn1',
                  },
                ],
              };
            },
          },
        },
      });
      expect(deleteStub).to.not.have.been.called;
    });

    it('should throw an error if external defined subscription filter cause over 2 subscription filter per log group.', async () => {
      const deleteStub = sandbox.stub();
      let serverless;
      const promise = runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: {
              events: [
                { cloudwatchLog: 'someLogGroupName' },
                { cloudwatchLog: 'someLogGroupName' },
              ],
            },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
        },
        awsSdkV3StubMap: {
          ...commonAwsSdkV3StubMap,
          Lambda: {
            getFunction: { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } },
          },
          S3: {
            listObjectsV2: { Contents: [] },
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkV3StubMap.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming;
                throw Object.assign(
                  new Error(
                    `Resource ${
                      params.LogicalResourceId
                    } does not exist for stack ${naming.getStackName()}`
                  ),
                  { name: 'ValidationError', code: 'ValidationError' }
                );
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: async () => {
              const naming = serverless.getProvider('aws').naming;
              return {
                subscriptionFilters: [
                  {
                    // destinationArn `arn:{partition}:lambda:{region}:{accountId}:function:{functionName}`
                    // filterName {stack name}-{logical id}-{random alphanumeric characters}
                    filterName: `external-stack-dev-${naming.getCloudWatchLogLogicalId(
                      'Fn1',
                      1
                    )}-xxxxx`,
                    destinationArn:
                      'arn:aws:lambda:us-east-1:999999999999:function:test-checkForChanges-cdr3ogg-dev-fn1',
                  },
                ],
              };
            },
          },
        },
      });

      await expect(promise).to.eventually.be.rejected.and.have.property(
        'code',
        'CLOUDWATCHLOG_LOG_GROUP_EVENT_PER_FUNCTION_LIMIT_EXCEEDED'
      );
    });

    it('should attempt to delete subscription filter not match as any of new subscription filter', async () => {
      const deleteStub = sandbox.stub();
      let serverless;
      const { awsNaming, awsSdkV3Stub } = await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: { fn1: { events: [{ cloudwatchLog: 'someLogGroupName' }] } },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
        },
        awsSdkV3StubMap: {
          ...commonAwsSdkV3StubMap,
          Lambda: {
            getFunction: { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } },
          },
          S3: {
            listObjectsV2: { Contents: [] },
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkV3StubMap.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming;
                return {
                  StackResourceDetail: {
                    StackName: naming.getStackName(),
                    LogicalResourceId: params.LogicalResourceId,
                    PhysicalResourceId: `${naming.getStackName()}-${
                      params.LogicalResourceId
                    }-xxxxx`,
                  },
                };
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: async () => {
              const naming = serverless.getProvider('aws').naming;
              return {
                subscriptionFilters: [
                  {
                    // destinationArn `arn:{partition}:lambda:{region}:{accountId}:function:{functionName}`
                    // filterName {stack name}-{logical id}-{random alphanumeric characters}
                    filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                      'Fn2',
                      1
                    )}-xxxxx`,
                    destinationArn:
                      'arn:aws:lambda:us-east-1:999999999999:function:test-checkForChanges-cdr3ogg-dev-fn1',
                  },
                ],
              };
            },
          },
        },
      });
      expect(deleteStub).to.have.been.calledOnceWith({
        logGroupName: 'someLogGroupName',
        filterName: `${awsNaming.getStackName()}-${awsNaming.getCloudWatchLogLogicalId(
          'Fn2',
          1
        )}-xxxxx`,
      });
      const deleteSends = awsSdkV3Stub.sends.filter(
        ({ service, method }) =>
          service === 'CloudWatchLogs' && method === 'deleteSubscriptionFilter'
      );
      expect(deleteSends).to.have.length(1);
      expect(deleteSends[0]).to.include({ commandName: 'DeleteSubscriptionFilterCommand' });
      expect(deleteSends[0].input).to.deep.equal({
        logGroupName: 'someLogGroupName',
        filterName: `${awsNaming.getStackName()}-${awsNaming.getCloudWatchLogLogicalId(
          'Fn2',
          1
        )}-xxxxx`,
      });
    });

    it('should attempt to delete filter if order of cloudwatch events changed', async () => {
      const deleteStub = sandbox.stub();
      let serverless;
      const { awsNaming } = await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: {
              events: [
                { cloudwatchLog: 'someLogGroupName1' },
                { cloudwatchLog: 'someLogGroupName2' },
              ],
            },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
        },
        awsSdkV3StubMap: {
          ...commonAwsSdkV3StubMap,
          Lambda: {
            getFunction: { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } },
          },
          S3: {
            listObjectsV2: { Contents: [] },
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkV3StubMap.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming;
                return {
                  StackResourceDetail: {
                    StackName: naming.getStackName(),
                    LogicalResourceId: params.LogicalResourceId,
                    PhysicalResourceId: `${naming.getStackName()}-${
                      params.LogicalResourceId
                    }-xxxxx`,
                  },
                };
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: sandbox
              .stub()
              .onFirstCall()
              .callsFake(async () => {
                const functionName = serverless.service.getFunction('fn1').name;
                const naming = serverless.getProvider('aws').naming;
                return {
                  subscriptionFilters: [
                    {
                      filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                        'Fn1',
                        1
                      )}-xxxxx`,
                      destinationArn: `arn:aws:lambda:us-east-1:999999999999:function:${functionName}`,
                    },
                  ],
                };
              })
              .onSecondCall()
              .callsFake(async () => {
                const functionName = serverless.service.getFunction('fn1').name;
                const naming = serverless.getProvider('aws').naming;
                return {
                  subscriptionFilters: [
                    {
                      // someLogGroupeName2 was previously the first event
                      filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                        'Fn1',
                        1
                      )}-xxxxx`,
                      destinationArn: `arn:aws:lambda:us-east-1:999999999999:function:${functionName}`,
                    },
                  ],
                };
              }),
          },
        },
      });
      expect(deleteStub).to.have.been.calledOnceWith({
        logGroupName: 'someLogGroupName2',
        filterName: `${awsNaming.getStackName()}-${awsNaming.getCloudWatchLogLogicalId(
          'Fn1',
          1
        )}-xxxxx`,
      });
    });

    it('should attempt to delete multiple filters', async () => {
      const deleteStub = sandbox.stub();
      let serverless;
      const { awsNaming } = await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: {
            fn1: {
              events: [
                { cloudwatchLog: 'someLogGroupName' },
                { cloudwatchLog: 'someLogGroupName' },
              ],
            },
          },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
        },
        awsSdkV3StubMap: {
          ...commonAwsSdkV3StubMap,
          Lambda: {
            getFunction: { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } },
          },
          S3: {
            listObjectsV2: { Contents: [] },
            headBucket: {},
          },
          CloudFormation: {
            ...commonAwsSdkV3StubMap.CloudFormation,
            describeStackResource: sandbox
              .stub()
              .onFirstCall()
              .resolves({
                StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
              })
              .callsFake(async (params) => {
                const naming = serverless.getProvider('aws').naming;
                return {
                  StackResourceDetail: {
                    StackName: naming.getStackName(),
                    LogicalResourceId: params.LogicalResourceId,
                    PhysicalResourceId: `${naming.getStackName()}-${
                      params.LogicalResourceId
                    }-xxxxx`,
                  },
                };
              }),
          },
          CloudWatchLogs: {
            deleteSubscriptionFilter: deleteStub,
            describeSubscriptionFilters: sandbox
              .stub()
              .onFirstCall()
              .callsFake(async () => {
                const naming = serverless.getProvider('aws').naming;
                return {
                  subscriptionFilters: [
                    {
                      filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                        'Fn2',
                        1
                      )}-xxxxx`,
                      destinationArn:
                        'arn:aws:lambda:us-east-1:999999999999:function:test-checkForChanges-cdr3ogg-dev-fn2',
                    },
                    {
                      filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                        'Fn2',
                        2
                      )}-xxxxx`,
                      destinationArn:
                        'arn:aws:lambda:us-east-1:999999999999:function:test-checkForChanges-cdr3ogg-dev-fn2',
                    },
                  ],
                };
              }),
          },
        },
      });

      expect(deleteStub).to.have.been.calledTwice;
      expect(deleteStub).to.have.been.calledWith({
        logGroupName: 'someLogGroupName',
        filterName: `${awsNaming.getStackName()}-${awsNaming.getCloudWatchLogLogicalId(
          'Fn2',
          1
        )}-xxxxx`,
      });
      expect(deleteStub).to.have.been.calledWith({
        logGroupName: 'someLogGroupName',
        filterName: `${awsNaming.getStackName()}-${awsNaming.getCloudWatchLogLogicalId(
          'Fn2',
          2
        )}-xxxxx`,
      });
    });

    it('should recognize custom partition', async () => {
      const deleteStub = sandbox.stub();
      let serverless;
      await runServerless({
        fixture: 'check-for-changes',
        command: 'deploy',
        configExt: {
          functions: { fn1: { events: [{ cloudwatchLog: 'someLogGroupName' }] } },
        },
        lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
        env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: 'ignore' },
        hooks: {
          beforeInstanceInit: (serverlessInstance) => (serverless = serverlessInstance),
        },
        awsSdkV3StubMap: {
          ...commonAwsSdkV3StubMap,
          STS: {
            getCallerIdentity: {
              ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
              UserId: 'XXXXXXXXXXXXXXXXXXXXX',
              Account: '999999999999',
              Arn: 'arn:aws-us-gov:iam::999999999999:user/test',
            },
          },
          Lambda: {
            getFunction: { Configuration: { LastModified: '2021-05-20T15:34:16.494+0000' } },
          },
          S3: {
            listObjectsV2: async () => generateMatchingListObjectsResponse(serverless),
            headObject: async (params) => generateMatchingHeadObjectResponse(serverless, params),
            headBucket: {},
          },
          CloudWatchLogs: {
            describeSubscriptionFilters: sandbox.stub().callsFake(async () => {
              const naming = serverless.getProvider('aws').naming;
              return {
                subscriptionFilters: [
                  {
                    filterName: `${naming.getStackName()}-${naming.getCloudWatchLogLogicalId(
                      'Fn1',
                      1
                    )}-xxxxx`,
                    destinationArn: `arn:aws-us-gov:lambda:us-east-1:999999999999:function:${
                      serverless.service.getFunction('fn1').name
                    }`,
                  },
                ],
              };
            }),
            deleteSubscriptionFilter: deleteStub,
          },
        },
      });
      expect(deleteStub).to.not.have.been.called;
    });
  });
});
