'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const AwsInfo = require('../../../../../../lib/plugins/aws/info/index');
const { retryOnThrottlingError } = require('../../../../../../lib/aws/retry');
const {
  CloudFormationClient,
  DescribeStackResourcesCommand,
} = require('@aws-sdk/client-cloudformation');
const { APIGatewayClient, GetApiKeyCommand } = require('@aws-sdk/client-api-gateway');
const releasePendingRequestsUntilSettled = require('../../../../../utils/release-pending-requests-until-settled');

const fastRetry = {
  retryOnThrottlingError: (task, options) =>
    retryOnThrottlingError(task, { ...options, delayMs: 1 }),
};
const createThrottlingError = () =>
  Object.assign(new Error('Rate exceeded'), { name: 'Throttling' });

function createServerlessContext(options) {
  const provider = {
    getStage: () => options.stage,
    getRegion: () => options.region,
    getAwsSdkV3Config: async () => ({ region: options.region }),
    naming: {
      getStackName: () => 'my-service-dev',
    },
  };

  return {
    provider,
    serverless: {
      service: {
        service: 'my-service',
        provider: {},
      },
      getProvider: sinon.stub().withArgs('aws').returns(provider),
    },
  };
}

describe('#getApiKeyValues()', () => {
  let serverless;
  let awsInfo;
  let cloudFormationSendStub;
  let apiGatewaySendStub;

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    ({ serverless } = createServerlessContext(options));
    awsInfo = new AwsInfo(serverless, options);
    cloudFormationSendStub = sinon.stub(CloudFormationClient.prototype, 'send');
    apiGatewaySendStub = sinon.stub(APIGatewayClient.prototype, 'send');
  });

  afterEach(() => {
    CloudFormationClient.prototype.send.restore();
    APIGatewayClient.prototype.send.restore();
  });

  it('should add API Key values to this.gatheredData if API key names are available', async () => {
    // set the API Keys for the service
    awsInfo.serverless.service.provider.apiGateway = {
      apiKeys: ['foo', 'bar'],
    };

    awsInfo.gatheredData = {
      info: {},
    };

    cloudFormationSendStub.resolves({
      StackResources: [
        {
          PhysicalResourceId: 'giwn5zgpqj',
          ResourceType: 'AWS::ApiGateway::ApiKey',
        },
        {
          PhysicalResourceId: 'e5wssvzmla',
          ResourceType: 'AWS::ApiGateway::ApiKey',
        },
        {
          PhysicalResourceId: 's3cwoo',
          ResourceType: 'AWS::ApiGateway::Deployment',
        },
      ],
    });

    apiGatewaySendStub.callsFake(async (command) => {
      if (command.input.apiKey === 'giwn5zgpqj') {
        return { id: 'giwn5zgpqj', value: 'valueForKeyFoo', name: 'foo' };
      }
      if (command.input.apiKey === 'e5wssvzmla') {
        return {
          id: 'e5wssvzmla',
          value: 'valueForKeyBar',
          name: 'bar',
          description: 'bar description',
          customerId: 'bar customer id',
        };
      }
      throw new Error(`Unexpected API key lookup ${command.input.apiKey}`);
    });

    const expectedGatheredDataObj = {
      info: {
        apiKeys: [
          {
            customerId: undefined,
            description: undefined,
            name: 'foo',
            value: 'valueForKeyFoo',
          },
          {
            customerId: 'bar customer id',
            description: 'bar description',
            name: 'bar',
            value: 'valueForKeyBar',
          },
        ],
      },
    };

    return awsInfo.getApiKeyValues().then(() => {
      expect(cloudFormationSendStub).to.have.been.calledOnce;
      expect(cloudFormationSendStub.firstCall.args[0]).to.be.instanceOf(
        DescribeStackResourcesCommand
      );
      expect(cloudFormationSendStub.firstCall.args[0].input).to.deep.equal({
        StackName: awsInfo.provider.naming.getStackName(),
      });
      expect(apiGatewaySendStub).to.have.been.calledTwice;
      for (const call of apiGatewaySendStub.getCalls()) {
        expect(call.args[0]).to.be.instanceOf(GetApiKeyCommand);
      }
      expect(apiGatewaySendStub.getCalls().map((call) => call.args[0].input)).to.deep.equal([
        { apiKey: 'giwn5zgpqj', includeValue: true },
        { apiKey: 'e5wssvzmla', includeValue: true },
      ]);
      expect(awsInfo.gatheredData).to.deep.equal(expectedGatheredDataObj);
    });
  });

  it('limits concurrent API Gateway getApiKey requests to 2', async () => {
    awsInfo.serverless.service.provider.apiGateway = { apiKeys: ['foo'] };
    awsInfo.gatheredData = { info: {} };
    cloudFormationSendStub.resolves({
      StackResources: Array.from({ length: 10 }, (_, index) => ({
        PhysicalResourceId: `api-key-${index}`,
        ResourceType: 'AWS::ApiGateway::ApiKey',
      })),
    });
    let activeRequests = 0;
    let observedMaxActiveRequests = 0;
    const pendingResolvers = [];
    apiGatewaySendStub.callsFake(async (command) => {
      activeRequests += 1;
      observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
      expect(activeRequests).to.be.at.most(2);
      await new Promise((resolve) => pendingResolvers.push(resolve));
      activeRequests -= 1;
      return {
        name: command.input.apiKey,
        value: `value-${command.input.apiKey}`,
      };
    });

    const promise = awsInfo.getApiKeyValues();

    for (let index = 0; index < 20 && pendingResolvers.length < 2; index += 1) {
      await Promise.resolve();
    }
    expect(cloudFormationSendStub).to.have.been.calledOnce;
    expect(observedMaxActiveRequests).to.equal(2);
    await releasePendingRequestsUntilSettled(pendingResolvers, promise);
    expect(observedMaxActiveRequests).to.equal(2);
  });

  it('retries the stack resources description and API key lookups on throttling errors', async () => {
    awsInfo.serverless.service.provider.apiGateway = { apiKeys: ['foo'] };
    awsInfo.gatheredData = { info: {} };
    cloudFormationSendStub
      .onFirstCall()
      .rejects(createThrottlingError())
      .onSecondCall()
      .resolves({
        StackResources: [
          { PhysicalResourceId: 'api-key-id', ResourceType: 'AWS::ApiGateway::ApiKey' },
        ],
      });
    apiGatewaySendStub
      .onFirstCall()
      .rejects(createThrottlingError())
      .onSecondCall()
      .resolves({ name: 'foo', value: 'valueForKeyFoo' });
    const getApiKeyValuesWithFastRetry = proxyquire(
      '../../../../../../lib/plugins/aws/info/get-api-key-values',
      { '../../../aws/retry': fastRetry }
    );

    await getApiKeyValuesWithFastRetry.getApiKeyValues.call(awsInfo);

    expect(cloudFormationSendStub).to.have.been.calledTwice;
    expect(apiGatewaySendStub).to.have.been.calledTwice;
    expect(awsInfo.gatheredData.info.apiKeys).to.deep.equal([
      { customerId: undefined, description: undefined, name: 'foo', value: 'valueForKeyFoo' },
    ]);
  });

  it('uses an existing CloudFormation client promise from the info context', async () => {
    awsInfo.serverless.service.provider.apiGateway = { apiKeys: ['foo'] };
    awsInfo.gatheredData = { info: {} };
    const send = sinon.stub().resolves({
      StackResources: [
        {
          PhysicalResourceId: 'api-key-id',
          ResourceType: 'AWS::ApiGateway::ApiKey',
        },
      ],
    });
    const getAwsSdkV3ConfigStub = sinon
      .stub(awsInfo.provider, 'getAwsSdkV3Config')
      .resolves({ region: 'us-east-1' });
    awsInfo.cloudFormationClientPromise = Promise.resolve({ send });
    apiGatewaySendStub.resolves({ name: 'foo', value: 'valueForKeyFoo' });

    try {
      await awsInfo.getApiKeyValues();

      expect(getAwsSdkV3ConfigStub).to.have.been.calledOnce;
      expect(send).to.have.been.calledOnce;
      expect(send.firstCall.args[0]).to.be.instanceOf(DescribeStackResourcesCommand);
      expect(apiGatewaySendStub).to.have.been.calledOnce;
      expect(apiGatewaySendStub.firstCall.args[0]).to.be.instanceOf(GetApiKeyCommand);
      expect(awsInfo.gatheredData.info.apiKeys).to.deep.equal([
        {
          customerId: undefined,
          description: undefined,
          name: 'foo',
          value: 'valueForKeyFoo',
        },
      ]);
    } finally {
      getAwsSdkV3ConfigStub.restore();
    }
  });

  it('uses an existing API Gateway client promise from the info context', async () => {
    awsInfo.serverless.service.provider.apiGateway = { apiKeys: ['foo'] };
    awsInfo.gatheredData = { info: {} };
    const cloudFormationSend = sinon.stub().resolves({
      StackResources: [
        {
          PhysicalResourceId: 'api-key-id',
          ResourceType: 'AWS::ApiGateway::ApiKey',
        },
      ],
    });
    const apiGatewaySend = sinon.stub().resolves({ name: 'foo', value: 'valueForKeyFoo' });
    const getAwsSdkV3ConfigStub = sinon
      .stub(awsInfo.provider, 'getAwsSdkV3Config')
      .throws(new Error('Expected existing clients to be reused'));
    awsInfo.cloudFormationClientPromise = Promise.resolve({ send: cloudFormationSend });
    awsInfo.apiGatewayClientPromise = Promise.resolve({ send: apiGatewaySend });

    try {
      await awsInfo.getApiKeyValues();

      expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
      expect(cloudFormationSend).to.have.been.calledOnce;
      expect(cloudFormationSend.firstCall.args[0]).to.be.instanceOf(DescribeStackResourcesCommand);
      expect(cloudFormationSend.firstCall.args[0].input).to.deep.equal({
        StackName: awsInfo.provider.naming.getStackName(),
      });
      expect(apiGatewaySend).to.have.been.calledOnce;
      expect(apiGatewaySend.firstCall.args[0]).to.be.instanceOf(GetApiKeyCommand);
      expect(apiGatewaySend.firstCall.args[0].input).to.deep.equal({
        apiKey: 'api-key-id',
        includeValue: true,
      });
      expect(awsInfo.gatheredData.info.apiKeys).to.deep.equal([
        {
          customerId: undefined,
          description: undefined,
          name: 'foo',
          value: 'valueForKeyFoo',
        },
      ]);
    } finally {
      getAwsSdkV3ConfigStub.restore();
    }
  });

  it('should resolve if AWS does not return API key values', async () => {
    // set the API Keys for the service
    awsInfo.serverless.service.provider.apiGateway = { apiKeys: ['foo', 'bar'] };

    awsInfo.gatheredData = {
      info: {},
    };

    const apiKeyItems = {
      items: [],
    };

    cloudFormationSendStub.resolves(apiKeyItems);

    const expectedGatheredDataObj = {
      info: {
        apiKeys: [],
      },
    };

    return awsInfo.getApiKeyValues().then(() => {
      expect(cloudFormationSendStub).to.have.been.calledOnce;
      expect(apiGatewaySendStub).to.not.have.been.called;
      expect(awsInfo.gatheredData).to.deep.equal(expectedGatheredDataObj);
    });
  });

  it('should resolve if API key names are not available', async () => {
    awsInfo.serverless.service.provider.apiGateway = {};

    awsInfo.gatheredData = {
      info: {},
    };

    const expectedGatheredDataObj = {
      info: {
        apiKeys: [],
      },
    };

    return awsInfo.getApiKeyValues().then(() => {
      expect(cloudFormationSendStub).to.not.have.been.called;
      expect(apiGatewaySendStub).to.not.have.been.called;
      expect(awsInfo.gatheredData).to.deep.equal(expectedGatheredDataObj);
    });
  });
});
