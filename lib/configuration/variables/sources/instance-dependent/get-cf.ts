import ensureString from 'type/string/ensure.js';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import ServerlessError from '../../../../serverless-error.ts';
import createCachedAwsVariableSourceCommandSender from './create-cached-aws-variable-source-command-sender.ts';
import { isCloudFormationValidationErrorWithMessage } from '../../../../aws/aws-sdk-v3-error.ts';

export default (serverlessInstance) => {
  const sender = createCachedAwsVariableSourceCommandSender({
    getProvider: () => serverlessInstance.getProvider('aws'),
    Client: CloudFormationClient,
  });

  return {
    resolve: async ({ address, params }) => {
      // cf(region = null):stackName.outputLogicalId
      if (!address) {
        throw new ServerlessError(
          'Missing address argument in variable "cf" source',
          'MISSING_SLS_SOURCE_ADDRESS'
        );
      }
      address = ensureString(address, {
        Error: ServerlessError,
        errorMessage: 'Non-string address argument in variable "cf" source: %v',
        errorCode: 'INVALID_CF_SOURCE_ADDRESS',
      });
      const separatorIndex = address.indexOf('.');
      if (separatorIndex === -1) {
        throw new ServerlessError(
          `Unsupported "${address}" address argument in variable "cf" source. ` +
            'Expected "<stack-name>.<output-id>" format',
          'UNSUPPORTED_SLS_SOURCE_ADDRESS'
        );
      }
      const stackName = address.slice(0, separatorIndex);
      const outputLogicalId = address.slice(separatorIndex + 1);

      const result = await (async () => {
        try {
          return await sender.send(
            DescribeStacksCommand,
            { StackName: stackName },
            { region: params && params[0] }
          );
        } catch (error) {
          if (isCloudFormationValidationErrorWithMessage(error, 'does not exist')) return null;
          throw error;
        }
      })();

      if (!result) return { value: null };
      const outputs = result.Stacks[0].Outputs || [];
      const output = outputs.find((x) => x.OutputKey === outputLogicalId);

      return { value: output ? output.OutputValue : null };
    },
  };
};
