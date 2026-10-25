'use strict';

const expect = require('chai').expect;
const { createWebsocketsCompilerContext } = require('../test-utils');

describe('#compileIntegrations()', () => {
  let awsCompileWebsocketsEvents;

  beforeEach(() => {
    ({ awsCompileWebsocketsEvents } = createWebsocketsCompilerContext({
      functions: {
        First: {},
        Second: {},
      },
    }));
  });

  it('should create an integration resource for every event', () => {
    awsCompileWebsocketsEvents.validated = {
      events: [
        {
          functionName: 'First',
          route: '$connect',
        },
        {
          functionName: 'Second',
          route: '$disconnect',
        },
      ],
    };

    awsCompileWebsocketsEvents.compileIntegrations();
    const resources =
      awsCompileWebsocketsEvents.serverless.service.provider.compiledCloudFormationTemplate
        .Resources;

    expect(resources).to.deep.equal({
      FirstWebsocketsIntegration: {
        Type: 'AWS::ApiGatewayV2::Integration',
        DependsOn: undefined,
        Properties: {
          ApiId: {
            Ref: 'WebsocketsApi',
          },
          IntegrationType: 'AWS_PROXY',
          IntegrationUri: {
            'Fn::Join': [
              '',
              [
                'arn:',
                {
                  Ref: 'AWS::Partition',
                },
                ':apigateway:',
                {
                  Ref: 'AWS::Region',
                },
                ':lambda:path/2015-03-31/functions/',
                {
                  'Fn::GetAtt': ['FirstLambdaFunction', 'Arn'],
                },
                '/invocations',
              ],
            ],
          },
        },
      },
      SecondWebsocketsIntegration: {
        Type: 'AWS::ApiGatewayV2::Integration',
        DependsOn: undefined,
        Properties: {
          ApiId: {
            Ref: 'WebsocketsApi',
          },
          IntegrationType: 'AWS_PROXY',
          IntegrationUri: {
            'Fn::Join': [
              '',
              [
                'arn:',
                {
                  Ref: 'AWS::Partition',
                },
                ':apigateway:',
                {
                  Ref: 'AWS::Region',
                },
                ':lambda:path/2015-03-31/functions/',
                {
                  'Fn::GetAtt': ['SecondLambdaFunction', 'Arn'],
                },
                '/invocations',
              ],
            ],
          },
        },
      },
    });
  });
});
