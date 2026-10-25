'use strict';

const AwsProvider = require('../../../../../../../../../lib/plugins/aws/provider');
const AwsCompileWebsocketsEvents = require('../../../../../../../../../lib/plugins/aws/package/compile/events/websockets/index');
const { createTmpDir } = require('../../../../../../../../utils/fs');

function createWebsocketsCompilerContext(config = {}) {
  const options = { stage: 'dev', region: 'us-east-1', ...config.options };
  const providers = new Map();
  const providerConfig = config.provider || {};
  const functions = config.functions || {};

  const serverless = {
    config: {},
    serviceDir: config.serviceDir || createTmpDir(),
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
    service: config.service || 'my-service',
    provider: {
      name: 'aws',
      compiledCloudFormationTemplate: { Resources: {}, Outputs: {} },
      ...providerConfig,
    },
    package: {
      artifactDirectoryName: 'serverless',
      ...config.package,
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
  const awsCompileWebsocketsEvents = new AwsCompileWebsocketsEvents(serverless, options);
  awsCompileWebsocketsEvents.websocketsApiLogicalId = provider.naming.getWebsocketsApiLogicalId();

  return { serverless, provider, awsCompileWebsocketsEvents, options };
}

module.exports = { createWebsocketsCompilerContext };
