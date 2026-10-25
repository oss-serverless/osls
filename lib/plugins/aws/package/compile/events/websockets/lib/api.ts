'use strict';

const { safeShallowAssign } = require('../../../../../../../utils/safe-object');

module.exports = {
  compileApi() {
    const apiGateway = this.serverless.service.provider.apiGateway || {};

    // immediately return if we're using an external websocket API id
    if (apiGateway.websocketApiId) {
      return;
    }

    if (
      this.serverless.service.provider.websocket &&
      this.serverless.service.provider.websocket.useProviderTags != null
    ) {
      this.serverless._logDeprecation(
        'AWS_WEBSOCKET_API_USE_PROVIDER_TAGS',
        'Property "provider.websocket.useProviderTags" is deprecated because provider tags are applied to Websocket Api Gateway by default. This property is scheduled for removal in osls 5.0.0.'
      );
    }

    this.websocketsApiLogicalId = this.provider.naming.getWebsocketsApiLogicalId();

    const RouteSelectionExpression =
      this.serverless.service.provider.websocketsApiRouteSelectionExpression ||
      '$request.body.action';

    const properties = {
      Name: this.provider.naming.getWebsocketsApiName(),
      RouteSelectionExpression,
      Description:
        this.serverless.service.provider.websocketsDescription || 'Serverless Websockets',
      ProtocolType: 'WEBSOCKET',
    };

    // Tags
    if (this.serverless.service.provider.tags) {
      const tags = safeShallowAssign({}, this.serverless.service.provider.tags);
      properties.Tags = tags;
    }

    this.serverless.service.provider.compiledCloudFormationTemplate.Resources[
      this.websocketsApiLogicalId
    ] = {
      Type: 'AWS::ApiGatewayV2::Api',
      Properties: properties,
    };

    const defaultRoleResource =
      this.serverless.service.provider.compiledCloudFormationTemplate.Resources[
        this.provider.naming.getRoleLogicalId()
      ];

    if (defaultRoleResource) {
      // insert policy that allows functions to postToConnection
      const websocketsPolicy = {
        Effect: 'Allow',
        Action: ['execute-api:ManageConnections'],
        Resource: [{ 'Fn::Sub': 'arn:${AWS::Partition}:execute-api:*:*:*/@connections/*' }],
      };

      this.serverless.service.provider.compiledCloudFormationTemplate.Resources[
        this.provider.naming.getRoleLogicalId()
      ].Properties.Policies[0].PolicyDocument.Statement.push(websocketsPolicy);
    }
  },
};
