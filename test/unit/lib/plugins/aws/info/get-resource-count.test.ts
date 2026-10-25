'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const AwsInfo = require('../../../../../../lib/plugins/aws/info/index');
const { retryOnThrottlingError } = require('../../../../../../lib/aws/retry');
const {
  CloudFormationClient,
  ListStackResourcesCommand,
} = require('@aws-sdk/client-cloudformation');

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
        functions: {},
      },
      getProvider: sinon.stub().withArgs('aws').returns(provider),
    },
  };
}

describe('#getResourceCount()', () => {
  let serverless;
  let awsInfo;
  let listStackResourcesStub;

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    ({ serverless } = createServerlessContext(options));
    serverless.service.functions = {
      hello: {},
      world: {},
    };
    awsInfo = new AwsInfo(serverless, options);

    listStackResourcesStub = sinon.stub(CloudFormationClient.prototype, 'send');
  });

  afterEach(() => {
    if (awsInfo.provider.getAwsSdkV3Config.restore) {
      awsInfo.provider.getAwsSdkV3Config.restore();
    }
    CloudFormationClient.prototype.send.restore();
  });

  it('attach resourceCount to this.gatheredData after listStackResources call', async () => {
    const listStackResourcesResponse = {
      ResponseMetadata: { RequestId: '81386aed-258b-11e8-b3e8-a937105b7db3' },
      StackResourceSummaries: [
        {
          LogicalResourceId: 'ApiGatewayDeployment1520814106863',
          PhysicalResourceId: 'eoa2a2',
          ResourceType: 'AWS::ApiGateway::Deployment',
          LastUpdatedTimestamp: '2018-03-12T00:22:40.680Z',
          ResourceStatus: 'CREATE_COMPLETE',
        },
        {
          LogicalResourceId: 'ApiGatewayMethodHelloGet',
          PhysicalResourceId: 'hello-ApiGa-11R27BUE48W38',
          ResourceType: 'AWS::ApiGateway::Method',
          LastUpdatedTimestamp: '2018-03-12T00:22:37.478Z',
          ResourceStatus: 'CREATE_COMPLETE',
        },
        {
          LogicalResourceId: 'ApiGatewayResourceHello',
          PhysicalResourceId: 'az5f7l',
          ResourceType: 'AWS::ApiGateway::Resource',
          LastUpdatedTimestamp: '2018-03-12T00:22:22.916Z',
          ResourceStatus: 'CREATE_COMPLETE',
        },
        {
          LogicalResourceId: 'ApiGatewayRestApi',
          PhysicalResourceId: 'n1uk4p7kl0',
          ResourceType: 'AWS::ApiGateway::RestApi',
          LastUpdatedTimestamp: '2018-03-12T00:22:19.768Z',
          ResourceStatus: 'CREATE_COMPLETE',
        },
        {
          LogicalResourceId: 'HelloLambdaFunction',
          PhysicalResourceId: 'hello-world-2-dev-hello',
          ResourceType: 'AWS::Lambda::Function',
          LastUpdatedTimestamp: '2018-03-12T00:22:34.095Z',
          ResourceStatus: 'CREATE_COMPLETE',
        },
        {
          LogicalResourceId: 'HelloLambdaPermissionApiGateway',
          PhysicalResourceId: 'hello-world-2-dev-HelloLambdaPermissionApiGateway-18KKZXJG1DPF5',
          ResourceType: 'AWS::Lambda::Permission',
          LastUpdatedTimestamp: '2018-03-12T00:22:46.950Z',
          ResourceStatus: 'CREATE_COMPLETE',
        },
        {
          LogicalResourceId: 'HelloLambdaVersiongZDaMtQjEhvXacHdpTLnQ61zDCdI2IWVYCbuE50pj8',
          PhysicalResourceId:
            'arn:aws:lambda:us-east-1:111111111:function:hello-world-2-dev-hello:2',
          ResourceType: 'AWS::Lambda::Version',
          LastUpdatedTimestamp: '2018-03-12T00:22:37.256Z',
          ResourceStatus: 'CREATE_COMPLETE',
        },
        {
          LogicalResourceId: 'HelloLogGroup',
          PhysicalResourceId: '/aws/lambda/hello-world-2-dev-hello',
          ResourceType: 'AWS::Logs::LogGroup',
          LastUpdatedTimestamp: '2018-03-12T00:22:20.095Z',
          ResourceStatus: 'CREATE_COMPLETE',
        },
        {
          LogicalResourceId: 'IamRoleLambdaExecution',
          PhysicalResourceId: 'hello-world-2-dev-us-east-1-lambdaRole',
          ResourceType: 'AWS::IAM::Role',
          LastUpdatedTimestamp: '2018-03-12T00:22:30.995Z',
          ResourceStatus: 'CREATE_COMPLETE',
        },
        {
          LogicalResourceId: 'ServerlessDeploymentBucket',
          PhysicalResourceId: 'hello-world-2-dev-serverlessdeploymentbucket-1e3l68m8zaz7i',
          ResourceType: 'AWS::S3::Bucket',
          LastUpdatedTimestamp: '2018-03-12T00:22:11.380Z',
          ResourceStatus: 'CREATE_COMPLETE',
        },
      ],
    };

    listStackResourcesStub.resolves(listStackResourcesResponse);

    awsInfo.gatheredData = {
      info: {
        functions: [],
        endpoints: [],
        service: '',
        stage: '',
        region: '',
        stack: '',
      },
      outputs: [],
    };

    return expect(awsInfo.getResourceCount()).to.be.fulfilled.then(() => {
      expect(listStackResourcesStub.calledOnce).to.equal(true);
      expect(listStackResourcesStub.firstCall.args[0]).to.be.instanceOf(ListStackResourcesCommand);
      expect(listStackResourcesStub.firstCall.args[0].input).to.deep.equal({
        StackName: awsInfo.provider.naming.getStackName(),
      });

      expect(awsInfo.gatheredData.info.resourceCount).to.equal(10);
    });
  });

  it('accumulates resourceCount across paginated listStackResources calls', async () => {
    const getAwsSdkV3ConfigSpy = sinon.spy(awsInfo.provider, 'getAwsSdkV3Config');
    listStackResourcesStub
      .onFirstCall()
      .resolves({ StackResourceSummaries: [{}, {}], NextToken: 'next' })
      .onSecondCall()
      .resolves({ StackResourceSummaries: [{}] });

    awsInfo.gatheredData = { info: {}, outputs: [] };

    await awsInfo.getResourceCount();

    expect(listStackResourcesStub).to.have.been.calledTwice;
    expect(listStackResourcesStub.firstCall.args[0]).to.be.instanceOf(ListStackResourcesCommand);
    expect(listStackResourcesStub.firstCall.args[0].input).to.deep.equal({
      StackName: awsInfo.provider.naming.getStackName(),
    });
    expect(listStackResourcesStub.secondCall.thisValue).to.equal(
      listStackResourcesStub.firstCall.thisValue
    );
    expect(getAwsSdkV3ConfigSpy).to.have.been.calledOnce;
    expect(listStackResourcesStub.secondCall.args[0].input).to.deep.equal({
      StackName: awsInfo.provider.naming.getStackName(),
      NextToken: 'next',
    });
    expect(awsInfo.gatheredData.info.resourceCount).to.equal(3);
  });

  it('retries the stack resources listing on throttling errors', async () => {
    listStackResourcesStub
      .onFirstCall()
      .rejects(createThrottlingError())
      .onSecondCall()
      .resolves({ StackResourceSummaries: [{}, {}] });
    awsInfo.gatheredData = { info: {}, outputs: [] };
    const getResourceCountWithFastRetry = proxyquire(
      '../../../../../../lib/plugins/aws/info/get-resource-count',
      { '../../../aws/retry': fastRetry }
    );

    await getResourceCountWithFastRetry.getResourceCount.call(awsInfo);

    expect(listStackResourcesStub).to.have.been.calledTwice;
    expect(awsInfo.gatheredData.info.resourceCount).to.equal(2);
  });

  it('uses an existing CloudFormation client promise from the info context', async () => {
    const send = sinon.stub().resolves({ StackResourceSummaries: [{}, {}] });
    const getAwsSdkV3ConfigStub = sinon
      .stub(awsInfo.provider, 'getAwsSdkV3Config')
      .throws(new Error('Expected existing CloudFormation client to be reused'));
    awsInfo.cloudFormationClientPromise = Promise.resolve({ send });
    awsInfo.gatheredData = { info: {}, outputs: [] };

    try {
      await awsInfo.getResourceCount();

      expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
      expect(send).to.have.been.calledOnce;
      expect(send.firstCall.args[0]).to.be.instanceOf(ListStackResourcesCommand);
      expect(send.firstCall.args[0].input).to.deep.equal({
        StackName: awsInfo.provider.naming.getStackName(),
      });
      expect(awsInfo.gatheredData.info.resourceCount).to.equal(2);
    } finally {
      getAwsSdkV3ConfigStub.restore();
    }
  });

  it('treats missing StackResourceSummaries as an empty page', async () => {
    listStackResourcesStub.resolves({});

    awsInfo.gatheredData = { info: {}, outputs: [] };

    await awsInfo.getResourceCount();

    expect(awsInfo.gatheredData.info.resourceCount).to.equal(0);
  });
});
