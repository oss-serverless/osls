'use strict';

const ensureString = require('type/string/ensure');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const ServerlessError = require('../../../../serverless-error');
const s3BodyToString = require('../../../../aws/s3-body-to-string');
const createCachedAwsVariableSourceCommandSender = require('./create-cached-aws-variable-source-command-sender');
const { isS3GetObjectNoSuchKeyError } = require('../../../../aws/aws-sdk-v3-error');
const { retryOnTransientNetworkError } = require('../../../../aws/retry');

module.exports = (serverlessInstance) => {
  const sender = createCachedAwsVariableSourceCommandSender({
    getProvider: () => serverlessInstance.getProvider('aws'),
    Client: S3Client,
    // Buckets may live in a different region than the provider region
    clientOptions: { followRegionRedirects: true },
    transformResult: async ({ result }) => s3BodyToString(result.Body),
  });

  return {
    resolve: async ({ address }) => {
      // s3:bucketName/key
      if (!address) {
        throw new ServerlessError(
          'Missing address argument in variable "s3" source',
          'MISSING_S3_SOURCE_ADDRESS'
        );
      }
      address = ensureString(address, {
        Error: ServerlessError,
        errorMessage: 'Non-string address argument in variable "s3" source: %v',
        errorCode: 'INVALID_S3_SOURCE_ADDRESS',
      });
      const separatorIndex = address.indexOf('/');
      if (separatorIndex === -1) {
        throw new ServerlessError(
          `Unsupported "${address}" address argument in variable "s3" source. ` +
            'Expected "<bucket-name>/<key>" format',
          'UNSUPPORTED_S3_SOURCE_ADDRESS'
        );
      }
      const bucketName = address.slice(0, separatorIndex);
      const key = address.slice(separatorIndex + 1);

      const result = await (async () => {
        try {
          return await retryOnTransientNetworkError(
            () => sender.send(GetObjectCommand, { Bucket: bucketName, Key: key }),
            { name: 'S3 variable read' }
          );
        } catch (error) {
          if (isS3GetObjectNoSuchKeyError(error)) return null;
          throw error;
        }
      })();

      if (result == null) return { value: null };

      return { value: result };
    },
  };
};
