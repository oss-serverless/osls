'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const AwsInfo = require('../../../../../../lib/plugins/aws/info/index');
const { retryOnThrottlingError } = require('../../../../../../lib/aws/retry');
const {
  CloudFormationClient,
  DescribeStacksCommand,
  ListExportsCommand,
} = require('@aws-sdk/client-cloudformation');
const { ApiGatewayV2Client, GetApiCommand } = require('@aws-sdk/client-apigatewayv2');

const fastRetry = {
  retryOnThrottlingError: (task, options) =>
    retryOnThrottlingError(task, { ...options, delayMs: 1 }),
};
const createThrottlingError = () =>
  Object.assign(new Error('Rate exceeded'), { name: 'Throttling' });

function upperFirst(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function createServerlessContext(options) {
  const provider = {
    getStage: () => options.stage,
    getRegion: () => options.region,
    getAwsSdkV3Config: async () => ({ region: options.region }),
    naming: {
      getStackName: () => 'my-service-dev',
      getServiceEndpointRegex: () => /^(ServiceEndpoint|HttpApiUrl)$/,
      getLambdaFunctionUrlOutputLogicalId: (functionName) =>
        `${upperFirst(functionName)}LambdaFunctionUrl`,
      getLambdaLayerOutputLogicalId: (layerName) =>
        `${upperFirst(layerName)}LambdaLayerQualifiedArn`,
      getCloudFrontDistributionDomainNameLogicalId: () => 'CloudFrontDistributionDomainName',
    },
  };
  const service = {
    service: 'my-service',
    provider: {},
    functions: {},
    layers: {},
    getAllFunctions() {
      return Object.keys(this.functions);
    },
    getFunction(functionName) {
      return this.functions[functionName];
    },
    getAllLayers() {
      return Object.keys(this.layers || {});
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

describe('#getStackInfo()', () => {
  let serverless;
  let awsInfo;
  let describeStacksStub;
  let getApiStub;

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    ({ serverless } = createServerlessContext(options));
    serverless.service.functions = {
      hello: { name: 'my-service-dev-hello' },
      world: { name: 'customized' },
    };
    serverless.service.layers = { test: {} };
    awsInfo = new AwsInfo(serverless, options);

    describeStacksStub = sinon.stub(CloudFormationClient.prototype, 'send');
    getApiStub = sinon.stub(ApiGatewayV2Client.prototype, 'send');
  });

  afterEach(() => {
    CloudFormationClient.prototype.send.restore();
    ApiGatewayV2Client.prototype.send.restore();
  });

  it('attach info from describeStack call to this.gatheredData if result is available', async () => {
    const describeStacksResponse = {
      Stacks: [
        {
          StackId:
            'arn:aws:cloudformation:us-east-1:123456789012:' +
            'stack/myteststack/466df9e0-0dff-08e3-8e2f-5088487c4896',
          Description:
            'AWS CloudFormation Sample Template S3_Bucket: ' +
            'Sample template showing how to create a publicly accessible S3 bucket.',
          Tags: [],
          Outputs: [
            {
              Description: 'URL of the service endpoint',
              OutputKey: 'ServiceEndpoint',
              OutputValue: 'ab12cd34ef.execute-api.us-east-1.amazonaws.com/dev',
            },
            {
              Description: 'first',
              OutputKey: 'ApiGatewayApiKey1Value',
              OutputValue: 'xxx',
            },
            {
              Description: 'second',
              OutputKey: 'ApiGatewayApiKey2Value',
              OutputValue: 'yyy',
            },
            {
              Description: 'Current Lambda layer version',
              OutputKey: 'TestLambdaLayerQualifiedArn',
              OutputValue: 'arn:aws:lambda:region:NNNNNNNNNNNN:layer:test:1',
            },
            {
              Description: 'CloudFront Distribution Id',
              OutputKey: 'CloudFrontDistribution',
              OutputValue: 'a12bcdef3g45hi',
            },
            {
              Description: 'CloudFront Distribution Domain Name',
              OutputKey: 'CloudFrontDistributionDomainName',
              OutputValue: 'a12bcdef3g45hi.cloudfront.net',
            },
          ],
          StackStatusReason: null,
          CreationTime: '2013-08-23T01:02:15.422Z',
          Capabilities: [],
          StackName: 'myteststack',
          StackStatus: 'CREATE_COMPLETE',
          DisableRollback: false,
        },
      ],
    };

    describeStacksStub.resolves(describeStacksResponse);

    const expectedGatheredDataObj = {
      info: {
        functions: [
          {
            name: 'hello',
            deployedName: 'my-service-dev-hello',
            artifactSize: undefined,
          },
          {
            name: 'world',
            deployedName: 'customized',
            artifactSize: undefined,
          },
        ],
        layers: [
          {
            name: 'test',
            arn: 'arn:aws:lambda:region:NNNNNNNNNNNN:layer:test:1',
          },
        ],

        endpoints: ['ab12cd34ef.execute-api.us-east-1.amazonaws.com/dev'],
        cloudFront: 'a12bcdef3g45hi.cloudfront.net',
        service: 'my-service',
        stage: 'dev',
        region: 'us-east-1',
        stack: 'my-service-dev',
      },
      outputs: [
        {
          Description: 'URL of the service endpoint',
          OutputKey: 'ServiceEndpoint',
          OutputValue: 'ab12cd34ef.execute-api.us-east-1.amazonaws.com/dev',
        },
        {
          Description: 'first',
          OutputKey: 'ApiGatewayApiKey1Value',
          OutputValue: 'xxx',
        },
        {
          Description: 'second',
          OutputKey: 'ApiGatewayApiKey2Value',
          OutputValue: 'yyy',
        },
        {
          Description: 'Current Lambda layer version',
          OutputKey: 'TestLambdaLayerQualifiedArn',
          OutputValue: 'arn:aws:lambda:region:NNNNNNNNNNNN:layer:test:1',
        },
        {
          Description: 'CloudFront Distribution Id',
          OutputKey: 'CloudFrontDistribution',
          OutputValue: 'a12bcdef3g45hi',
        },
        {
          Description: 'CloudFront Distribution Domain Name',
          OutputKey: 'CloudFrontDistributionDomainName',
          OutputValue: 'a12bcdef3g45hi.cloudfront.net',
        },
      ],
    };

    return awsInfo.getStackInfo().then(() => {
      expect(describeStacksStub.calledOnce).to.equal(true);
      expect(describeStacksStub.firstCall.args[0]).to.be.instanceOf(DescribeStacksCommand);
      expect(describeStacksStub.firstCall.args[0].input).to.deep.equal({
        StackName: awsInfo.provider.naming.getStackName(),
      });

      expect(awsInfo.gatheredData).to.deep.equal(expectedGatheredDataObj);
    });
  });

  it('should resolve if result is empty', async () => {
    const describeStacksResponse = null;

    describeStacksStub.resolves(describeStacksResponse);

    const expectedGatheredDataObj = {
      info: {
        functions: [],
        layers: [],
        endpoints: [],
        service: 'my-service',
        stage: 'dev',
        region: 'us-east-1',
        stack: 'my-service-dev',
      },
      outputs: [],
    };

    return awsInfo.getStackInfo().then(() => {
      expect(describeStacksStub.calledOnce).to.equal(true);
      expect(describeStacksStub.firstCall.args[0]).to.be.instanceOf(DescribeStacksCommand);
      expect(describeStacksStub.firstCall.args[0].input).to.deep.equal({
        StackName: awsInfo.provider.naming.getStackName(),
      });

      expect(awsInfo.gatheredData).to.deep.equal(expectedGatheredDataObj);
    });
  });

  it('uses an existing CloudFormation client promise from the info context', async () => {
    const send = sinon.stub().resolves(null);
    const getAwsSdkV3ConfigStub = sinon
      .stub(awsInfo.provider, 'getAwsSdkV3Config')
      .throws(new Error('Expected existing CloudFormation client to be reused'));
    awsInfo.cloudFormationClientPromise = Promise.resolve({ send });

    try {
      await awsInfo.getStackInfo();

      expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
      expect(send).to.have.been.calledOnce;
      expect(send.firstCall.args[0]).to.be.instanceOf(DescribeStacksCommand);
      expect(send.firstCall.args[0].input).to.deep.equal({
        StackName: awsInfo.provider.naming.getStackName(),
      });
    } finally {
      getAwsSdkV3ConfigStub.restore();
    }
  });

  it('retries the stack description on throttling errors', async () => {
    describeStacksStub
      .onFirstCall()
      .rejects(createThrottlingError())
      .onSecondCall()
      .resolves({ Stacks: [{ Outputs: [] }] });
    const getStackInfoWithFastRetry = proxyquire(
      '../../../../../../lib/plugins/aws/info/get-stack-info',
      { '../../../aws/retry': fastRetry }
    );

    await getStackInfoWithFastRetry.getStackInfo.call(awsInfo);

    expect(describeStacksStub).to.have.been.calledTwice;
    expect(awsInfo.gatheredData.outputs).to.deep.equal([]);
  });

  it('uses an existing API Gateway V2 client promise from the info context', async () => {
    serverless.service.provider.httpApi = {
      id: 'http-api-id',
    };
    const cloudFormationSend = sinon.stub().resolves(null);
    const apiGatewaySend = sinon.stub().resolves({ ApiEndpoint: 'my-endpoint' });
    const getAwsSdkV3ConfigStub = sinon
      .stub(awsInfo.provider, 'getAwsSdkV3Config')
      .throws(new Error('Expected existing clients to be reused'));
    awsInfo.cloudFormationClientPromise = Promise.resolve({ send: cloudFormationSend });
    awsInfo.apiGatewayV2ClientPromise = Promise.resolve({ send: apiGatewaySend });

    try {
      await awsInfo.getStackInfo();

      expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
      expect(cloudFormationSend).to.have.been.calledOnce;
      expect(cloudFormationSend.firstCall.args[0]).to.be.instanceOf(DescribeStacksCommand);
      expect(apiGatewaySend).to.have.been.calledOnce;
      expect(apiGatewaySend.firstCall.args[0]).to.be.instanceOf(GetApiCommand);
      expect(apiGatewaySend.firstCall.args[0].input).to.deep.equal({ ApiId: 'http-api-id' });
      expect(awsInfo.gatheredData.info.endpoints).to.deep.equal(['httpApi: my-endpoint']);
    } finally {
      getAwsSdkV3ConfigStub.restore();
    }
  });

  it('should attach info from api gateway if httpApi is used', async () => {
    serverless.service.provider.httpApi = {
      id: 'http-api-id',
    };

    describeStacksStub.resolves(null);
    getApiStub.resolves({
      ApiEndpoint: 'my-endpoint',
    });

    const expectedGatheredDataObj = {
      info: {
        functions: [],
        layers: [],
        endpoints: ['httpApi: my-endpoint'],
        service: 'my-service',
        stage: 'dev',
        region: 'us-east-1',
        stack: 'my-service-dev',
      },
      outputs: [],
    };

    return awsInfo.getStackInfo().then(() => {
      expect(describeStacksStub).to.have.been.calledOnce;
      expect(describeStacksStub.firstCall.args[0].input).to.deep.equal({
        StackName: awsInfo.provider.naming.getStackName(),
      });
      expect(getApiStub).to.have.been.calledOnce;
      expect(getApiStub.firstCall.args[0]).to.be.instanceOf(GetApiCommand);
      expect(getApiStub.firstCall.args[0].input).to.deep.equal({ ApiId: 'http-api-id' });

      expect(awsInfo.gatheredData).to.deep.equal(expectedGatheredDataObj);
    });
  });

  it('resolves imported httpApi id with the info CloudFormation client', async () => {
    serverless.service.provider.httpApi = {
      id: { 'Fn::ImportValue': 'exported-http-api-id' },
    };
    const getAwsSdkV3ConfigSpy = sinon.spy(awsInfo.provider, 'getAwsSdkV3Config');
    describeStacksStub.callsFake(async (command) => {
      if (command instanceof DescribeStacksCommand) return null;
      if (command instanceof ListExportsCommand) {
        if (!command.input.NextToken) return { Exports: [], NextToken: 'next' };
        return {
          Exports: [{ Name: 'exported-http-api-id', Value: 'imported-http-api-id' }],
        };
      }
      throw new Error(`Unexpected CloudFormation command ${command.constructor.name}`);
    });
    getApiStub.resolves({ ApiEndpoint: 'imported-endpoint' });

    try {
      await awsInfo.getStackInfo();

      expect(getAwsSdkV3ConfigSpy).to.have.been.calledTwice;
      expect(describeStacksStub).to.have.been.calledThrice;
      expect(describeStacksStub.firstCall.args[0]).to.be.instanceOf(DescribeStacksCommand);
      expect(describeStacksStub.firstCall.args[0].input).to.deep.equal({
        StackName: awsInfo.provider.naming.getStackName(),
      });
      expect(describeStacksStub.secondCall.args[0]).to.be.instanceOf(ListExportsCommand);
      expect(describeStacksStub.secondCall.args[0].input).to.deep.equal({});
      expect(describeStacksStub.thirdCall.args[0]).to.be.instanceOf(ListExportsCommand);
      expect(describeStacksStub.thirdCall.args[0].input).to.deep.equal({ NextToken: 'next' });
      expect(describeStacksStub.secondCall.thisValue).to.equal(
        describeStacksStub.firstCall.thisValue
      );
      expect(describeStacksStub.thirdCall.thisValue).to.equal(
        describeStacksStub.firstCall.thisValue
      );
      expect(getApiStub).to.have.been.calledOnce;
      expect(getApiStub.firstCall.args[0]).to.be.instanceOf(GetApiCommand);
      expect(getApiStub.firstCall.args[0].input).to.deep.equal({ ApiId: 'imported-http-api-id' });
      expect(awsInfo.gatheredData.info.endpoints).to.deep.equal(['httpApi: imported-endpoint']);
    } finally {
      getAwsSdkV3ConfigSpy.restore();
    }
  });
});
