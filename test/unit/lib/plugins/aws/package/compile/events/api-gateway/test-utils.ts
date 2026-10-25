'use strict';

const AwsProvider = require('../../../../../../../../../lib/plugins/aws/provider');
const AwsCompileApigEvents = require('../../../../../../../../../lib/plugins/aws/package/compile/events/api-gateway/index');

function createApiGatewayCompilerContext(config = {}) {
  const options = { stage: 'dev', region: 'us-east-1', ...config.options };
  const providers = new Map();
  const providerConfig = config.provider || {};
  const functions = config.functions || {};

  const serverless = {
    config: {},
    serviceDir: null,
    cli: { log() {} },
    init: () => Promise.resolve(),
    setProvider(name, provider) {
      providers.set(name, provider);
    },
    getProvider(name) {
      return providers.get(name);
    },
    configSchemaHandler: {
      defineProvider() {},
      defineFunctionEvent() {},
    },
  };

  serverless.service = {
    service: 'first-service',
    provider: {
      name: 'aws',
      compiledCloudFormationTemplate: { Resources: {}, Outputs: {} },
      ...providerConfig,
    },
    functions,
    environment: config.environment || {},
    getFunction(functionName) {
      return this.functions[functionName];
    },
  };

  const provider = new AwsProvider(serverless, options);
  const awsCompileApigEvents = new AwsCompileApigEvents(serverless, options);

  return { serverless, provider, awsCompileApigEvents, options };
}

module.exports = { createApiGatewayCompilerContext };
