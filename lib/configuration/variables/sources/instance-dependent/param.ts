'use strict';

const memoizee = require('memoizee');
const ensureString = require('type/string/ensure');
const ServerlessError = require('../../../../serverless-error');
const { hasOwn } = require('../../../../utils/safe-object');
const validateStage = require('../../../../utils/validate-stage');

const resolveParams = memoizee(async (stage, serverlessInstance) => {
  const configParams = new Map(
    Object.entries(
      (serverlessInstance.configurationInput && serverlessInstance.configurationInput.params) || {}
    )
  );

  const resultParams = Object.create(null);

  if (serverlessInstance.processedInput.options.param) {
    const regex = /(?<key>[^=]+)=(?<value>.+)/;
    for (const item of serverlessInstance.processedInput.options.param) {
      const res = item.match(regex);
      if (!res) {
        throw new ServerlessError(
          `Encountered invalid "--param" CLI option value: "${item}". Supported format: "--param='<key>=<val>'"`,
          'INVALID_CLI_PARAM_FORMAT'
        );
      }
      resultParams[res.groups.key] = { value: res.groups.value.trimEnd(), type: 'cli' };
    }
  }

  for (const [name, value] of Object.entries(configParams.get(stage) || {})) {
    if (value == null) continue;
    if (resultParams[name] != null) continue;
    resultParams[name] = { value, type: 'configServiceStage' };
  }

  for (const [name, value] of new Map(Object.entries(configParams.get('default') || {}))) {
    if (value == null) continue;
    if (resultParams[name] != null) continue;
    resultParams[name] = { value, type: 'configService' };
  }

  return resultParams;
});

module.exports = (serverlessInstance) => {
  return {
    resolve: async ({ address, resolveConfigurationProperty, options }) => {
      if (!address) {
        throw new ServerlessError(
          'Missing address argument in variable "param" source',
          'MISSING_PARAM_SOURCE_ADDRESS'
        );
      }
      address = ensureString(address, {
        Error: ServerlessError,
        errorMessage: 'Non-string address argument in variable "param" source: %v',
        errorCode: 'INVALID_PARAM_SOURCE_ADDRESS',
      });
      if (!serverlessInstance) return { value: null, isPending: true };

      let stage;
      if (hasOwn(options, 'stage') && options.stage != null) {
        stage = options.stage;
      } else {
        stage = await resolveConfigurationProperty(['provider', 'stage']);
      }
      if (stage == null) stage = 'dev';
      stage = validateStage(stage);

      const params = await resolveParams(stage, serverlessInstance);
      const value = params[address] ? params[address].value : null;

      return { value };
    },
  };
};
