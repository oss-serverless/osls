'use strict';

const ServerlessError = require('../../../serverless-error');
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const {
  isS3HeadBucketNotFoundError,
  isS3HeadBucketForbiddenError,
} = require('../../../aws/aws-sdk-v3-error');

function getS3Client(context) {
  context.s3ClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new S3Client(config));
  return context.s3ClientPromise;
}

module.exports = {
  async checkIfBucketExists(bucketName) {
    try {
      const s3 = await getS3Client(this);
      await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
      return true;
    } catch (err) {
      if (isS3HeadBucketNotFoundError(err)) {
        return false;
      }

      if (isS3HeadBucketForbiddenError(err)) {
        throw new ServerlessError(
          'Could not access the deployment bucket. Make sure you have sufficient permissions to access it.',
          'AWS_S3_HEAD_BUCKET_FORBIDDEN'
        );
      }

      throw err;
    }
  },
};
