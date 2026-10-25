'use strict';

const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const {
  APIGatewayClient,
  CreateStageCommand,
  GetDeploymentsCommand,
  GetRestApisCommand,
  GetStageCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateStageCommand,
} = require('@aws-sdk/client-api-gateway');
const { CloudWatchLogsClient, DeleteLogGroupCommand } = require('@aws-sdk/client-cloudwatch-logs');
const Serverless = require('../../../../../../../../../../../lib/serverless');
const AwsProvider = require('../../../../../../../../../../../lib/plugins/aws/provider');
const {
  updateStage,
  defaultApiGatewayLogLevel,
} = require('../../../../../../../../../../../lib/plugins/aws/package/compile/events/api-gateway/lib/hack/update-stage');
const runServerless = require('../../../../../../../../../../utils/run-serverless');

const { expect } = chai;

function getApiGatewayMethod(command) {
  if (command instanceof GetRestApisCommand) return 'getRestApis';
  if (command instanceof GetDeploymentsCommand) return 'getDeployments';
  if (command instanceof GetStageCommand) return 'getStage';
  if (command instanceof CreateStageCommand) return 'createStage';
  if (command instanceof UpdateStageCommand) return 'updateStage';
  if (command instanceof TagResourceCommand) return 'tagResource';
  if (command instanceof UntagResourceCommand) return 'untagResource';
  throw new Error(`Unexpected APIGateway command: ${command.constructor.name}`);
}

describe('#updateStage()', () => {
  let serverless;
  let options;
  let awsProvider;
  let providerGetAccountInfoStub;
  let providerRequestStub;
  let apiGatewaySendStub;
  let cloudWatchLogsSendStub;
  let context;

  beforeEach(() => {
    serverless = new Serverless({ commands: [], options: {} });
    serverless.service.service = 'my-service';
    options = { stage: 'dev', region: 'us-east-1' };
    awsProvider = new AwsProvider(serverless, options);
    serverless.setProvider('aws', awsProvider);
    // Ensure that memoized function will be properly stubbed
    awsProvider.getAccountInfo;
    providerGetAccountInfoStub = sinon.stub(awsProvider, 'getAccountInfo').resolves({
      accountId: '123456',
      partition: 'aws',
    });
    providerRequestStub = sinon.stub();
    apiGatewaySendStub = sinon
      .stub(APIGatewayClient.prototype, 'send')
      .callsFake((command) =>
        providerRequestStub('APIGateway', getApiGatewayMethod(command), command.input)
      );
    cloudWatchLogsSendStub = sinon
      .stub(CloudWatchLogsClient.prototype, 'send')
      .callsFake((command) => {
        if (command instanceof DeleteLogGroupCommand) {
          return providerRequestStub('CloudWatchLogs', 'deleteLogGroup', command.input);
        }
        throw new Error(`Unexpected CloudWatchLogs command: ${command.constructor.name}`);
      });
    serverless.service.provider.compiledCloudFormationTemplate = {
      Resources: {
        ApiGatewayRestApi: {
          Type: 'AWS::ApiGateway::RestApi',
          Properties: {
            Name: 'dev-my-service',
          },
        },
        ApiGatewayRestApiDeployment: {
          Type: 'AWS::ApiGateway::Deployment',
          Properties: {
            RestApiId: {
              Ref: 'ApiGatewayRestApi',
            },
          },
        },
      },
    };

    context = {
      serverless,
      options,
      state: {
        service: {
          service: serverless.service.service,
          provider: structuredClone(serverless.service.provider),
          functions: structuredClone(serverless.service.functions),
        },
      },
      provider: awsProvider,
    };

    providerRequestStub
      .withArgs('APIGateway', 'getRestApis', {
        limit: 500,
        position: undefined,
      })
      .resolves({
        items: [
          { name: 'dev-my-service', id: 'devRestApiId' },
          { name: 'prod-my-service', id: 'prodRestApiId' },
          { name: 'custom-rest-api-name', id: 'customRestApiId' },
        ],
      });
    providerRequestStub
      .withArgs('APIGateway', 'getDeployments', {
        restApiId: 'devRestApiId',
        limit: 500,
      })
      .resolves({
        items: [{ id: 'someDeploymentId' }],
      });
    providerRequestStub
      .withArgs('APIGateway', 'getStage', {
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .resolves({
        tags: {
          old: 'tag',
        },
      });
    providerRequestStub
      .withArgs('APIGateway', 'getStage', {
        restApiId: 'prodRestApiId',
        stageName: 'prod',
      })
      .resolves({
        tags: {
          old: 'tag',
        },
      });
    providerRequestStub
      .withArgs('APIGateway', 'getStage', {
        restApiId: 'customRestApiId',
        stageName: 'dev',
      })
      .resolves({
        tags: {
          old: 'tag',
        },
      });

    providerRequestStub
      .withArgs('CloudWatchLogs', 'deleteLogGroup', {
        logGroupName: '/aws/api-gateway/my-service-dev',
      })
      .resolves();
    providerRequestStub
      .withArgs('CloudWatchLogs', 'deleteLogGroup', {
        logGroupName: '/aws/api-gateway/my-service-prod',
      })
      .resolves();
  });

  afterEach(() => {
    awsProvider.getAccountInfo.restore();
    apiGatewaySendStub.restore();
    cloudWatchLogsSendStub.restore();
  });

  it('should update the stage based on the serverless file configuration', async () => {
    context.state.service.provider.tags = {
      'Containing Space': 'bar',
      'bar': 'high-priority',
    };
    context.state.service.provider.stackTags = {
      bar: 'low-priority',
      num: 123,
    };
    context.state.service.provider.tracing = {
      apiGateway: true,
    };
    context.state.service.provider.apiGateway = {
      metrics: true,
    };
    context.state.service.provider.logs = {
      restApi: true,
    };

    return updateStage.call(context).then(() => {
      const patchOperations = [
        { op: 'replace', path: '/tracingEnabled', value: 'true' },
        { op: 'replace', path: '/*/*/metrics/enabled', value: 'true' },
        {
          op: 'replace',
          path: '/accessLogSettings/destinationArn',
          value: 'arn:aws:logs:us-east-1:123456:log-group:/aws/api-gateway/my-service-dev',
        },
        {
          op: 'replace',
          path: '/accessLogSettings/format',
          value:
            'requestId: $context.requestId, ip: $context.identity.sourceIp, caller: $context.identity.caller, user: $context.identity.user, requestTime: $context.requestTime, httpMethod: $context.httpMethod, resourcePath: $context.resourcePath, status: $context.status, protocol: $context.protocol, responseLength: $context.responseLength',
        },
        { op: 'replace', path: '/*/*/logging/dataTrace', value: 'true' },
        { op: 'replace', path: '/*/*/logging/loglevel', value: 'INFO' },
      ];

      expect(providerGetAccountInfoStub).to.be.calledOnce;
      expect(apiGatewaySendStub.getCall(0).args[0]).to.be.instanceOf(GetRestApisCommand);
      expect(apiGatewaySendStub.getCall(1).args[0]).to.be.instanceOf(GetDeploymentsCommand);
      expect(apiGatewaySendStub.getCall(2).args[0]).to.be.instanceOf(GetStageCommand);
      expect(apiGatewaySendStub.getCall(3).args[0]).to.be.instanceOf(UpdateStageCommand);
      expect(apiGatewaySendStub.getCall(4).args[0]).to.be.instanceOf(TagResourceCommand);
      expect(apiGatewaySendStub.getCall(5).args[0]).to.be.instanceOf(UntagResourceCommand);
      expect(providerRequestStub.args).to.have.length(6);
      expect(providerRequestStub.args[0][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[0][1]).to.equal('getRestApis');
      expect(providerRequestStub.args[0][2]).to.deep.equal({
        limit: 500,
        position: undefined,
      });
      expect(providerRequestStub.args[2][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[2][1]).to.equal('getStage');
      expect(providerRequestStub.args[2][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
      });
      expect(providerRequestStub.args[3][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[3][1]).to.equal('updateStage');
      expect(providerRequestStub.args[3][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
        patchOperations,
      });
      expect(providerRequestStub.args[4][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[4][1]).to.equal('tagResource');
      expect(providerRequestStub.args[4][2]).to.deep.equal({
        resourceArn: 'arn:aws:apigateway:us-east-1::/restapis/devRestApiId/stages/dev',
        tags: {
          'Containing Space': 'bar',
          'bar': 'high-priority',
          'num': '123',
        },
      });
      expect(providerRequestStub.args[5][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[5][1]).to.equal('untagResource');
      expect(providerRequestStub.args[5][2]).to.deep.equal({
        resourceArn: 'arn:aws:apigateway:us-east-1::/restapis/devRestApiId/stages/dev',
        tagKeys: ['old'],
      });
    });
  });

  it('should support gov regions', async () => {
    options.region = 'us-gov-east-1';
    awsProvider.getAccountInfo.restore();
    providerGetAccountInfoStub = sinon.stub(awsProvider, 'getAccountInfo').resolves({
      accountId: '123456',
      partition: 'aws-us-gov',
    });
    context.state.service.provider.tags = {
      'Containing Space': 'bar',
      'bar': 'high-priority',
    };
    context.state.service.provider.stackTags = {
      bar: 'low-priority',
      num: 123,
    };
    context.state.service.provider.tracing = {
      apiGateway: true,
    };
    context.state.service.provider.apiGateway = {
      metrics: true,
    };
    context.state.service.provider.logs = {
      restApi: true,
    };

    return updateStage.call(context).then(() => {
      const patchOperations = [
        { op: 'replace', path: '/tracingEnabled', value: 'true' },
        { op: 'replace', path: '/*/*/metrics/enabled', value: 'true' },
        {
          op: 'replace',
          path: '/accessLogSettings/destinationArn',
          value:
            'arn:aws-us-gov:logs:us-gov-east-1:123456:log-group:/aws/api-gateway/my-service-dev',
        },
        {
          op: 'replace',
          path: '/accessLogSettings/format',
          value:
            'requestId: $context.requestId, ip: $context.identity.sourceIp, caller: $context.identity.caller, user: $context.identity.user, requestTime: $context.requestTime, httpMethod: $context.httpMethod, resourcePath: $context.resourcePath, status: $context.status, protocol: $context.protocol, responseLength: $context.responseLength',
        },
        { op: 'replace', path: '/*/*/logging/dataTrace', value: 'true' },
        { op: 'replace', path: '/*/*/logging/loglevel', value: 'INFO' },
      ];

      expect(providerGetAccountInfoStub).to.be.calledOnce;
      expect(providerRequestStub.args).to.have.length(6);
      expect(providerRequestStub.args[0][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[0][1]).to.equal('getRestApis');
      expect(providerRequestStub.args[0][2]).to.deep.equal({
        limit: 500,
        position: undefined,
      });
      expect(providerRequestStub.args[2][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[2][1]).to.equal('getStage');
      expect(providerRequestStub.args[2][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
      });
      expect(providerRequestStub.args[3][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[3][1]).to.equal('updateStage');
      expect(providerRequestStub.args[3][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
        patchOperations,
      });
      expect(providerRequestStub.args[4][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[4][1]).to.equal('tagResource');
      expect(providerRequestStub.args[4][2]).to.deep.equal({
        resourceArn: 'arn:aws-us-gov:apigateway:us-gov-east-1::/restapis/devRestApiId/stages/dev',
        tags: {
          'Containing Space': 'bar',
          'bar': 'high-priority',
          'num': '123',
        },
      });
      expect(providerRequestStub.args[5][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[5][1]).to.equal('untagResource');
      expect(providerRequestStub.args[5][2]).to.deep.equal({
        resourceArn: 'arn:aws-us-gov:apigateway:us-gov-east-1::/restapis/devRestApiId/stages/dev',
        tagKeys: ['old'],
      });
    });
  });

  it('should support all partitions', async () => {
    options.region = 'cn-northwest-1';
    awsProvider.getAccountInfo.restore();
    providerGetAccountInfoStub = sinon.stub(awsProvider, 'getAccountInfo').resolves({
      accountId: '123456',
      partition: 'aws-cn',
    });
    context.state.service.provider.tags = {
      'Containing Space': 'bar',
      'bar': 'high-priority',
    };
    context.state.service.provider.stackTags = {
      bar: 'low-priority',
      num: 123,
    };
    context.state.service.provider.tracing = {
      apiGateway: true,
    };
    context.state.service.provider.apiGateway = {
      metrics: true,
    };
    context.state.service.provider.logs = {
      restApi: true,
    };

    return updateStage.call(context).then(() => {
      const patchOperations = [
        { op: 'replace', path: '/tracingEnabled', value: 'true' },
        { op: 'replace', path: '/*/*/metrics/enabled', value: 'true' },
        {
          op: 'replace',
          path: '/accessLogSettings/destinationArn',
          value: 'arn:aws-cn:logs:cn-northwest-1:123456:log-group:/aws/api-gateway/my-service-dev',
        },
        {
          op: 'replace',
          path: '/accessLogSettings/format',
          value:
            'requestId: $context.requestId, ip: $context.identity.sourceIp, caller: $context.identity.caller, user: $context.identity.user, requestTime: $context.requestTime, httpMethod: $context.httpMethod, resourcePath: $context.resourcePath, status: $context.status, protocol: $context.protocol, responseLength: $context.responseLength',
        },
        { op: 'replace', path: '/*/*/logging/dataTrace', value: 'true' },
        { op: 'replace', path: '/*/*/logging/loglevel', value: 'INFO' },
      ];

      expect(providerGetAccountInfoStub).to.be.calledOnce;
      expect(providerRequestStub.args).to.have.length(6);
      expect(providerRequestStub.args[0][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[0][1]).to.equal('getRestApis');
      expect(providerRequestStub.args[0][2]).to.deep.equal({
        limit: 500,
        position: undefined,
      });
      expect(providerRequestStub.args[2][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[2][1]).to.equal('getStage');
      expect(providerRequestStub.args[2][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
      });
      expect(providerRequestStub.args[3][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[3][1]).to.equal('updateStage');
      expect(providerRequestStub.args[3][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
        patchOperations,
      });
      expect(providerRequestStub.args[4][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[4][1]).to.equal('tagResource');
      expect(providerRequestStub.args[4][2]).to.deep.equal({
        resourceArn: 'arn:aws-cn:apigateway:cn-northwest-1::/restapis/devRestApiId/stages/dev',
        tags: {
          'Containing Space': 'bar',
          'bar': 'high-priority',
          'num': '123',
        },
      });
      expect(providerRequestStub.args[5][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[5][1]).to.equal('untagResource');
      expect(providerRequestStub.args[5][2]).to.deep.equal({
        resourceArn: 'arn:aws-cn:apigateway:cn-northwest-1::/restapis/devRestApiId/stages/dev',
        tagKeys: ['old'],
      });
    });
  });

  it('should not perform any actions if settings are not configure', async () => {
    context.state.service.provider.tags = {
      old: 'tag',
    };
    return updateStage.call(context).then(() => {
      expect(providerGetAccountInfoStub).to.be.calledOnce;
      expect(providerRequestStub.args).to.have.length(4);
      expect(providerRequestStub.args[0][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[0][1]).to.equal('getRestApis');
      expect(providerRequestStub.args[0][2]).to.deep.equal({
        limit: 500,
        position: undefined,
      });
      expect(providerRequestStub.args[2][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[2][1]).to.equal('getStage');
      expect(providerRequestStub.args[2][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
      });
      expect(providerRequestStub.args[3][0]).to.equal('CloudWatchLogs');
      expect(providerRequestStub.args[3][1]).to.equal('deleteLogGroup');
      expect(providerRequestStub.args[3][2]).to.deep.equal({
        logGroupName: '/aws/api-gateway/my-service-dev',
      });
    });
  });

  it('should create a new stage and proceed as usual if none can be found', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    providerRequestStub
      .withArgs('APIGateway', 'getStage', {
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .rejects(Object.assign(new Error('not found'), { name: 'NotFoundException' }));

    providerRequestStub
      .withArgs('APIGateway', 'getDeployments', {
        restApiId: 'devRestApiId',
        limit: 500,
      })
      .resolves({
        items: [{ id: 'someDeploymentId' }],
      });

    providerRequestStub
      .withArgs('APIGateway', 'createStage', {
        deploymentId: 'someDeploymentId',
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .resolves();

    return updateStage.call(context).then(() => {
      const patchOperations = [{ op: 'replace', path: '/tracingEnabled', value: 'false' }];

      expect(providerGetAccountInfoStub).to.be.calledOnce;
      expect(providerRequestStub.args).to.have.length(6);
      expect(providerRequestStub.args[0][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[0][1]).to.equal('getRestApis');
      expect(providerRequestStub.args[0][2]).to.deep.equal({
        limit: 500,
        position: undefined,
      });
      expect(providerRequestStub.args[1][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[1][1]).to.equal('getDeployments');
      expect(providerRequestStub.args[1][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        limit: 500,
      });
      expect(providerRequestStub.args[2][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[2][1]).to.equal('getStage');
      expect(providerRequestStub.args[2][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
      });
      expect(providerRequestStub.args[3][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[3][1]).to.equal('createStage');
      expect(providerRequestStub.args[3][2]).to.deep.equal({
        deploymentId: 'someDeploymentId',
        restApiId: 'devRestApiId',
        stageName: 'dev',
      });
      expect(providerRequestStub.args[4][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[4][1]).to.equal('updateStage');
      expect(providerRequestStub.args[4][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
        patchOperations,
      });
      expect(providerRequestStub.args[5][0]).to.equal('CloudWatchLogs');
      expect(providerRequestStub.args[5][1]).to.equal('deleteLogGroup');
      expect(providerRequestStub.args[5][2]).to.deep.equal({
        logGroupName: '/aws/api-gateway/my-service-dev',
      });
    });
  });

  it('should surface credential and authorization errors while resolving the stage', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    providerRequestStub
      .withArgs('APIGateway', 'getStage', {
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .rejects(
        Object.assign(new Error('denied'), {
          providerError: { code: 'AccessDeniedException' },
        })
      );

    await expect(updateStage.call(context)).to.be.rejectedWith('denied');

    expect(providerRequestStub.calledWith('APIGateway', 'createStage')).to.equal(false);
  });

  it('should treat API Gateway 404 status errors as missing stages', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    providerRequestStub
      .withArgs('APIGateway', 'getStage', {
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .rejects(
        Object.assign(new Error('not found'), {
          providerError: { statusCode: 404 },
        })
      );
    providerRequestStub
      .withArgs('APIGateway', 'createStage', {
        deploymentId: 'someDeploymentId',
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .resolves();

    await updateStage.call(context);

    expect(providerRequestStub.calledWith('APIGateway', 'createStage')).to.equal(true);
  });

  it('should ignore external api gateway', async () => {
    context.state.service.provider.apiGateway = { restApiId: 'foobarfoo1' };
    context.state.service.provider.tracing = { apiGateway: false };
    return updateStage.call(context).then(() => {
      expect(context.isExternalRestApi).to.equal(true);
      expect(context.apiGatewayRestApiId).to.equal(null);
    });
  });

  it('should resolve custom APIGateway name', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    providerRequestStub
      .withArgs('APIGateway', 'getRestApis', {
        limit: 500,
        position: undefined,
      })
      .resolves({
        items: [{ name: 'custom-api-gateway-name', id: 'restapicus' }],
      });
    providerRequestStub
      .withArgs('APIGateway', 'getDeployments', {
        restApiId: 'restapicus',
        limit: 500,
      })
      .resolves({
        items: [{ id: 'someDeploymentId' }],
      });
    providerRequestStub
      .withArgs('APIGateway', 'getStage', {
        restApiId: 'restapicus',
        stageName: 'dev',
      })
      .resolves({
        variables: {
          old: 'tag',
        },
      });
    context.serverless.service.provider.compiledCloudFormationTemplate.Resources.ApiGatewayRestApi.Properties.Name =
      'custom-api-gateway-name';
    context.state.service.provider.apiName = 'custom-api-gateway-name';
    return updateStage.call(context).then(() => {
      expect(context.apiGatewayRestApiId).to.equal('restapicus');
    });
  });

  it('should resolve custom APIGateway resource', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    const resources = context.serverless.service.provider.compiledCloudFormationTemplate.Resources;
    resources.CustomApiGatewayRestApi = resources.ApiGatewayRestApi;
    delete resources.ApiGatewayRestApi;
    resources.CustomApiGatewayRestApi.Properties.Name = 'custom-rest-api-name';
    resources.ApiGatewayRestApiDeployment.Properties.RestApiId.Ref = 'CustomApiGatewayRestApi';
    providerRequestStub
      .withArgs('APIGateway', 'getDeployments', {
        restApiId: 'customRestApiId',
        limit: 500,
      })
      .resolves({
        items: [{ id: 'someDeploymentId' }],
      });
    return updateStage.call(context).then(() => {
      expect(context.apiGatewayRestApiId).to.equal('customRestApiId');
    });
  });

  it('should not resolve if the AWS::ApiGateway::Resource is not present', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    const resources = context.serverless.service.provider.compiledCloudFormationTemplate.Resources;
    delete resources.ApiGatewayRestApi;
    options.stage = 'prod';
    return updateStage.call(context).then(() => {
      expect(context.apiGatewayRestApiId).to.equal(null);
    });
  });

  it('should resolve expected restApiId when beyond 500 APIs are deployed', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    providerRequestStub
      .withArgs('APIGateway', 'getRestApis', {
        limit: 500,
        position: undefined,
      })
      .resolves({
        position: 'foobarfoo1',
      });
    providerRequestStub
      .withArgs('APIGateway', 'getRestApis', {
        limit: 500,
        position: 'foobarfoo1',
      })
      .resolves({
        items: [{ name: 'dev-my-service', id: 'devRestApiId' }],
      });

    return updateStage.call(context).then(() => {
      expect(context.apiGatewayRestApiId).to.equal('devRestApiId');
    });
  });

  it('should handle getDeployments responses without items', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    providerRequestStub
      .withArgs('APIGateway', 'getDeployments', {
        restApiId: 'devRestApiId',
        limit: 500,
      })
      .resolves({});

    await updateStage.call(context);

    expect(context.apiGatewayDeploymentId).to.equal(null);
    expect(providerRequestStub.calledWith('APIGateway', 'getStage')).to.equal(false);
    expect(providerRequestStub.calledWith('APIGateway', 'createStage')).to.equal(false);
  });

  it('should keep getDeployments first-page deployment selection', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    providerRequestStub
      .withArgs('APIGateway', 'getStage', {
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .rejects(Object.assign(new Error('not found'), { name: 'NotFoundException' }));
    providerRequestStub
      .withArgs('APIGateway', 'getDeployments', {
        restApiId: 'devRestApiId',
        limit: 500,
      })
      .resolves({
        items: [{ id: 'firstDeploymentId' }],
        position: 'should-not-be-followed',
      });
    providerRequestStub
      .withArgs('APIGateway', 'createStage', {
        deploymentId: 'firstDeploymentId',
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .resolves();

    await updateStage.call(context);

    expect(
      providerRequestStub.args.filter(
        ([service, method]) => service === 'APIGateway' && method === 'getDeployments'
      )
    ).to.have.length(1);
    expect(
      providerRequestStub.calledWithExactly('APIGateway', 'createStage', {
        deploymentId: 'firstDeploymentId',
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
    ).to.equal(true);
  });

  it('should surface credential and authorization errors while resolving the stage', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    providerRequestStub
      .withArgs('APIGateway', 'getStage', {
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));

    await expect(updateStage.call(context)).to.be.rejectedWith('denied');

    expect(providerRequestStub.calledWith('APIGateway', 'createStage')).to.equal(false);
  });

  it('should treat API Gateway 404 status errors as missing stages', async () => {
    context.state.service.provider.tracing = { apiGateway: false };
    providerRequestStub
      .withArgs('APIGateway', 'getStage', {
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .rejects(Object.assign(new Error('not found'), { $metadata: { httpStatusCode: 404 } }));
    providerRequestStub
      .withArgs('APIGateway', 'createStage', {
        deploymentId: 'someDeploymentId',
        restApiId: 'devRestApiId',
        stageName: 'dev',
      })
      .resolves();

    await updateStage.call(context);

    expect(providerRequestStub.calledWith('APIGateway', 'createStage')).to.equal(true);
  });

  it('passes credential provider functions through separate SDK v3 configs', async () => {
    const credentials = async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' });
    const apiGatewayRequestHandler = {};
    const cloudWatchLogsRequestHandler = {};
    const apiGatewayConfig = {
      credentials,
      region: 'us-east-1',
      requestHandler: apiGatewayRequestHandler,
    };
    const cloudWatchLogsConfig = {
      credentials,
      region: 'us-east-1',
      requestHandler: cloudWatchLogsRequestHandler,
    };
    const apiGatewayClients = [];
    const cloudWatchLogsClients = [];
    class FakeCommand {
      constructor(input) {
        this.input = input;
      }
    }
    class FakeGetRestApisCommand extends FakeCommand {}
    class FakeGetDeploymentsCommand extends FakeCommand {}
    class FakeGetStageCommand extends FakeCommand {}
    class FakeCreateStageCommand extends FakeCommand {}
    class FakeUpdateStageCommand extends FakeCommand {}
    class FakeTagResourceCommand extends FakeCommand {}
    class FakeUntagResourceCommand extends FakeCommand {}
    class FakeDeleteLogGroupCommand extends FakeCommand {}
    class FakeAPIGatewayClient {
      constructor(config) {
        this.config = config;
        apiGatewayClients.push(this);
      }

      async send(command) {
        if (command instanceof FakeGetRestApisCommand) {
          return { items: [{ name: 'dev-my-service', id: 'devRestApiId' }] };
        }
        if (command instanceof FakeGetDeploymentsCommand) {
          return { items: [{ id: 'someDeploymentId' }] };
        }
        if (command instanceof FakeGetStageCommand) return { tags: {} };
        if (command instanceof FakeUpdateStageCommand) return {};
        if (command instanceof FakeCreateStageCommand) return {};
        if (command instanceof FakeTagResourceCommand) return {};
        if (command instanceof FakeUntagResourceCommand) return {};
        throw new Error(`Unexpected APIGateway command: ${command.constructor.name}`);
      }
    }
    class FakeCloudWatchLogsClient {
      constructor(config) {
        this.config = config;
        cloudWatchLogsClients.push(this);
      }

      async send(command) {
        if (command instanceof FakeDeleteLogGroupCommand) return {};
        throw new Error(`Unexpected CloudWatchLogs command: ${command.constructor.name}`);
      }
    }
    const { updateStage: updateStageWithClientStubs } = proxyquire(
      '../../../../../../../../../../../lib/plugins/aws/package/compile/events/api-gateway/lib/hack/update-stage',
      {
        '@aws-sdk/client-api-gateway': {
          APIGatewayClient: FakeAPIGatewayClient,
          CreateStageCommand: FakeCreateStageCommand,
          GetDeploymentsCommand: FakeGetDeploymentsCommand,
          GetRestApisCommand: FakeGetRestApisCommand,
          GetStageCommand: FakeGetStageCommand,
          TagResourceCommand: FakeTagResourceCommand,
          UntagResourceCommand: FakeUntagResourceCommand,
          UpdateStageCommand: FakeUpdateStageCommand,
        },
        '@aws-sdk/client-cloudwatch-logs': {
          CloudWatchLogsClient: FakeCloudWatchLogsClient,
          DeleteLogGroupCommand: FakeDeleteLogGroupCommand,
        },
      }
    );
    const getAwsSdkV3ConfigStub = sinon.stub(awsProvider, 'getAwsSdkV3Config');
    getAwsSdkV3ConfigStub.onFirstCall().resolves(apiGatewayConfig);
    getAwsSdkV3ConfigStub.onSecondCall().resolves(cloudWatchLogsConfig);
    context.state.service.provider.logs = {
      restApi: {
        accessLogging: false,
      },
    };

    try {
      await updateStageWithClientStubs.call(context);

      expect(getAwsSdkV3ConfigStub).to.have.been.calledTwice;
      expect(apiGatewayClients).to.have.length(1);
      expect(cloudWatchLogsClients).to.have.length(1);
      expect(apiGatewayClients[0].config).to.equal(apiGatewayConfig);
      expect(cloudWatchLogsClients[0].config).to.equal(cloudWatchLogsConfig);
      expect(apiGatewayClients[0].config).to.not.equal(cloudWatchLogsClients[0].config);
      expect(apiGatewayClients[0].config.credentials).to.equal(credentials);
      expect(cloudWatchLogsClients[0].config.credentials).to.equal(credentials);
      expect(apiGatewayClients[0].config.requestHandler).to.equal(apiGatewayRequestHandler);
      expect(cloudWatchLogsClients[0].config.requestHandler).to.equal(cloudWatchLogsRequestHandler);
    } finally {
      getAwsSdkV3ConfigStub.restore();
    }
  });

  it(
    'should not apply hack when restApiId could not be resolved and ' +
      'no custom settings are applied',
    () => {
      context.state.service.provider.apiGateway = {
        restApiId: { 'Fn::ImportValue': 'RestApiId-${self:custom.stage}' },
      };
      return updateStage.call(context).then(() => {
        expect(providerRequestStub.callCount).to.equal(0);
      });
    }
  );

  it(
    'should not apply hack when restApiId could not be resolved and ' +
      'no http events are detected',
    () => {
      context.state.service.provider.tracing = { apiGateway: true };
      context.options.stage = 'foo';
      delete context.serverless.service.provider.compiledCloudFormationTemplate.Resources
        .ApiGatewayRestApi;
      return updateStage.call(context);
    }
  );

  it('should update the stage with a custom APIGW log format if given', async () => {
    context.state.service.provider.logs = {
      restApi: {
        format: 'requestId: $context.requestId',
      },
    };

    return updateStage.call(context).then(() => {
      const patchOperations = [
        {
          op: 'replace',
          path: '/accessLogSettings/destinationArn',
          value: 'arn:aws:logs:us-east-1:123456:log-group:/aws/api-gateway/my-service-dev',
        },
        {
          op: 'replace',
          path: '/accessLogSettings/format',
          value: 'requestId: $context.requestId',
        },
        { op: 'replace', path: '/*/*/logging/dataTrace', value: 'true' },
        { op: 'replace', path: '/*/*/logging/loglevel', value: 'INFO' },
      ];

      expect(providerGetAccountInfoStub).to.be.calledOnce;
      expect(providerRequestStub.args).to.have.length(4);
      expect(providerRequestStub.args[0][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[0][1]).to.equal('getRestApis');
      expect(providerRequestStub.args[0][2]).to.deep.equal({
        limit: 500,
        position: undefined,
      });
      expect(providerRequestStub.args[2][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[2][1]).to.equal('getStage');
      expect(providerRequestStub.args[2][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
      });
      expect(providerRequestStub.args[3][0]).to.equal('APIGateway');
      expect(providerRequestStub.args[3][1]).to.equal('updateStage');
      expect(providerRequestStub.args[3][2]).to.deep.equal({
        restApiId: 'devRestApiId',
        stageName: 'dev',
        patchOperations,
      });
    });
  });

  function expectPatchOperation(patchOperation) {
    const patchOperations = providerRequestStub.args[3][2].patchOperations;
    expect(patchOperations).to.include.deep.members([patchOperation]);
  }

  async function checkLogLevel(setLevel, expectedLevel) {
    if (setLevel) {
      context.state.service.provider.logs = {
        restApi: {
          level: setLevel,
        },
      };
    } else {
      context.state.service.provider.logs = {
        restApi: true,
      };
    }

    return updateStage.call(context).then(() => {
      const patchOperation = { op: 'replace', path: '/*/*/logging/loglevel', value: expectedLevel };
      expectPatchOperation(patchOperation);
    });
  }

  it('should use the default log level if no log level is given', () => {
    return checkLogLevel(null, defaultApiGatewayLogLevel);
  });

  ['INFO', 'ERROR'].forEach((logLevel) => {
    it(`should update the stage with a custom APIGW log level if given ${logLevel}`, () => {
      return checkLogLevel(logLevel, logLevel);
    });
  });

  it('should disable execution logging when executionLogging is set to false', async () => {
    context.state.service.provider.logs = {
      restApi: {
        executionLogging: false,
      },
    };
    return updateStage.call(context).then(() => {
      const patchOperation = { op: 'replace', path: '/*/*/logging/loglevel', value: 'OFF' };
      expectPatchOperation(patchOperation);
    });
  });

  it('should disable existing access log settings when accessLogging is set to false', async () => {
    context.state.service.provider.logs = {
      restApi: {
        accessLogging: false,
      },
    };

    return updateStage.call(context).then(() => {
      const removeOperation = { op: 'remove', path: '/accessLogSettings' };
      expectPatchOperation(removeOperation);
    });
  });

  it('should delete any existing CloudWatch LogGroup when accessLogging is set to false', async () => {
    context.state.service.provider.logs = {
      restApi: {
        accessLogging: false,
      },
    };

    return updateStage.call(context).then(() => {
      expect(providerRequestStub.args[4][0]).to.equal('CloudWatchLogs');
      expect(providerRequestStub.args[4][1]).to.equal('deleteLogGroup');
      expect(providerRequestStub.args[4][2]).to.deep.equal({
        logGroupName: '/aws/api-gateway/my-service-dev',
      });
    });
  });

  it('should swallow expected missing CloudWatch LogGroup deletion errors', async () => {
    context.state.service.provider.logs = {
      restApi: {
        accessLogging: false,
      },
    };
    providerRequestStub
      .withArgs('CloudWatchLogs', 'deleteLogGroup', {
        logGroupName: '/aws/api-gateway/my-service-dev',
      })
      .rejects(Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }));

    await updateStage.call(context);

    expect(providerRequestStub.calledWith('CloudWatchLogs', 'deleteLogGroup')).to.equal(true);
  });

  it('should swallow 404 status CloudWatch LogGroup deletion errors', async () => {
    context.state.service.provider.logs = {
      restApi: {
        accessLogging: false,
      },
    };
    providerRequestStub
      .withArgs('CloudWatchLogs', 'deleteLogGroup', {
        logGroupName: '/aws/api-gateway/my-service-dev',
      })
      .rejects(Object.assign(new Error('not found'), { $metadata: { httpStatusCode: 404 } }));

    await updateStage.call(context);

    expect(providerRequestStub.calledWith('CloudWatchLogs', 'deleteLogGroup')).to.equal(true);
  });

  it('should swallow credential and authorization errors while deleting access log group', async () => {
    context.state.service.provider.logs = {
      restApi: {
        accessLogging: false,
      },
    };
    providerRequestStub
      .withArgs('CloudWatchLogs', 'deleteLogGroup', {
        logGroupName: '/aws/api-gateway/my-service-dev',
      })
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));

    await updateStage.call(context);

    expect(providerRequestStub.calledWith('CloudWatchLogs', 'deleteLogGroup')).to.equal(true);
  });

  async function checkDataTrace(value) {
    context.state.service.provider.logs = {
      restApi: {
        fullExecutionData: value,
      },
    };

    return updateStage.call(context).then(() => {
      const patchOperation = {
        op: 'replace',
        path: '/*/*/logging/dataTrace',
        value: value.toString(),
      };
      expectPatchOperation(patchOperation);
    });
  }

  it('should disable tracing if fullExecutionData is set to false', () => {
    return checkDataTrace(false);
  });

  it('should enable tracing if fullExecutionData is set to true', () => {
    return checkDataTrace(true);
  });
});

describe('test/unit/lib/plugins/aws/package/compile/events/apiGateway/lib/hack/updateStage.test.js', () => {
  it('should correctly add and remove stage tags during update', async () => {
    const tagResourceStub = sinon.stub();
    const untagResourceStub = sinon.stub();
    const { awsSdkV3Stub } = await runServerless({
      fixture: 'api-gateway',
      command: 'deploy',
      configExt: {
        provider: {
          apiName: 'test-api-name',
          stackTags: {
            key: 'value',
          },
        },
      },
      lastLifecycleHookName: 'after:deploy:deploy',
      awsSdkV3StubMap: {
        CloudFormation: {
          describeStacks: { Stacks: [{}] },
          describeStackEvents: {
            StackEvents: [
              {
                EventId: 'stack-event-id',
                LogicalResourceId: 'new-service-dev',
                ResourceStatus: 'UPDATE_COMPLETE',
                ResourceType: 'AWS::CloudFormation::Stack',
                StackId:
                  'arn:aws:cloudformation:us-east-1:999999999999:stack/new-service-dev/stack-id',
                StackName: 'new-service-dev',
              },
            ],
          },
          describeStackResource: {
            StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
          },
          listStackResources: {},
          validateTemplate: {},
          deleteChangeSet: {},
          createChangeSet: {},
          executeChangeSet: {},
          describeChangeSet: {
            ChangeSetName: 'new-service-dev-change-set',
            ChangeSetId: 'some-change-set-id',
            StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/new-service-dev/stack-id',
            StackName: 'new-service-dev',
            Status: 'CREATE_COMPLETE',
          },
        },
        STS: {
          getCallerIdentity: {
            ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
            UserId: 'XXXXXXXXXXXXXXXXXXXXX',
            Account: '999999999999',
            Arn: 'arn:aws-us-gov:iam::999999999999:user/test',
          },
        },
        Lambda: {
          getFunction: { Configuration: { LastModified: '2020-05-20T15:34:16.494+0000' } },
        },
        S3: {
          listObjectsV2: { Contents: [] },
          upload: {},
          headObject: {},
          headBucket: {},
        },
        APIGateway: {
          getRestApis: () => ({
            items: [{ name: 'test-api-name', id: 'api-id' }],
          }),
          getDeployments: () => ({
            items: [{ id: 'deployment-id' }],
          }),
          getStage: () => ({
            id: 'stage-id',
            tags: { 'keytoremove': 'valuetoremove', 'aws:xxx': 'tokeep' },
          }),
          tagResource: tagResourceStub,
          untagResource: untagResourceStub,
        },
        CloudWatchLogs: {
          deleteLogGroup: {},
        },
      },
    });
    expect(
      awsSdkV3Stub.sends
        .filter(({ service }) => service === 'APIGateway')
        .map(({ method }) => method)
    ).to.include.members(['getRestApis', 'getDeployments', 'getStage', 'tagResource']);
    expect(tagResourceStub).to.have.been.calledOnce;
    expect(tagResourceStub.args[0][0].tags).to.deep.equal({ key: 'value' });
    expect(untagResourceStub).to.have.been.calledOnce;
    expect(untagResourceStub.args[0][0].tagKeys).to.deep.equal(['keytoremove']);
  });

  it('should correctly resolve `apiId` during deployment', async () => {
    const getDeploymentsStub = sinon.stub().returns({ items: [{ id: 'deployment-id' }] });
    const stage = 'dev';

    await runServerless({
      fixture: 'api-gateway',
      command: 'deploy',
      options: { stage },
      configExt: {
        service: 'new-service',
        provider: {
          apiGateway: {
            shouldStartNameWithService: true,
          },
          stackTags: { key: 'value' },
        },
      },
      lastLifecycleHookName: 'after:deploy:deploy',
      awsSdkV3StubMap: {
        APIGateway: {
          createStage: {},
          getDeployments: getDeploymentsStub,
          getStage: {},
          getRestApis: { items: [{ id: 'api-id', name: `new-service-${stage}` }] },
          tagResource: {},
        },
        CloudFormation: {
          describeStacks: { Stacks: [{}] },
          describeStackEvents: {
            StackEvents: [
              {
                EventId: 'stack-event-id',
                LogicalResourceId: 'new-service-dev',
                ResourceStatus: 'UPDATE_COMPLETE',
                ResourceType: 'AWS::CloudFormation::Stack',
                StackId:
                  'arn:aws:cloudformation:us-east-1:999999999999:stack/new-service-dev/stack-id',
                StackName: 'new-service-dev',
              },
            ],
          },
          describeStackResource: {
            StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
          },
          listStackResources: {},
          validateTemplate: {},
          deleteChangeSet: {},
          createChangeSet: {},
          executeChangeSet: {},
          describeChangeSet: {
            ChangeSetName: 'new-service-dev-change-set',
            ChangeSetId: 'some-change-set-id',
            StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/new-service-dev/stack-id',
            StackName: 'new-service-dev',
            Status: 'CREATE_COMPLETE',
          },
        },
        S3: {
          listObjectsV2: { Contents: [] },
          upload: {},
          headBucket: {},
        },
        STS: {
          getCallerIdentity: {
            ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
            UserId: 'XXXXXXXXXXXXXXXXXXXXX',
            Account: '999999999999',
            Arn: 'arn:aws-us-gov:iam::999999999999:user/test',
          },
        },
        CloudWatchLogs: {
          deleteLogGroup: {},
        },
      },
    });

    expect(getDeploymentsStub).to.have.been.calledOnce;
    expect(getDeploymentsStub.args[0][0].restApiId).to.equal('api-id');
  });

  it('should use stage defined under apiGateway config if passed', async () => {
    const getDeploymentsStub = sinon.stub().returns({ items: [{ id: 'deployment-id' }] });
    const getStageStub = sinon.stub().resolves({});
    const createStageStub = sinon.stub();
    const updateStageStub = sinon.stub();
    const tagResourceStub = sinon.stub();
    const stage = 'dev';

    await runServerless({
      fixture: 'api-gateway',
      command: 'deploy',
      configExt: {
        service: 'new-service',
        provider: {
          stage,
          apiGateway: {
            shouldStartNameWithService: true,
            stage: 'customStage',
          },
          stackTags: { key: 'value' },
          logs: { restApi: true },
        },
      },
      lastLifecycleHookName: 'after:deploy:deploy',
      awsSdkV3StubMap: {
        APIGateway: {
          createStage: createStageStub,
          getStage: getStageStub,
          updateStage: updateStageStub,
          getDeployments: getDeploymentsStub,
          getRestApis: { items: [{ id: 'api-id', name: `new-service-${stage}` }] },
          tagResource: tagResourceStub,
        },
        CloudFormation: {
          describeStacks: { Stacks: [{}] },
          describeStackEvents: {
            StackEvents: [
              {
                EventId: 'stack-event-id',
                LogicalResourceId: 'new-service-dev',
                ResourceStatus: 'UPDATE_COMPLETE',
                ResourceType: 'AWS::CloudFormation::Stack',
                StackId:
                  'arn:aws:cloudformation:us-east-1:999999999999:stack/new-service-dev/stack-id',
                StackName: 'new-service-dev',
              },
            ],
          },
          describeStackResource: {
            StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
          },
          listStackResources: {},
          validateTemplate: {},
          deleteChangeSet: {},
          createChangeSet: {},
          executeChangeSet: {},
          describeChangeSet: {
            ChangeSetName: 'new-service-dev-change-set',
            ChangeSetId: 'some-change-set-id',
            StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/new-service-dev/stack-id',
            StackName: 'new-service-dev',
            Status: 'CREATE_COMPLETE',
          },
        },
        S3: {
          listObjectsV2: { Contents: [] },
          upload: {},
          headBucket: {},
        },
        STS: {
          getCallerIdentity: {
            ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
            UserId: 'XXXXXXXXXXXXXXXXXXXXX',
            Account: '999999999999',
            Arn: 'arn:aws-us-gov:iam::999999999999:user/test',
          },
        },
      },
    });

    expect(getStageStub.args[0][0].stageName).to.be.equal('customStage');
    expect(createStageStub.args[0][0].stageName).to.be.equal('customStage');
    expect(updateStageStub.args[0][0].stageName).to.be.equal('customStage');
    expect(tagResourceStub.args[0][0].resourceArn)
      .to.be.a('string')
      .and.satisfy((arn) => arn.endsWith('/stages/customStage'));
    const accessLogSettingsDestinationArn = updateStageStub.args[0][0].patchOperations.filter(
      (op) => op.path === '/accessLogSettings/destinationArn'
    )[0].value;
    expect(accessLogSettingsDestinationArn)
      .to.be.a('string')
      .and.satisfy((arn) => arn.endsWith('customStage'));
  });

  it('should update stage, and remove log group using stage defined under apiGateway config if configured such', async () => {
    const getDeploymentsStub = sinon.stub().returns({ items: [{ id: 'deployment-id' }] });
    const updateStageStub = sinon.stub();
    const deleteLogGroupStub = sinon.stub();
    const stage = 'dev';

    await runServerless({
      fixture: 'api-gateway',
      command: 'deploy',
      configExt: {
        service: 'new-service',
        provider: {
          stage,
          apiGateway: {
            shouldStartNameWithService: true,
            stage: 'customStage',
          },
          stackTags: { key: 'value' },
          tracing: { apiGateway: true },
        },
      },
      lastLifecycleHookName: 'after:deploy:deploy',
      awsSdkV3StubMap: {
        APIGateway: {
          updateStage: updateStageStub,
          getStage: { id: 'stage-id' },
          getDeployments: getDeploymentsStub,
          getRestApis: { items: [{ id: 'api-id', name: `new-service-${stage}` }] },
          tagResource: {},
        },
        CloudFormation: {
          describeStacks: { Stacks: [{}] },
          describeStackEvents: {
            StackEvents: [
              {
                EventId: 'stack-event-id',
                LogicalResourceId: 'new-service-dev',
                ResourceStatus: 'UPDATE_COMPLETE',
                ResourceType: 'AWS::CloudFormation::Stack',
                StackId:
                  'arn:aws:cloudformation:us-east-1:999999999999:stack/new-service-dev/stack-id',
                StackName: 'new-service-dev',
              },
            ],
          },
          describeStackResource: {
            StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
          },
          listStackResources: {},
          validateTemplate: {},
          deleteChangeSet: {},
          createChangeSet: {},
          executeChangeSet: {},
          describeChangeSet: {
            ChangeSetName: 'new-service-dev-change-set',
            ChangeSetId: 'some-change-set-id',
            StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/new-service-dev/stack-id',
            StackName: 'new-service-dev',
            Status: 'CREATE_COMPLETE',
          },
        },
        S3: {
          listObjectsV2: { Contents: [] },
          upload: {},
          headBucket: {},
        },
        STS: {
          getCallerIdentity: {
            ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
            UserId: 'XXXXXXXXXXXXXXXXXXXXX',
            Account: '999999999999',
            Arn: 'arn:aws-us-gov:iam::999999999999:user/test',
          },
        },
        CloudWatchLogs: {
          deleteLogGroup: deleteLogGroupStub,
        },
      },
    });

    expect(updateStageStub.args[0][0].stageName).to.be.equal('customStage');
    expect(deleteLogGroupStub.args[0][0].logGroupName)
      .to.be.a('string')
      .and.satisfy((logGroupName) => logGroupName.endsWith('customStage'));
  });
});
