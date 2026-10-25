'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const {
  APIGatewayClient,
  GetUsagePlansCommand,
  UpdateUsagePlanCommand,
} = require('@aws-sdk/client-api-gateway');
const {
  CloudFormationClient,
  DescribeStackResourceCommand,
} = require('@aws-sdk/client-cloudformation');
const Serverless = require('../../../../../../../../../../../lib/serverless');
const AwsProvider = require('../../../../../../../../../../../lib/plugins/aws/provider');
const disassociateUsagePlan = require('../../../../../../../../../../../lib/plugins/aws/package/compile/events/api-gateway/lib/hack/disassociate-usage-plan');
const releasePendingRequestsUntilSettled = require('../../../../../../../../../../utils/release-pending-requests-until-settled');
const runServerless = require('../../../../../../../../../../utils/run-serverless');

function getApiGatewayMethod(command) {
  if (command instanceof GetUsagePlansCommand) return 'getUsagePlans';
  if (command instanceof UpdateUsagePlanCommand) return 'updateUsagePlan';
  throw new Error(`Unexpected APIGateway command: ${command.constructor.name}`);
}

describe('#disassociateUsagePlan()', () => {
  let serverless;
  let options;
  let awsProvider;
  let providerRequestStub;
  let apiGatewaySendStub;
  let cloudFormationSendStub;

  beforeEach(() => {
    serverless = new Serverless({ commands: [], options: {} });
    serverless.service.service = 'my-service';
    serverless.cli = {
      log: sinon.spy(),
    };
    options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    awsProvider = new AwsProvider(serverless, options);
    serverless.setProvider('aws', awsProvider);
    providerRequestStub = sinon.stub();
    apiGatewaySendStub = sinon
      .stub(APIGatewayClient.prototype, 'send')
      .callsFake((command) =>
        providerRequestStub('APIGateway', getApiGatewayMethod(command), command.input)
      );
    cloudFormationSendStub = sinon
      .stub(CloudFormationClient.prototype, 'send')
      .callsFake((command) => {
        if (command instanceof DescribeStackResourceCommand) {
          return providerRequestStub('CloudFormation', 'describeStackResource', command.input);
        }
        throw new Error(`Unexpected CloudFormation command: ${command.constructor.name}`);
      });

    disassociateUsagePlan.serverless = serverless;
    disassociateUsagePlan.options = options;
    disassociateUsagePlan.provider = awsProvider;

    providerRequestStub
      .withArgs('CloudFormation', 'describeStackResource')
      .resolves({ StackResourceDetail: { PhysicalResourceId: 'resource-id' } });
    providerRequestStub.withArgs('APIGateway', 'getUsagePlans', { limit: 500 }).resolves({
      items: [
        {
          apiStages: [
            {
              apiId: 'resource-id',
              stage: 'dev',
            },
            {
              apiId: 'another-resource-id',
              stage: 'prod',
            },
          ],
          id: 'usage-plan-id',
        },
        {
          apiStages: [
            {
              apiId: 'another-resource-id',
              stage: 'dev',
            },
          ],
          id: 'another-usage-plan-id',
        },
      ],
    });
    providerRequestStub.withArgs('APIGateway', 'updateUsagePlan').resolves();
  });

  afterEach(() => {
    apiGatewaySendStub.restore();
    cloudFormationSendStub.restore();
    delete disassociateUsagePlan.disassociateUsagePlanApiGatewayClientPromise;
    delete disassociateUsagePlan.disassociateUsagePlanCloudFormationClientPromise;
  });

  it('should remove association from the usage plan', async () => {
    disassociateUsagePlan.serverless.service.provider.apiGateway = { apiKeys: ['apiKey1'] };

    return disassociateUsagePlan.disassociateUsagePlan().then(() => {
      expect(providerRequestStub.callCount).to.be.equal(3);
      expect(cloudFormationSendStub.getCall(0).args[0]).to.be.instanceOf(
        DescribeStackResourceCommand
      );
      expect(apiGatewaySendStub.getCall(0).args[0]).to.be.instanceOf(GetUsagePlansCommand);
      expect(apiGatewaySendStub.getCall(1).args[0]).to.be.instanceOf(UpdateUsagePlanCommand);

      expect(
        providerRequestStub.calledWithExactly('CloudFormation', 'describeStackResource', {
          StackName: `${awsProvider.naming.getStackName()}`,
          LogicalResourceId: 'ApiGatewayRestApi',
        })
      ).to.be.equal(true);

      expect(
        providerRequestStub.calledWithExactly('APIGateway', 'getUsagePlans', { limit: 500 })
      ).to.be.equal(true);

      expect(
        providerRequestStub.calledWithExactly('APIGateway', 'updateUsagePlan', {
          usagePlanId: 'usage-plan-id',
          patchOperations: [
            {
              op: 'remove',
              path: '/apiStages',
              value: 'resource-id:dev',
            },
          ],
        })
      ).to.be.equal(true);
    });
  });

  it('should remove all matching associations from a usage plan', async () => {
    providerRequestStub.withArgs('APIGateway', 'getUsagePlans', { limit: 500 }).resolves({
      items: [
        {
          apiStages: [
            { apiId: 'resource-id', stage: 'dev' },
            { apiId: 'resource-id', stage: 'prod' },
            { apiId: 'another-resource-id', stage: 'dev' },
          ],
          id: 'usage-plan-id',
        },
      ],
    });
    disassociateUsagePlan.serverless.service.provider.apiGateway = { apiKeys: ['apiKey1'] };

    return disassociateUsagePlan.disassociateUsagePlan().then(() => {
      expect(providerRequestStub.callCount).to.be.equal(4);

      expect(
        providerRequestStub.calledWithExactly('APIGateway', 'updateUsagePlan', {
          usagePlanId: 'usage-plan-id',
          patchOperations: [
            {
              op: 'remove',
              path: '/apiStages',
              value: 'resource-id:dev',
            },
          ],
        })
      ).to.be.equal(true);
      expect(
        providerRequestStub.calledWithExactly('APIGateway', 'updateUsagePlan', {
          usagePlanId: 'usage-plan-id',
          patchOperations: [
            {
              op: 'remove',
              path: '/apiStages',
              value: 'resource-id:prod',
            },
          ],
        })
      ).to.be.equal(true);
      expect(
        providerRequestStub.calledWithExactly('APIGateway', 'updateUsagePlan', {
          usagePlanId: 'usage-plan-id',
          patchOperations: [
            {
              op: 'remove',
              path: '/apiStages',
              value: 'another-resource-id:dev',
            },
          ],
        })
      ).to.be.equal(false);
    });
  });

  it('should not update usage plans without matching API stages', async () => {
    providerRequestStub.withArgs('APIGateway', 'getUsagePlans', { limit: 500 }).resolves({
      items: [
        {
          apiStages: [{ apiId: 'another-resource-id', stage: 'dev' }],
          id: 'another-usage-plan-id',
        },
      ],
    });
    disassociateUsagePlan.serverless.service.provider.apiGateway = { apiKeys: ['apiKey1'] };

    return disassociateUsagePlan.disassociateUsagePlan().then(() => {
      expect(providerRequestStub.callCount).to.be.equal(2);
      expect(providerRequestStub.calledWith('APIGateway', 'updateUsagePlan')).to.be.equal(false);
    });
  });

  it('should remove matching usage plan associations across paginated usage plans', async () => {
    providerRequestStub.withArgs('APIGateway', 'getUsagePlans', { limit: 500 }).resolves({
      items: [
        {
          apiStages: [{ apiId: 'another-resource-id', stage: 'dev' }],
          id: 'first-page-plan-id',
        },
      ],
      position: 'next-page',
    });
    providerRequestStub
      .withArgs('APIGateway', 'getUsagePlans', { position: 'next-page', limit: 500 })
      .resolves({
        items: [
          {
            apiStages: [{ apiId: 'resource-id', stage: 'prod' }],
            id: 'second-page-plan-id',
          },
        ],
      });
    disassociateUsagePlan.serverless.service.provider.apiGateway = { apiKeys: ['apiKey1'] };

    await disassociateUsagePlan.disassociateUsagePlan();

    expect(
      providerRequestStub.args.filter(
        ([service, method]) => service === 'APIGateway' && method === 'getUsagePlans'
      )
    ).to.deep.equal([
      ['APIGateway', 'getUsagePlans', { limit: 500 }],
      ['APIGateway', 'getUsagePlans', { position: 'next-page', limit: 500 }],
    ]);
    expect(
      providerRequestStub.calledWithExactly('APIGateway', 'updateUsagePlan', {
        usagePlanId: 'second-page-plan-id',
        patchOperations: [
          {
            op: 'remove',
            path: '/apiStages',
            value: 'resource-id:prod',
          },
        ],
      })
    ).to.equal(true);
  });

  it('should not update usage plans without apiStages', async () => {
    providerRequestStub.withArgs('APIGateway', 'getUsagePlans', { limit: 500 }).resolves({
      items: [{ id: 'usage-plan-without-stages' }],
    });
    disassociateUsagePlan.serverless.service.provider.apiGateway = { apiKeys: ['apiKey1'] };

    await disassociateUsagePlan.disassociateUsagePlan();

    expect(providerRequestStub.calledWith('APIGateway', 'updateUsagePlan')).to.equal(false);
  });

  it('should resolve when getUsagePlans returns no items', async () => {
    providerRequestStub.withArgs('APIGateway', 'getUsagePlans', { limit: 500 }).resolves({});
    disassociateUsagePlan.serverless.service.provider.apiGateway = { apiKeys: ['apiKey1'] };

    await disassociateUsagePlan.disassociateUsagePlan();

    expect(providerRequestStub.calledWith('APIGateway', 'updateUsagePlan')).to.equal(false);
  });

  it('should limit concurrent usage plan updates to 2', async () => {
    let activeRequests = 0;
    let observedMaxActiveRequests = 0;
    const pendingResolvers = [];
    apiGatewaySendStub.callsFake(async (command) => {
      if (command instanceof GetUsagePlansCommand) {
        return {
          items: [
            {
              apiStages: Array.from({ length: 6 }, (_, index) => ({
                apiId: 'resource-id',
                stage: `stage-${index}`,
              })),
              id: 'usage-plan-id',
            },
          ],
        };
      }
      if (command instanceof UpdateUsagePlanCommand) {
        activeRequests += 1;
        observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
        expect(activeRequests).to.be.at.most(2);
        await new Promise((resolve) => pendingResolvers.push(resolve));
        activeRequests -= 1;
        return {};
      }
      throw new Error(`Unexpected APIGateway command: ${command.constructor.name}`);
    });
    disassociateUsagePlan.serverless.service.provider.apiGateway = { apiKeys: ['apiKey1'] };

    const promise = disassociateUsagePlan.disassociateUsagePlan();
    for (let index = 0; index < 20 && pendingResolvers.length < 2; index += 1) {
      await Promise.resolve();
    }
    expect(observedMaxActiveRequests).to.equal(2);
    await releasePendingRequestsUntilSettled(pendingResolvers, promise);
    expect(observedMaxActiveRequests).to.equal(2);
    expect(
      apiGatewaySendStub
        .getCalls()
        .map((call) => call.args[0])
        .filter((command) => command instanceof UpdateUsagePlanCommand)
    ).to.have.length(6);
  });

  it('uses existing API Gateway and CloudFormation client promises from the plugin context', async () => {
    disassociateUsagePlan.serverless.service.provider.apiGateway = { apiKeys: ['apiKey1'] };
    const cloudFormationSend = sinon.stub().callsFake(async (command) => {
      if (command instanceof DescribeStackResourceCommand) {
        return { StackResourceDetail: { PhysicalResourceId: 'resource-id' } };
      }
      throw new Error(`Unexpected CloudFormation command: ${command.constructor.name}`);
    });
    const apiGatewaySend = sinon.stub().callsFake(async (command) => {
      if (command instanceof GetUsagePlansCommand) {
        return {
          items: [
            {
              apiStages: [{ apiId: 'resource-id', stage: 'dev' }],
              id: 'usage-plan-id',
            },
          ],
        };
      }
      if (command instanceof UpdateUsagePlanCommand) return {};
      throw new Error(`Unexpected APIGateway command: ${command.constructor.name}`);
    });
    const getAwsSdkV3ConfigStub = sinon
      .stub(awsProvider, 'getAwsSdkV3Config')
      .throws(new Error('Expected existing clients to be reused'));
    disassociateUsagePlan.disassociateUsagePlanCloudFormationClientPromise = Promise.resolve({
      send: cloudFormationSend,
    });
    disassociateUsagePlan.disassociateUsagePlanApiGatewayClientPromise = Promise.resolve({
      send: apiGatewaySend,
    });

    try {
      await disassociateUsagePlan.disassociateUsagePlan();

      expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
      expect(cloudFormationSend).to.have.been.calledOnce;
      expect(cloudFormationSend.firstCall.args[0]).to.be.instanceOf(DescribeStackResourceCommand);
      expect(apiGatewaySend).to.have.been.calledTwice;
      expect(apiGatewaySend.firstCall.args[0]).to.be.instanceOf(GetUsagePlansCommand);
      expect(apiGatewaySend.secondCall.args[0]).to.be.instanceOf(UpdateUsagePlanCommand);
      expect(apiGatewaySend.secondCall.args[0].input).to.deep.equal({
        usagePlanId: 'usage-plan-id',
        patchOperations: [
          {
            op: 'remove',
            path: '/apiStages',
            value: 'resource-id:dev',
          },
        ],
      });
    } finally {
      getAwsSdkV3ConfigStub.restore();
    }
  });

  it('does not share request handlers between API Gateway and CloudFormation clients', async () => {
    const credentials = async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' });
    const cloudFormationRequestHandler = {};
    const apiGatewayRequestHandler = {};
    const apiGatewayClients = [];
    const cloudFormationClients = [];
    class FakeCommand {
      constructor(input) {
        this.input = input;
      }
    }
    class FakeGetUsagePlansCommand extends FakeCommand {}
    class FakeUpdateUsagePlanCommand extends FakeCommand {}
    class FakeDescribeStackResourceCommand extends FakeCommand {}
    class FakeAPIGatewayClient {
      constructor(config) {
        this.config = config;
        apiGatewayClients.push(this);
      }

      async send(command) {
        if (command instanceof FakeGetUsagePlansCommand) return { items: [] };
        if (command instanceof FakeUpdateUsagePlanCommand) return {};
        throw new Error(`Unexpected APIGateway command: ${command.constructor.name}`);
      }
    }
    class FakeCloudFormationClient {
      constructor(config) {
        this.config = config;
        cloudFormationClients.push(this);
      }

      async send(command) {
        if (command instanceof FakeDescribeStackResourceCommand) {
          return { StackResourceDetail: { PhysicalResourceId: 'resource-id' } };
        }
        throw new Error(`Unexpected CloudFormation command: ${command.constructor.name}`);
      }
    }
    const disassociateUsagePlanWithClientStubs = proxyquire(
      '../../../../../../../../../../../lib/plugins/aws/package/compile/events/api-gateway/lib/hack/disassociate-usage-plan',
      {
        '@aws-sdk/client-api-gateway': {
          APIGatewayClient: FakeAPIGatewayClient,
          GetUsagePlansCommand: FakeGetUsagePlansCommand,
          UpdateUsagePlanCommand: FakeUpdateUsagePlanCommand,
        },
        '@aws-sdk/client-cloudformation': {
          CloudFormationClient: FakeCloudFormationClient,
          DescribeStackResourceCommand: FakeDescribeStackResourceCommand,
        },
      }
    );
    const getAwsSdkV3ConfigStub = sinon.stub(awsProvider, 'getAwsSdkV3Config');
    getAwsSdkV3ConfigStub.onFirstCall().resolves({
      credentials,
      region: 'us-east-1',
      requestHandler: cloudFormationRequestHandler,
    });
    getAwsSdkV3ConfigStub.onSecondCall().resolves({
      credentials,
      region: 'us-east-1',
      requestHandler: apiGatewayRequestHandler,
    });
    disassociateUsagePlanWithClientStubs.serverless = serverless;
    disassociateUsagePlanWithClientStubs.options = options;
    disassociateUsagePlanWithClientStubs.provider = awsProvider;
    disassociateUsagePlanWithClientStubs.serverless.service.provider.apiGateway = {
      apiKeys: ['apiKey1'],
    };

    try {
      await disassociateUsagePlanWithClientStubs.disassociateUsagePlan();

      expect(getAwsSdkV3ConfigStub).to.have.been.calledTwice;
      expect(apiGatewayClients).to.have.length(1);
      expect(cloudFormationClients).to.have.length(1);
      expect(apiGatewayClients[0].config.credentials).to.equal(credentials);
      expect(cloudFormationClients[0].config.credentials).to.equal(credentials);
      expect(cloudFormationClients[0].config.requestHandler).to.equal(cloudFormationRequestHandler);
      expect(apiGatewayClients[0].config.requestHandler).to.equal(apiGatewayRequestHandler);
      expect(cloudFormationClients[0].config.requestHandler).to.not.equal(
        apiGatewayClients[0].config.requestHandler
      );
    } finally {
      getAwsSdkV3ConfigStub.restore();
    }
  });

  it('runs usage plan cleanup during the remove lifecycle', async () => {
    const { awsSdkV3Stub } = await runServerless({
      fixture: 'api-gateway',
      command: 'remove',
      lastLifecycleHookName: 'before:remove:remove',
      configExt: {
        provider: {
          apiGateway: { apiKeys: ['apiKey1'] },
        },
      },
      awsSdkV3StubMap: {
        CloudFormation: {
          describeStackResource: {
            StackResourceDetail: { PhysicalResourceId: 'api-id' },
          },
        },
        APIGateway: {
          getUsagePlans: {
            items: [{ id: 'plan-id', apiStages: [{ apiId: 'api-id', stage: 'dev' }] }],
          },
          updateUsagePlan: {},
        },
        STS: {
          getCallerIdentity: { Account: '999999999999' },
        },
      },
    });

    expect(awsSdkV3Stub.sends.map(({ commandName }) => commandName)).to.include.members([
      'DescribeStackResourceCommand',
      'GetUsagePlansCommand',
      'UpdateUsagePlanCommand',
    ]);
    expect(
      awsSdkV3Stub.sends.find(({ method }) => method === 'updateUsagePlan').input
    ).to.deep.equal({
      usagePlanId: 'plan-id',
      patchOperations: [
        {
          op: 'remove',
          path: '/apiStages',
          value: 'api-id:dev',
        },
      ],
    });
  });

  it('should resolve if no api keys are given', async () => {
    disassociateUsagePlan.serverless.service.provider.apiGateway = { apiKeys: [] };

    return disassociateUsagePlan.disassociateUsagePlan().then(() => {
      expect(providerRequestStub.callCount).to.be.equal(0);
    });
  });
});
