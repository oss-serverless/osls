'use strict';

const expect = require('chai').expect;
const { createWebsocketsCompilerContext } = require('../test-utils');

describe('#compileRouteResponses()', () => {
  let awsCompileWebsocketsEvents;

  beforeEach(() => {
    ({ awsCompileWebsocketsEvents } = createWebsocketsCompilerContext());
  });

  it('should create a RouteResponse resource for events with selection expression', () => {
    awsCompileWebsocketsEvents.validated = {
      events: [
        {
          functionName: 'First',
          route: '$connect',
          routeResponseSelectionExpression: '$default',
        },
      ],
    };

    awsCompileWebsocketsEvents.compileRouteResponses();

    const resources =
      awsCompileWebsocketsEvents.serverless.service.provider.compiledCloudFormationTemplate
        .Resources;

    expect(resources).to.deep.equal({
      SconnectWebsocketsRouteResponse: {
        Type: 'AWS::ApiGatewayV2::RouteResponse',
        Properties: {
          ApiId: {
            Ref: 'WebsocketsApi',
          },
          RouteId: {
            Ref: 'SconnectWebsocketsRoute',
          },
          RouteResponseKey: '$default',
        },
      },
    });
  });

  it('should NOT create a RouteResponse for events without selection expression', () => {
    awsCompileWebsocketsEvents.validated = {
      events: [
        {
          functionName: 'First',
          route: '$connect',
        },
      ],
    };

    awsCompileWebsocketsEvents.compileRouteResponses();

    const resources =
      awsCompileWebsocketsEvents.serverless.service.provider.compiledCloudFormationTemplate
        .Resources;

    expect(resources).to.deep.equal({});
  });
});
