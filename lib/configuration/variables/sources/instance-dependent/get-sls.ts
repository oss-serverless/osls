import ensureString from 'type/string/ensure.js';
import ServerlessError from '../../../../serverless-error.ts';
import { hasOwn } from '../../../../utils/safe-object.ts';
import validateStage from '../../../../utils/validate-stage.ts';

export default (serverlessInstance) => {
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
