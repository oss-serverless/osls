'use strict';

const ServerlessError = require('../../../../../../../serverless-error');
const isObject = require('type/object/is');

function createUsagePlanKeyResource(that, usagePlanLogicalId, keyNumber, keyName) {
  const apiKeyLogicalId = that.provider.naming.getApiKeyLogicalId(keyNumber, keyName);

  return {
    Type: 'AWS::ApiGateway::UsagePlanKey',
    Properties: {
      KeyId: {
        Ref: apiKeyLogicalId,
      },
      KeyType: 'API_KEY',
      UsagePlanId: {
        Ref: usagePlanLogicalId,
      },
    },
  };
}

module.exports = {
  compileUsagePlanKeys() {
    const apiKeys =
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.apiKeys;
    if (apiKeys) {
      const resources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources;
      let keyNumber = 0;

      apiKeys.forEach((apiKeyDefinition) => {
        // if multiple API key types are used
        const apiKey = Object.entries(apiKeyDefinition)[0];
        const name = apiKey[0];
        const value = apiKey.at(-1);
        const usagePlansIncludeName = this.apiGatewayUsagePlanNames.includes(name);
        if (this.apiGatewayUsagePlanNames.length > 0 && !usagePlansIncludeName && isObject(value)) {
          throw new ServerlessError(
            `API key "${name}" has no usage plan defined`,
            'API_GATEWAY_KEY_WITHOUT_USAGE_PLAN'
          );
        }
        if (isObject(apiKeyDefinition) && usagePlansIncludeName) {
          keyNumber = 0;
          apiKeyDefinition[name].forEach(() => {
            keyNumber += 1;
            const usagePlanKeyLogicalId = this.provider.naming.getUsagePlanKeyLogicalId(
              keyNumber,
              name
            );
            const usagePlanLogicalId = this.provider.naming.getUsagePlanLogicalId(name);
            const resourceTemplate = createUsagePlanKeyResource(
              this,
              usagePlanLogicalId,
              keyNumber,
              name
            );
            resources[usagePlanKeyLogicalId] = resourceTemplate;
          });
        } else {
          keyNumber += 1;
          const usagePlanKeyLogicalId = this.provider.naming.getUsagePlanKeyLogicalId(keyNumber);
          const usagePlanLogicalId = this.provider.naming.getUsagePlanLogicalId();
          const resourceTemplate = createUsagePlanKeyResource(this, usagePlanLogicalId, keyNumber);
          resources[usagePlanKeyLogicalId] = resourceTemplate;
        }
      });
    }
  },
};
