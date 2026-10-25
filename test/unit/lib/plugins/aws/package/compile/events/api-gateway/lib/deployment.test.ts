'use strict';

const expect = require('chai').expect;
const { createApiGatewayCompilerContext } = require('../test-utils');

describe('#compileDeployment()', () => {
  let awsCompileApigEvents;

  beforeEach(() => {
    ({ awsCompileApigEvents } = createApiGatewayCompilerContext());
    awsCompileApigEvents.apiGatewayRestApiLogicalId = 'ApiGatewayRestApi';
    awsCompileApigEvents.apiGatewayMethodLogicalIds = ['method-dependency1', 'method-dependency2'];
  });

  it('should create a deployment resource', () => {
    awsCompileApigEvents.compileDeployment();
    const apiGatewayDeploymentLogicalId = Object.keys(
      awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Resources
    )[0];

    expect(
      awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Resources[
        apiGatewayDeploymentLogicalId
      ]
    ).to.deep.equal({
      Type: 'AWS::ApiGateway::Deployment',
      DependsOn: ['method-dependency1', 'method-dependency2'],
      Properties: {
        RestApiId: {
          Ref: awsCompileApigEvents.apiGatewayRestApiLogicalId,
        },
        Description: undefined,
        StageName: 'dev',
      },
    });
  });

  it('should create a deployment resource with description', () => {
    awsCompileApigEvents.serverless.service.provider.apiGateway = {
      description: 'Some Description',
    };

    awsCompileApigEvents.compileDeployment();
    const apiGatewayDeploymentLogicalId = Object.keys(
      awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Resources
    )[0];

    expect(
      awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Resources[
        apiGatewayDeploymentLogicalId
      ]
    ).to.deep.equal({
      Type: 'AWS::ApiGateway::Deployment',
      DependsOn: ['method-dependency1', 'method-dependency2'],
      Properties: {
        RestApiId: {
          Ref: awsCompileApigEvents.apiGatewayRestApiLogicalId,
        },
        Description: 'Some Description',
        StageName: 'dev',
      },
    });
  });

  it('should add service endpoint output', () => {
    awsCompileApigEvents.compileDeployment();
    expect(
      awsCompileApigEvents.serverless.service.provider.compiledCloudFormationTemplate.Outputs
        .ServiceEndpoint
    ).to.deep.equal({
      Description: 'URL of the service endpoint',
      Value: {
        'Fn::Join': [
          '',
          [
            'https://',
            { Ref: awsCompileApigEvents.apiGatewayRestApiLogicalId },
            '.execute-api.',
            { Ref: 'AWS::Region' },
            '.',
            { Ref: 'AWS::URLSuffix' },
            '/dev',
          ],
        ],
      },
    });
  });
});
