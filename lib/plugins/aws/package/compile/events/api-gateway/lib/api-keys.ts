'use strict';

const isObject = require('type/object/is');

function createApiKeyResource(that, apiKey) {
  const name = typeof apiKey === 'string' ? apiKey : apiKey.name;
  const value = isObject(apiKey) && apiKey.value ? apiKey.value : undefined;
  const description = isObject(apiKey) ? apiKey.description : undefined;
  const customerId = isObject(apiKey) ? apiKey.customerId : undefined;
  const enabled = isObject(apiKey) && apiKey.enabled != null ? apiKey.enabled : true;

  return {
    Type: 'AWS::ApiGateway::ApiKey',
    Properties: {
      Enabled: enabled,
      Name: name,
      Value: value,
      Description: description,
      CustomerId: customerId,
      StageKeys: [
        {
          RestApiId: that.provider.getApiGatewayRestApiId(),
          StageName: that.provider.getStage(),
        },
      ],
    },
    DependsOn: that.apiGatewayDeploymentLogicalId,
  };
}

module.exports = {
  compileApiKeys() {
    const apiKeys =
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.apiKeys;
    if (apiKeys) {
      const resources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources;
      let keyNumber = 0;
      apiKeys.forEach((apiKeyDefinition) => {
        // if multiple API key types are used
        const name = Object.keys(apiKeyDefinition)[0];
        const usagePlan =
          this.serverless.service.provider.apiGateway &&
          this.serverless.service.provider.apiGateway.usagePlan;
        if (
          isObject(apiKeyDefinition) &&
          Array.isArray(usagePlan) &&
          usagePlan
            .map((item) => Object.keys(item))
            .flat()
            .includes(name)
        ) {
          keyNumber = 0;
          apiKeyDefinition[name].forEach((key) => {
            keyNumber += 1;
            const apiKeyLogicalId = this.provider.naming.getApiKeyLogicalId(keyNumber, name);
            resources[apiKeyLogicalId] = createApiKeyResource(this, key);
          });
        } else {
          keyNumber += 1;
          const apiKeyLogicalId = this.provider.naming.getApiKeyLogicalId(keyNumber);
          resources[apiKeyLogicalId] = createApiKeyResource(this, apiKeyDefinition);
        }
      });
    }
  },
};
