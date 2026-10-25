'use strict';

const ensureString = require('type/string/ensure');
const ServerlessError = require('../../../../serverless-error');
const { hasOwn } = require('../../../../utils/safe-object');
const validateStage = require('../../../../utils/validate-stage');

module.exports = (serverlessInstance) => {
  return {
    resolve: async ({ address, resolveConfigurationProperty, options }) => {
      if (!address) {
        throw new ServerlessError(
          'Missing address argument in variable "sls" source',
          'MISSING_SLS_SOURCE_ADDRESS'
        );
      }
      address = ensureString(address, {
        Error: ServerlessError,
        errorMessage: 'Non-string address argument in variable "sls" source: %v',
        errorCode: 'INVALID_SLS_SOURCE_ADDRESS',
      });

      switch (address) {
        case 'instanceId':
          if (!serverlessInstance) return { value: null, isPending: true };
          return { value: serverlessInstance.instanceId };
        case 'stage': {
          let stage;
          if (hasOwn(options, 'stage') && options.stage != null) {
            stage = options.stage;
          } else {
            stage = await resolveConfigurationProperty(['provider', 'stage']);
          }
          if (stage == null) stage = 'dev';
          return { value: validateStage(stage) };
        }
        default:
          throw new ServerlessError(
            `Unsupported "${address}" address argument in variable "sls" source`,
            'UNSUPPORTED_SLS_SOURCE_ADDRESS'
          );
      }
    },
  };
};
