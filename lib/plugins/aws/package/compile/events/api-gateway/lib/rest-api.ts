'use strict';

const ServerlessError = require('../../../../../../../serverless-error');

module.exports = {
  compileRestApi() {
    const apiGateway = this.serverless.service.provider.apiGateway || {};
    const endpoint = apiGateway.endpoint || {};

    // immediately return if we're using an external REST API id
    if (apiGateway.restApiId) {
      return;
    }

    this.apiGatewayRestApiLogicalId = this.provider.naming.getRestApiLogicalId();

    let endpointType = 'EDGE';
    let vpcEndpointIds;
    let BinaryMediaTypes;
    if (apiGateway.binaryMediaTypes) {
      BinaryMediaTypes = apiGateway.binaryMediaTypes;
    }

    if (this.serverless.service.provider.endpointType) {
      endpointType = this.serverless.service.provider.endpointType.toUpperCase();

      if (this.serverless.service.provider.vpcEndpointIds) {
        vpcEndpointIds = this.serverless.service.provider.vpcEndpointIds;

        if (endpointType !== 'PRIVATE') {
          throw new ServerlessError(
            'VPC endpoint IDs are only available for private APIs',
            'API_GATEWAY_INVALID_VPC_ENDPOINT_IDS_CONFIG'
          );
        }
      }
    }

    const EndpointConfiguration = {
      Types: [endpointType],
    };

    if (vpcEndpointIds) {
      EndpointConfiguration.VpcEndpointIds = vpcEndpointIds;
    }

    const DisableExecuteApiEndpoint =
      apiGateway.disableDefaultEndpoint == null ? undefined : apiGateway.disableDefaultEndpoint;

    const properties = {
      Name: this.provider.naming.getApiGatewayName(),
      BinaryMediaTypes,
      DisableExecuteApiEndpoint,
      EndpointConfiguration,
    };

    if (endpoint.securityPolicy) {
      properties.SecurityPolicy = endpoint.securityPolicy;
    }

    if (endpoint.accessMode != null) {
      properties.EndpointAccessMode = endpoint.accessMode.toUpperCase();
    }

    // Tags
    if (this.serverless.service.provider.tags) {
      properties.Tags = Object.entries(this.serverless.service.provider.tags).map(
        ([Key, Value]) => ({
          Key,
          Value,
        })
      );
    }

    this.serverless.service.provider.compiledCloudFormationTemplate.Resources[
      this.apiGatewayRestApiLogicalId
    ] = {
      Type: 'AWS::ApiGateway::RestApi',
      Properties: properties,
    };

    const resourcePolicy =
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.resourcePolicy;
    const restApiProperties =
      this.serverless.service.provider.compiledCloudFormationTemplate.Resources[
        this.apiGatewayRestApiLogicalId
      ].Properties;
    if (resourcePolicy && Object.keys(resourcePolicy).length) {
      const policy = {
        Version: '2012-10-17',
        Statement: resourcePolicy,
      };
      restApiProperties.Policy = policy;
    } else {
      // setting up a policy with no restrictions in cases where no policy is specified
      // this ensures that a policy is always present
      restApiProperties.Policy = '';
    }

    if (apiGateway.apiKeySourceType) {
      const apiKeySourceType = apiGateway.apiKeySourceType.toUpperCase();

      restApiProperties.ApiKeySourceType = apiKeySourceType;
    }

    if (apiGateway.minimumCompressionSize != null) {
      const minimumCompressionSize = apiGateway.minimumCompressionSize;

      restApiProperties.MinimumCompressionSize = minimumCompressionSize;
    }

    if (apiGateway.description) {
      const description = apiGateway.description;

      restApiProperties.Description = description;
    }
  },
};
