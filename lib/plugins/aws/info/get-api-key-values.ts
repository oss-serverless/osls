'use strict';

const promiseLimit = require('ext/promise/limit').bind(Promise);
const isObject = require('type/object/is');
const {
  CloudFormationClient,
  DescribeStackResourcesCommand,
} = require('@aws-sdk/client-cloudformation');
const { APIGatewayClient, GetApiKeyCommand } = require('@aws-sdk/client-api-gateway');
const { retryOnThrottlingError } = require('../../../aws/retry');

function getCloudFormationClient(context) {
  context.cloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.cloudFormationClientPromise;
}

function getApiGatewayClient(context) {
  context.apiGatewayClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new APIGatewayClient(config));
  return context.apiGatewayClientPromise;
}

module.exports = {
  async getApiKeyValues() {
    const info = this.gatheredData.info;
    info.apiKeys = [];

    // check if the user has set api keys
    const apiKeyDefinitions =
      (this.serverless.service.provider.apiGateway &&
        this.serverless.service.provider.apiGateway.apiKeys) ||
      this.serverless.service.provider.apiKeys;
    const apiKeyNames = [];
    if (Array.isArray(apiKeyDefinitions) && apiKeyDefinitions.length) {
      apiKeyDefinitions.forEach((definition) => {
        // different API key types are nested in separate arrays
        if (isObject(definition)) {
          const keyTypeName = Object.keys(definition)[0];
          if (Array.isArray(definition[keyTypeName])) {
            definition[keyTypeName].forEach((keyName) => apiKeyNames.push(keyName));
          } else if (definition.name) {
            apiKeyNames.push(definition.name);
          }
        } else if (typeof definition === 'string') {
          // plain strings are simple, non-nested API keys
          apiKeyNames.push(definition);
        }
      });
    }

    if (apiKeyNames.length) {
      const cloudFormation = await getCloudFormationClient(this);
      const resources = await retryOnThrottlingError(
        () =>
          cloudFormation.send(
            new DescribeStackResourcesCommand({
              StackName: this.provider.naming.getStackName(),
            })
          ),
        { name: 'CloudFormation stack resources description' }
      );
      const apiKeys = (resources.StackResources || [])
        .filter((resource) => resource.ResourceType === 'AWS::ApiGateway::ApiKey')
        .map((resource) => resource.PhysicalResourceId);
      const apiGateway = await getApiGatewayClient(this);
      if (!this.limitApiGatewayRequests) {
        this.limitApiGatewayRequests = promiseLimit(2, async (task) => task());
      }
      const apiKeyResults = await Promise.all(
        apiKeys.map((apiKey) =>
          this.limitApiGatewayRequests(() =>
            retryOnThrottlingError(
              () =>
                apiGateway.send(
                  new GetApiKeyCommand({
                    apiKey,
                    includeValue: true,
                  })
                ),
              { name: 'API Gateway API key description' }
            )
          )
        )
      );
      if (apiKeyResults && apiKeyResults.length) {
        info.apiKeys = apiKeyResults.map((apiKey) => ({
          name: apiKey.name,
          value: apiKey.value,
          description: apiKey.description,
          customerId: apiKey.customerId,
        }));
      }
      return undefined;
    }
    return undefined;
  },
};
