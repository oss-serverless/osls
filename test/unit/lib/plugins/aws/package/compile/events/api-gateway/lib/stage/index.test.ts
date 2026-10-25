'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const childProcess = require('child_process');
const { promisify } = require('util');
const isObject = require('type/object/is');
const AwsCompileApigEvents = require('../../../../../../../../../../../lib/plugins/aws/package/compile/events/api-gateway');
const Serverless = require('../../../../../../../../../../../lib/serverless');
const AwsProvider = require('../../../../../../../../../../../lib/plugins/aws/provider');
const { createTmpDir } = require('../../../../../../../../../../utils/fs');
const runServerless = require('../../../../../../../../../../utils/run-serverless');

if (!childProcess.execAsync) childProcess.execAsync = promisify(childProcess.exec);

describe('#compileStage()', () => {
  let serverless;
  let provider;
  let awsCompileApigEvents;
  let stage;
  let stageLogicalId;
  let logGroupLogicalId;

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    serverless = new Serverless({ commands: [], options: {} });
    provider = new AwsProvider(serverless, options);
    serverless.setProvider('aws', provider);
    serverless.service.service = 'my-service';
    serverless.service.provider.compiledCloudFormationTemplate = {
      Resources: {},
      Outputs: {},
    };
    serverless.serviceDir = createTmpDir();
    serverless.cli = { log: () => {} };
    awsCompileApigEvents = new AwsCompileApigEvents(serverless, options);
    awsCompileApigEvents.apiGatewayRestApiLogicalId = 'ApiGatewayRestApi';
    awsCompileApigEvents.apiGatewayDeploymentLogicalId = 'ApiGatewayDeploymentTest';
    awsCompileApigEvents.provider = provider;
    stage = awsCompileApigEvents.provider.getStage();
    stageLogicalId = awsCompileApigEvents.provider.naming.getStageLogicalId();
    logGroupLogicalId = awsCompileApigEvents.provider.naming.getApiGatewayLogGroupLogicalId();
    // mocking the result of a Deployment resource since we remove the stage name
    // when using the Stage resource
    awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Resources[
      awsCompileApigEvents.apiGatewayDeploymentLogicalId
    ] = {
      Properties: {
        StageName: stage,
      },
    };
  });

  describe('tracing', () => {
    beforeEach(() => {
      // setting up AWS X-Ray tracing
      awsCompileApigEvents.serverless.service.provider.tracing = {
        apiGateway: true,
      };
    });

    it('should NOT create a dedicated stage resource if tracing is not enabled', async () => {
      awsCompileApigEvents.serverless.service.provider.tracing = {};

      return awsCompileApigEvents.compileStage().then(() => {
        const resources =
          awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Resources;

        expect(resources[stageLogicalId]).not.to.exist;

        expect(resources[awsCompileApigEvents.apiGatewayDeploymentLogicalId]).to.deep.equal({
          Properties: {
            StageName: stage,
          },
        });
      });
    });
  });

  describe('logs', () => {
    beforeEach(() => {
      sinon.stub(childProcess, 'execAsync');
      // setting up API Gateway logs
      awsCompileApigEvents.serverless.service.provider.logs = {
        restApi: true,
      };
    });

    it('should create a Log Group resource', async () => {
      return awsCompileApigEvents.compileStage().then(() => {
        const resources =
          awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Resources;

        expect(resources[logGroupLogicalId]).to.deep.equal({
          Type: 'AWS::Logs::LogGroup',
          Properties: {
            LogGroupName: '/aws/api-gateway/my-service-dev',
          },
        });
      });
    });

    it('should set log retention if provider.logRetentionInDays is set', async () => {
      serverless.service.provider.logRetentionInDays = 30;

      return awsCompileApigEvents.compileStage().then(() => {
        const resources =
          awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Resources;

        expect(resources[logGroupLogicalId]).to.deep.equal({
          Type: 'AWS::Logs::LogGroup',
          Properties: {
            LogGroupName: '/aws/api-gateway/my-service-dev',
            RetentionInDays: serverless.service.provider.logRetentionInDays,
          },
        });
      });
    });

    it('should ensure CloudWatch role custom resource', async () => {
      return awsCompileApigEvents.compileStage().then(() => {
        const resources =
          awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Resources;

        expect(
          isObject(
            resources[
              awsCompileApigEvents.provider.naming.getCustomResourceApiGatewayAccountCloudWatchRoleResourceLogicalId()
            ]
          )
        ).to.equal(true);
      });
    });

    it('should skip CloudWatch role custom resource when restApi.roleManagedExternally is set', async () => {
      awsCompileApigEvents.serverless.service.provider.logs.restApi = {
        roleManagedExternally: true,
      };

      return awsCompileApigEvents.compileStage().then(() => {
        const resources =
          awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Resources;

        expect(
          isObject(
            resources[
              awsCompileApigEvents.provider.naming.getCustomResourceApiGatewayAccountCloudWatchRoleResourceLogicalId()
            ]
          )
        ).to.equal(false);
      });
    });
  });
});

describe('test/unit/lib/plugins/aws/package/compile/events/apiGateway/lib/stage/index.test.js', () => {
  const getApiGatewayDeploymentResource = (cfTemplate) => {
    const deploymentLogicalId = Object.keys(cfTemplate.Resources).find((key) =>
      key.startsWith('ApiGatewayDeployment')
    );
    expect(deploymentLogicalId).to.be.a('string');

    const deployment = cfTemplate.Resources[deploymentLogicalId];
    expect(deployment.Type).to.equal('AWS::ApiGateway::Deployment');

    return deployment;
  };

  const expectDeploymentStageName = (cfTemplate, stageName) => {
    expect(getApiGatewayDeploymentResource(cfTemplate).Properties).to.deep.include({
      RestApiId: { Ref: 'ApiGatewayRestApi' },
      StageName: stageName,
    });
  };

  // Tracing, stage tags, and stage log settings are applied by the deploy-time
  // update-stage hook; package only emits Deployment and log helper resources.
  it('should not package tracing as a dedicated Stage resource', async () => {
    const { cfTemplate, awsNaming } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      configExt: {
        provider: {
          tracing: {
            apiGateway: true,
          },
        },
      },
    });

    expect(cfTemplate.Resources[awsNaming.getStageLogicalId()]).to.be.undefined;
    expectDeploymentStageName(cfTemplate, 'dev');
  });

  it('should not package provider.stackTags as API Gateway resource tags', async () => {
    const { cfTemplate, awsNaming } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      configExt: {
        provider: {
          stackTags: {
            foo: '1',
          },
        },
      },
    });

    expect(cfTemplate.Resources[awsNaming.getStageLogicalId()]).to.be.undefined;
    expectDeploymentStageName(cfTemplate, 'dev');
    expect(cfTemplate.Resources.ApiGatewayRestApi.Properties.Tags).to.be.undefined;
  });

  it('should package provider.tags as API Gateway RestApi tags', async () => {
    const { cfTemplate, awsNaming } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      configExt: {
        provider: {
          tags: {
            foo: '1',
          },
        },
      },
    });

    expect(cfTemplate.Resources[awsNaming.getStageLogicalId()]).to.be.undefined;
    expectDeploymentStageName(cfTemplate, 'dev');
    expect(cfTemplate.Resources.ApiGatewayRestApi.Properties.Tags).to.deep.equal([
      { Key: 'foo', Value: '1' },
    ]);
  });

  it('should only package provider.tags as API Gateway RestApi tags when stackTags are also configured', async () => {
    const { cfTemplate, awsNaming } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      configExt: {
        provider: {
          stackTags: {
            foo: 'from-stackTags',
            bar: 'from-stackTags',
          },
          tags: {
            foo: 'from-tags',
            buz: 'from-tags',
          },
        },
      },
    });

    expect(cfTemplate.Resources[awsNaming.getStageLogicalId()]).to.be.undefined;
    expectDeploymentStageName(cfTemplate, 'dev');
    expect(cfTemplate.Resources.ApiGatewayRestApi.Properties.Tags).to.deep.equal([
      { Key: 'foo', Value: 'from-tags' },
      { Key: 'buz', Value: 'from-tags' },
    ]);
  });

  it('should not create LogGroup if `accessLogging` set to false', async () => {
    const { cfTemplate, awsNaming } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      configExt: {
        provider: {
          logs: {
            restApi: {
              accessLogging: false,
            },
          },
        },
      },
    });

    expect(cfTemplate.Resources[awsNaming.getApiGatewayLogGroupLogicalId()]).to.be.undefined;
  });

  it('should package LogGroup and CloudWatch role with `logs.restApi` set to `true`', async () => {
    const { cfTemplate, awsNaming, serverless } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      configExt: {
        provider: {
          logs: {
            restApi: true,
          },
        },
      },
    });

    expect(cfTemplate.Resources[awsNaming.getStageLogicalId()]).to.be.undefined;
    expectDeploymentStageName(cfTemplate, 'dev');
    expect(cfTemplate.Resources[awsNaming.getApiGatewayLogGroupLogicalId()]).to.deep.equal({
      Type: 'AWS::Logs::LogGroup',
      Properties: {
        LogGroupName: `/aws/api-gateway/${serverless.service.service}-dev`,
      },
    });
    expect(
      cfTemplate.Resources[
        awsNaming.getCustomResourceApiGatewayAccountCloudWatchRoleResourceLogicalId()
      ].Properties.ServiceToken
    ).to.deep.equal({
      'Fn::GetAtt': [
        awsNaming.getCustomResourceApiGatewayAccountCloudWatchRoleHandlerFunctionLogicalId(),
        'Arn',
      ],
    });
  });

  it('should create LogGroup with default setting for `accessLogging`', async () => {
    const { cfTemplate, awsNaming, serverless } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      configExt: {
        provider: {
          logs: {
            restApi: {
              executionLogging: false,
            },
          },
        },
      },
    });

    expect(cfTemplate.Resources[awsNaming.getApiGatewayLogGroupLogicalId()]).to.deep.equal({
      Type: 'AWS::Logs::LogGroup',
      Properties: {
        LogGroupName: `/aws/api-gateway/${serverless.service.service}-dev`,
      },
    });
  });

  it('should set DataProtectionPolicy if provider.logDataProtectionPolicy is set', async () => {
    const policy = {
      Name: 'data-protection-policy',
      Version: '2021-06-01',
      Statement: [],
    };
    const { cfTemplate, awsNaming, serverless } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      configExt: {
        provider: {
          logs: {
            restApi: true,
          },
          logDataProtectionPolicy: policy,
        },
      },
    });

    expect(cfTemplate.Resources[awsNaming.getApiGatewayLogGroupLogicalId()]).to.deep.equal({
      Type: 'AWS::Logs::LogGroup',
      Properties: {
        LogGroupName: `/aws/api-gateway/${serverless.service.service}-dev`,
        DataProtectionPolicy: policy,
      },
    });
  });

  it('should use stage name from provider if provider.apiGateway.stage is configured', async () => {
    // https://github.com/serverless/serverless/issues/11675
    const { cfTemplate, awsNaming } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      configExt: {
        provider: {
          apiGateway: {
            stage: 'foo',
          },
        },
      },
    });
    expect(awsNaming.provider.getApiGatewayStage()).to.equal('foo');
    const [apiGatewayDeploymentKey] = Object.keys(cfTemplate.Resources).filter((k) =>
      k.startsWith('ApiGatewayDeployment')
    );
    const apiGatewayDeployment = cfTemplate.Resources[apiGatewayDeploymentKey];
    expect(apiGatewayDeployment.Properties.StageName).to.equal('foo');
  });
});
