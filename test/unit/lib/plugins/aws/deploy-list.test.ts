'use strict';

const sinon = require('sinon');
const proxyquire = require('proxyquire');
const expect = require('chai').expect;
const AwsDeployList = require('../../../../../lib/plugins/aws/deploy-list');
const ServerlessError = require('../../../../../lib/serverless-error');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const {
  LambdaClient,
  GetFunctionCommand,
  ListVersionsByFunctionCommand,
} = require('@aws-sdk/client-lambda');
const releasePendingRequestsUntilSettled = require('../../../../utils/release-pending-requests-until-settled');

function formatDeploymentDate(dateString) {
  const date = new Date(Date.parse(dateString));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, 0)}-${String(
    date.getUTCDate()
  ).padStart(2, 0)} ${String(date.getUTCHours()).padStart(2, 0)}:${String(
    date.getUTCMinutes()
  ).padStart(2, 0)}:${String(date.getUTCSeconds()).padStart(2, 0)} UTC`;
}

function createServerlessContext(options) {
  const provider = {
    getStage: () => options.stage,
    getRegion: () => options.region,
    getDeploymentPrefix: () => 'serverless',
    getAwsSdkV3Config: async () => ({ region: options.region }),
  };
  const service = {
    service: 'listDeployments',
    functions: {},
    getAllFunctions() {
      return Object.keys(this.functions);
    },
    getFunction(functionName) {
      if (!this.functions || !Object.hasOwn(this.functions, functionName)) {
        throw new ServerlessError(
          `Function "${functionName}" doesn't exist in this Service`,
          'FUNCTION_MISSING_IN_SERVICE'
        );
      }
      return this.functions[functionName];
    },
    getAllFunctionsNames() {
      return this.getAllFunctions().map((functionName) => this.getFunction(functionName).name);
    },
  };

  return {
    provider,
    serverless: {
      service,
      getProvider: sinon.stub().withArgs('aws').returns(provider),
    },
  };
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

describe('AwsDeployList', () => {
  let serverless;
  let provider;
  let awsDeployList;
  let s3Key;

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    ({ serverless, provider } = createServerlessContext(options));
    const prefix = provider.getDeploymentPrefix();
    s3Key = `${prefix}/${serverless.service.service}/${provider.getStage()}`;
    awsDeployList = new AwsDeployList(serverless, options);
    awsDeployList.bucketName = 'deployment-bucket';
  });

  describe('#listDeployments()', () => {
    let writeTextStub;
    let noticeStub;

    function getAwsDeployListWithLogStubs() {
      writeTextStub = sinon.stub();
      noticeStub = sinon.stub();
      noticeStub.skip = sinon.stub();
      const AwsDeployListWithLogStubs = proxyquire('../../../../../lib/plugins/aws/deploy-list', {
        '../../utils/serverless-utils/log': {
          log: { notice: noticeStub },
          writeText: writeTextStub,
        },
      });
      const deployList = new AwsDeployListWithLogStubs(serverless, { stage: 'dev' });
      deployList.bucketName = 'deployment-bucket';
      return deployList;
    }

    afterEach(() => {
      if (S3Client.prototype.send.restore) S3Client.prototype.send.restore();
    });

    it('should print no deployments in case there are none', async () => {
      const s3Response = {
        Contents: [],
      };
      const listObjectsStub = sinon.stub(S3Client.prototype, 'send').resolves(s3Response);

      await awsDeployList.listDeployments();
      expect(listObjectsStub.calledOnce).to.be.equal(true);
      expect(listObjectsStub.firstCall.args[0]).to.be.instanceOf(ListObjectsV2Command);
      expect(listObjectsStub.firstCall.args[0].input).to.include({
        Bucket: awsDeployList.bucketName,
        Prefix: `${s3Key}/`,
      });
    });

    it('should print no deployments in case paginated listings contain no deployments', async () => {
      const deployList = getAwsDeployListWithLogStubs();
      sinon.stub(S3Client.prototype, 'send').resolves({
        Contents: [{ Key: `${s3Key}/not-a-deploy-dir/artifact.zip` }],
      });

      await deployList.listDeployments();

      expect(writeTextStub.called).to.equal(false);
      expect(noticeStub.calledOnce).to.equal(true);
      expect(
        noticeStub.skip.calledOnceWithExactly(
          "No deployments found, if that's unexpected ensure that stage and region are correct"
        )
      ).to.equal(true);
    });

    it('should display all available deployments', async () => {
      const s3Response = {
        Contents: [
          { Key: `${s3Key}/113304333331-2016-08-18T13:40:06/artifact.zip` },
          { Key: `${s3Key}/113304333331-2016-08-18T13:40:06/cloudformation.json` },
          { Key: `${s3Key}/903940390431-2016-08-18T23:42:08/artifact.zip` },
          { Key: `${s3Key}/903940390431-2016-08-18T23:42:08/cloudformation.json` },
        ],
      };

      const listObjectsStub = sinon.stub(S3Client.prototype, 'send').resolves(s3Response);

      await awsDeployList.listDeployments();
      expect(listObjectsStub.calledOnce).to.be.equal(true);
      expect(listObjectsStub.firstCall.args[0]).to.be.instanceOf(ListObjectsV2Command);
      expect(listObjectsStub.firstCall.args[0].input).to.include({
        Bucket: awsDeployList.bucketName,
        Prefix: `${s3Key}/`,
      });
    });

    it('should print a deployment directory split across paginated object listings as one group', async () => {
      const deployList = getAwsDeployListWithLogStubs();
      sinon
        .stub(S3Client.prototype, 'send')
        .onFirstCall()
        .resolves({
          Contents: [{ Key: `${s3Key}/113304333331-2016-08-18T13:40:06/artifact.zip` }],
          NextContinuationToken: 'next-page',
        })
        .onSecondCall()
        .resolves({
          Contents: [
            { Key: `${s3Key}/113304333331-2016-08-18T13:40:06/cloudformation.json` },
            { Key: `${s3Key}/903940390431-2016-08-18T23:42:08/artifact.zip` },
          ],
        });

      await deployList.listDeployments();

      expect(writeTextStub.firstCall.args).to.deep.equal([
        formatDeploymentDate('2016-08-18T13:40:06'),
        'Timestamp: 113304333331',
        'Files:',
      ]);
      expect(writeTextStub.secondCall.args).to.deep.equal(['  - artifact.zip']);
      expect(writeTextStub.thirdCall.args).to.deep.equal(['  - cloudformation.json']);
      expect(writeTextStub.getCall(3).args).to.deep.equal([
        formatDeploymentDate('2016-08-18T23:42:08'),
        'Timestamp: 903940390431',
        'Files:',
      ]);
      expect(writeTextStub.getCall(4).args).to.deep.equal(['  - artifact.zip']);
      expect(noticeStub.skip.called).to.equal(false);
    });

    it('should ignore unrelated paginated keys while printing deployments', async () => {
      const deployList = getAwsDeployListWithLogStubs();
      sinon.stub(S3Client.prototype, 'send').resolves({
        Contents: [
          { Key: `${s3Key}/not-a-deploy-dir/artifact.zip` },
          {
            Key: `other-prefix/${serverless.service.service}/dev/113304333331-2016-08-18T13:40:06/other.zip`,
          },
          { Key: `${s3Key}/113304333331-2016-08-18T13:40:06/artifact.zip` },
        ],
      });

      await deployList.listDeployments();

      expect(writeTextStub.calledTwice).to.equal(true);
      expect(writeTextStub.secondCall.args).to.deep.equal(['  - artifact.zip']);
      expect(noticeStub.skip.called).to.equal(false);
    });

    it('should emit completed deployment output before fetching later pages', async () => {
      const deployList = getAwsDeployListWithLogStubs();
      sinon
        .stub(S3Client.prototype, 'send')
        .onFirstCall()
        .resolves({
          Contents: [{ Key: `${s3Key}/113304333331-2016-08-18T13:40:06/artifact.zip` }],
          NextContinuationToken: 'second-page',
        })
        .onSecondCall()
        .resolves({
          Contents: [{ Key: `${s3Key}/903940390431-2016-08-18T23:42:08/artifact.zip` }],
          NextContinuationToken: 'third-page',
        })
        .onThirdCall()
        .callsFake(async () => {
          expect(writeTextStub.called).to.equal(true);
          expect(writeTextStub.firstCall.args).to.deep.equal([
            formatDeploymentDate('2016-08-18T13:40:06'),
            'Timestamp: 113304333331',
            'Files:',
          ]);
          return { Contents: [] };
        });

      await deployList.listDeployments();
    });

    it('should display deployments across paginated object listings', async () => {
      const listObjectsStub = sinon
        .stub(S3Client.prototype, 'send')
        .onFirstCall()
        .resolves({
          Contents: [{ Key: `${s3Key}/113304333331-2016-08-18T13:40:06/artifact.zip` }],
          NextContinuationToken: 'next-page',
        })
        .onSecondCall()
        .resolves({
          Contents: [{ Key: `${s3Key}/903940390431-2016-08-18T23:42:08/cloudformation.json` }],
        });

      await awsDeployList.listDeployments();

      expect(listObjectsStub.calledTwice).to.equal(true);
      expect(listObjectsStub.secondCall.args[0]).to.be.instanceOf(ListObjectsV2Command);
      expect(listObjectsStub.secondCall.args[0].input).to.include({
        Bucket: awsDeployList.bucketName,
        Prefix: `${s3Key}/`,
        ContinuationToken: 'next-page',
      });
    });

    it('should translate S3 list access denied errors', async () => {
      sinon.stub(S3Client.prototype, 'send').rejects({ $metadata: { httpStatusCode: 403 } });

      try {
        await awsDeployList.listDeployments();
        throw new Error('Expected listDeployments to reject');
      } catch (error) {
        expect(error.code).to.equal('AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED');
      }
    });

    it('should preserve specific S3 list authentication failures', async () => {
      const listError = new Error('signature mismatch');
      listError.providerError = {
        code: 'SignatureDoesNotMatch',
        statusCode: 403,
      };
      sinon.stub(S3Client.prototype, 'send').rejects(listError);

      try {
        await awsDeployList.listDeployments();
        throw new Error('Expected listDeployments to reject');
      } catch (error) {
        expect(error).to.equal(listError);
      }
    });

    it('should translate wrapped status-only S3 list access denied errors', async () => {
      const listError = new Error('forbidden');
      listError.code = 'AWS_S3_LIST_OBJECTS_V2_ERROR';
      listError.providerError = { statusCode: 403 };
      sinon.stub(S3Client.prototype, 'send').rejects(listError);

      await expect(awsDeployList.listDeployments()).to.be.eventually.rejected.and.have.property(
        'code',
        'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED'
      );
    });
  });

  describe('#listFunctions()', () => {
    let getFunctionsStub;
    let getFunctionVersionsStub;
    let displayFunctionsStub;

    beforeEach(() => {
      getFunctionsStub = sinon.stub(awsDeployList, 'getFunctions').resolves();
      getFunctionVersionsStub = sinon.stub(awsDeployList, 'getFunctionVersions').resolves();
      displayFunctionsStub = sinon.stub(awsDeployList, 'displayFunctions').resolves();
    });

    afterEach(() => {
      awsDeployList.getFunctions.restore();
      awsDeployList.getFunctionVersions.restore();
      awsDeployList.displayFunctions.restore();
    });

    it('should run promise chain in order', async () => {
      await awsDeployList.listFunctions();

      expect(getFunctionsStub.calledOnce).to.equal(true);
      expect(getFunctionVersionsStub.calledAfter(getFunctionsStub)).to.equal(true);
      expect(displayFunctionsStub.calledAfter(getFunctionVersionsStub)).to.equal(true);
    });
  });

  describe('#getFunctions()', () => {
    let listFunctionsStub;

    beforeEach(() => {
      awsDeployList.serverless.service.functions = {
        func1: {
          name: 'listDeployments-dev-func1',
        },
        func2: {
          name: 'listDeployments-dev-func2',
        },
      };
      listFunctionsStub = sinon.stub(LambdaClient.prototype, 'send').callsFake(async (command) => {
        if (command.input.FunctionName === 'listDeployments-dev-func1') {
          return {
            Configuration: {
              FunctionName: 'listDeployments-dev-func1',
            },
          };
        }
        if (command.input.FunctionName === 'listDeployments-dev-func2') {
          return {
            Configuration: {
              FunctionName: 'listDeployments-dev-func2',
            },
          };
        }
        throw new Error(`Unexpected function lookup ${command.input.FunctionName}`);
      });
    });

    afterEach(() => {
      LambdaClient.prototype.send.restore();
    });

    it('should get all service related functions', async () => {
      const expectedResult = [
        { FunctionName: 'listDeployments-dev-func1' },
        { FunctionName: 'listDeployments-dev-func2' },
      ];

      const result = await awsDeployList.getFunctions();

      expect(listFunctionsStub.callCount).to.equal(2);
      for (const call of listFunctionsStub.getCalls()) {
        expect(call.args[0]).to.be.instanceOf(GetFunctionCommand);
      }
      expect(listFunctionsStub.getCalls().map((call) => call.args[0].input)).to.deep.equal([
        { FunctionName: 'listDeployments-dev-func1' },
        { FunctionName: 'listDeployments-dev-func2' },
      ]);
      expect(result).to.deep.equal(expectedResult);
    });

    it('limits concurrent Lambda getFunction requests to 6', async () => {
      awsDeployList.serverless.service.functions = Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          `func${index}`,
          { name: `listDeployments-dev-func${index}` },
        ])
      );
      let activeRequests = 0;
      let observedMaxActiveRequests = 0;
      const pendingResolvers = [];
      listFunctionsStub.callsFake(async (command) => {
        activeRequests += 1;
        observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
        expect(activeRequests).to.be.at.most(6);
        await new Promise((resolve) => pendingResolvers.push(resolve));
        activeRequests -= 1;
        return { Configuration: { FunctionName: command.input.FunctionName } };
      });

      const promise = awsDeployList.getFunctions();

      await waitForPendingRequests(pendingResolvers, 6);
      expect(observedMaxActiveRequests).to.equal(6);
      await releasePendingRequestsUntilSettled(pendingResolvers, promise);
      expect(observedMaxActiveRequests).to.equal(6);
    });
  });

  describe('#getFunctionPaginatedVersions()', () => {
    beforeEach(() => {
      sinon
        .stub(LambdaClient.prototype, 'send')
        .onFirstCall()
        .resolves({
          Versions: [{ FunctionName: 'listDeployments-dev-func', Version: '1' }],
          NextMarker: '123',
        })
        .onSecondCall()
        .resolves({
          Versions: [{ FunctionName: 'listDeployments-dev-func', Version: '2' }],
        });
    });

    afterEach(() => {
      LambdaClient.prototype.send.restore();
    });

    it('should return the versions for the provided function when response is paginated', async () => {
      const params = {
        FunctionName: 'listDeployments-dev-func',
      };

      const result = await awsDeployList.getFunctionPaginatedVersions(params);
      const expectedResult = {
        Versions: [
          { FunctionName: 'listDeployments-dev-func', Version: '1' },
          { FunctionName: 'listDeployments-dev-func', Version: '2' },
        ],
      };

      expect(result).to.deep.equal(expectedResult);
      expect(LambdaClient.prototype.send.firstCall.args[0]).to.be.instanceOf(
        ListVersionsByFunctionCommand
      );
      expect(LambdaClient.prototype.send.firstCall.args[0].input).to.deep.equal({
        FunctionName: 'listDeployments-dev-func',
      });
      expect(LambdaClient.prototype.send.secondCall.args[0].input).to.deep.equal({
        FunctionName: 'listDeployments-dev-func',
        Marker: '123',
      });
    });
  });

  describe('#getFunctionVersions()', () => {
    let listVersionsByFunctionStub;

    beforeEach(() => {
      listVersionsByFunctionStub = sinon.stub(LambdaClient.prototype, 'send').resolves({
        Versions: [{ FunctionName: 'listDeployments-dev-func', Version: '$LATEST' }],
      });
    });

    afterEach(() => {
      LambdaClient.prototype.send.restore();
    });

    it('should return the versions for the provided functions', async () => {
      const funcs = [
        { FunctionName: 'listDeployments-dev-func1' },
        { FunctionName: 'listDeployments-dev-func2' },
      ];

      const result = await awsDeployList.getFunctionVersions(funcs);
      const expectedResult = [
        {
          Versions: [{ FunctionName: 'listDeployments-dev-func', Version: '$LATEST' }],
        },
        {
          Versions: [{ FunctionName: 'listDeployments-dev-func', Version: '$LATEST' }],
        },
      ];

      expect(listVersionsByFunctionStub.calledTwice).to.equal(true);
      expect(listVersionsByFunctionStub.firstCall.args[0]).to.be.instanceOf(
        ListVersionsByFunctionCommand
      );
      expect(listVersionsByFunctionStub.getCalls().map((call) => call.args[0].input)).to.deep.equal(
        [
          { FunctionName: 'listDeployments-dev-func1' },
          { FunctionName: 'listDeployments-dev-func2' },
        ]
      );
      expect(result).to.deep.equal(expectedResult);
    });

    it('limits concurrent per-function version chains to 6', async () => {
      const funcs = Array.from({ length: 10 }, (_, index) => ({
        FunctionName: `listDeployments-dev-func${index}`,
      }));
      let activeRequests = 0;
      let observedMaxActiveRequests = 0;
      const pendingResolvers = [];
      listVersionsByFunctionStub.callsFake(async (command) => {
        activeRequests += 1;
        observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
        expect(activeRequests).to.be.at.most(6);
        await new Promise((resolve) => pendingResolvers.push(resolve));
        activeRequests -= 1;
        return {
          Versions: [{ FunctionName: command.input.FunctionName, Version: '$LATEST' }],
        };
      });

      const promise = awsDeployList.getFunctionVersions(funcs);

      await waitForPendingRequests(pendingResolvers, 6);
      expect(observedMaxActiveRequests).to.equal(6);
      await releasePendingRequestsUntilSettled(pendingResolvers, promise);
      expect(observedMaxActiveRequests).to.equal(6);
    });
  });

  describe('client reuse', () => {
    it('reuses one Lambda client across function and version listing', async () => {
      const lambdaClients = [];
      const sends = [];
      class FakeCommand {
        constructor(input) {
          this.input = input;
        }
      }
      class FakeGetFunctionCommand extends FakeCommand {}
      class FakeListVersionsByFunctionCommand extends FakeCommand {}
      class FakeLambdaClient {
        constructor(config) {
          this.config = config;
          lambdaClients.push(this);
        }

        async send(command) {
          sends.push({ client: this, command });
          if (command instanceof FakeGetFunctionCommand) {
            return { Configuration: { FunctionName: command.input.FunctionName } };
          }
          if (command instanceof FakeListVersionsByFunctionCommand) {
            return {
              Versions: [{ FunctionName: command.input.FunctionName, Version: '$LATEST' }],
            };
          }
          throw new Error(`Unexpected command ${command.constructor.name}`);
        }
      }
      const AwsDeployListWithClientStubs = proxyquire(
        '../../../../../lib/plugins/aws/deploy-list',
        {
          '@aws-sdk/client-lambda': {
            LambdaClient: FakeLambdaClient,
            GetFunctionCommand: FakeGetFunctionCommand,
            ListVersionsByFunctionCommand: FakeListVersionsByFunctionCommand,
          },
        }
      );
      const deployList = new AwsDeployListWithClientStubs(serverless, {
        stage: 'dev',
        region: 'us-east-1',
      });
      deployList.serverless.service.functions = {
        first: { name: 'listDeployments-dev-first' },
        second: { name: 'listDeployments-dev-second' },
      };

      const funcs = await deployList.getFunctions();
      await deployList.getFunctionVersions(funcs);

      expect(lambdaClients).to.have.length(1);
      expect(sends).to.have.length(4);
      for (const send of sends) expect(send.client).to.equal(lambdaClients[0]);
      expect(sends[0].command).to.be.instanceOf(FakeGetFunctionCommand);
      expect(sends[1].command).to.be.instanceOf(FakeGetFunctionCommand);
      expect(sends[2].command).to.be.instanceOf(FakeListVersionsByFunctionCommand);
      expect(sends[3].command).to.be.instanceOf(FakeListVersionsByFunctionCommand);
    });
  });
});
