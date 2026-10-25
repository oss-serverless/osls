'use strict';

const AwsProvider = require('../../../../../../../../lib/plugins/aws/provider');

function createAwsEventCompilerContext(EventCompiler, config = {}) {
  const options = { stage: 'dev', region: 'us-east-1', ...config.options };
  const providers = new Map();
  const providerConfig = config.provider || {};
  const functions = config.functions || {};

  const serverless = {
    config: {},
    serviceDir: null,
    cli: { log() {} },
    _logDeprecation() {},
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
    service: config.service || 'new-service',
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
    getAllFunctions() {
      return Object.keys(this.functions);
    },
  };

  const provider = new AwsProvider(serverless, options);
  const awsCompileEvents = new EventCompiler(serverless, options);

  return { serverless, provider, awsCompileEvents, options };
}

module.exports = { createAwsEventCompilerContext };
