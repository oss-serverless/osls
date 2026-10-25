'use strict';

const { log } = require('../../../../utils/serverless-utils/log');
const ServerlessError = require('../../../../serverless-error');
const isS3ListAccessDeniedError = require('../../utils/is-s3-list-access-denied-error');
const {
  getAwsErrorCode,
  isCloudFormationMissingResourceError,
} = require('../../../../aws/aws-sdk-v3-error');
const {
  S3Client,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
} = require('@aws-sdk/client-s3');

const maxDeleteObjectsCount = 1000;

const createS3ListObjectsAccessDeniedError = () =>
  new ServerlessError(
    'Could not list objects in the deployment bucket. Make sure you have sufficient permissions to access it.',
    'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED'
  );

function getS3Client(context) {
  context.s3ClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new S3Client(config));
  return context.s3ClientPromise;
}

module.exports = {
  async setServerlessDeploymentBucketName() {
    try {
      const bucketName = await this.provider.getServerlessDeploymentBucketName();
      this.bucketName = bucketName;
    } catch (err) {
      // If there is a validation error with expected message, it means that logical resource for
      // S3 bucket does not exist and we want to proceed with empty `bucketName`
      if (!isCloudFormationMissingResourceError(err)) {
        throw err;
      }
    }
  },

  async listObjectsV2() {
    const prefix = `${this.provider.getDeploymentPrefix()}/${
      this.serverless.service.service
    }/${this.provider.getStage()}/`;

    const s3 = await getS3Client(this);
    let ContinuationToken;

    do {
      let result;

      try {
        result = await s3.send(
          new ListObjectsV2Command({
            Bucket: this.bucketName,
            Prefix: prefix,
            ...(ContinuationToken ? { ContinuationToken } : {}),
          })
        );
      } catch (err) {
        if (isS3ListAccessDeniedError(err)) throw createS3ListObjectsAccessDeniedError();
        throw err;
      }

      const pageObjects = (result?.Contents || []).map((object) => ({
        Key: object.Key,
      }));

      const nextContinuationToken = result && result.NextContinuationToken;
      await this.deleteObjectBatches(pageObjects);
      ContinuationToken = nextContinuationToken;
    } while (ContinuationToken);
  },

  async listObjectVersions() {
    const prefix = `${this.provider.getDeploymentPrefix()}/${
      this.serverless.service.service
    }/${this.provider.getStage()}/`;

    const s3 = await getS3Client(this);
    let KeyMarker;
    let VersionIdMarker;

    do {
      let result;

      try {
        result = await s3.send(
          new ListObjectVersionsCommand({
            Bucket: this.bucketName,
            Prefix: prefix,
            ...(KeyMarker ? { KeyMarker } : {}),
            ...(VersionIdMarker ? { VersionIdMarker } : {}),
          })
        );
      } catch (err) {
        if (isS3ListAccessDeniedError(err)) throw createS3ListObjectsAccessDeniedError();
        throw err;
      }

      const pageObjects = [
        ...(result?.Versions || []).map((object) => ({
          Key: object.Key,
          VersionId: object.VersionId,
        })),
        ...(result?.DeleteMarkers || []).map((object) => ({
          Key: object.Key,
          VersionId: object.VersionId,
        })),
      ];

      const nextKeyMarker = result && result.NextKeyMarker;
      const nextVersionIdMarker = result && result.NextVersionIdMarker;
      await this.deleteObjectBatches(pageObjects);
      KeyMarker = nextKeyMarker;
      VersionIdMarker = nextVersionIdMarker;
    } while (KeyMarker || VersionIdMarker);
  },

  async listObjects() {
    const deploymentBucketObject = this.serverless.service.provider.deploymentBucketObject;
    return deploymentBucketObject && deploymentBucketObject.versioning
      ? this.listObjectVersions()
      : this.listObjectsV2();
  },

  async deleteObjectBatches(objects) {
    if (!objects.length) return;

    const s3 = await getS3Client(this);
    for (let index = 0; index < objects.length; index += maxDeleteObjectsCount) {
      const batch = objects.slice(index, index + maxDeleteObjectsCount);
      const data = await s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {
            Objects: batch,
          },
        })
      );
      if (data && data.Errors && data.Errors.length) {
        const firstError = data.Errors[0];
        const firstErrorCode = getAwsErrorCode(firstError);

        if (firstErrorCode === 'AccessDenied') {
          throw new ServerlessError(
            `Could not empty the S3 deployment bucket (${this.bucketName}). Make sure that you have permissions that allow S3 objects deletion. First encountered S3 error code: ${firstErrorCode}`,
            'CANNOT_DELETE_S3_OBJECTS_ACCESS_DENIED'
          );
        }

        throw new ServerlessError(
          `Could not empty the S3 deployment bucket (${this.bucketName}). First encountered S3 error code: ${firstErrorCode}`,
          'CANNOT_DELETE_S3_OBJECTS_GENERIC'
        );
      }
    }
  },

  async emptyS3Bucket() {
    await this.setServerlessDeploymentBucketName();
    if (this.bucketName && (await this.checkIfBucketExists(this.bucketName))) {
      await this.listObjects();
    } else {
      log.info('S3 bucket not found. Skipping S3 bucket objects removal');
    }
  },
};
