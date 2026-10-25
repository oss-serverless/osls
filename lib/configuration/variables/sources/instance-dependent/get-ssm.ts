'use strict';

const ensureString = require('type/string/ensure');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const ServerlessError = require('../../../../serverless-error');
const createCachedAwsVariableSourceCommandSender = require('./create-cached-aws-variable-source-command-sender');
const { isSsmParameterNotFoundError } = require('../../../../aws/aws-sdk-v3-error');

module.exports = (serverlessInstance) => {
  const sender = createCachedAwsVariableSourceCommandSender({
    getProvider: () => serverlessInstance.getProvider('aws'),
    Client: SSMClient,
  });

  return {
    resolve: async ({ address, params }) => {
      // ssm(region = null):param-path
      if (!address) {
        throw new ServerlessError(
          'Missing address argument in variable "ssm" source',
          'MISSING_SLS_SOURCE_ADDRESS'
        );
      }
      address = ensureString(address, {
        Error: ServerlessError,
        errorMessage: 'Non-string address argument in variable "ssm" source: %v',
        errorCode: 'INVALID_SSM_SOURCE_ADDRESS',
      });
      const shouldReturnRawValue = params && params.includes('raw');
      const shouldSkipDecryption = params && params.includes('noDecrypt');
      const cleanedParams = params
        ? params.filter((param) => param !== 'raw' && param !== 'noDecrypt')
        : [];
      const region = cleanedParams[0];

      const result = await (async () => {
        try {
          return await sender.send(
            GetParameterCommand,
            {
              Name: address,
              WithDecryption: !shouldSkipDecryption,
            },
            { region }
          );
        } catch (error) {
          if (isSsmParameterNotFoundError(error)) return null;
          throw error;
        }
      })();

      if (!result) return { value: null };
      switch (result.Parameter.Type) {
        case 'String':
          return { value: result.Parameter.Value };
        case 'StringList':
          return {
            value: shouldReturnRawValue
              ? result.Parameter.Value
              : result.Parameter.Value.split(','),
          };
        case 'SecureString':
          if (shouldReturnRawValue || !result.Parameter.Value.startsWith('{')) {
            return { value: result.Parameter.Value };
          }
          try {
            return { value: JSON.parse(result.Parameter.Value) };
          } catch {
            return { value: result.Parameter.Value };
          }

        default:
          throw new Error(`Unexpected parameter type: "${result.Parameter.Type}"`);
      }
    },
  };
};
