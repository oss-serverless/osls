'use strict';

const validate = require('./lib/validate');
const setBucketName = require('./lib/set-bucket-name');
const updateStack = require('./lib/update-stack');
const monitorStack = require('./lib/monitor-stack');
const waitForChangeSetCreation = require('./lib/wait-for-change-set-creation');
const getCreateChangeSetParams = require('./lib/get-create-change-set-params');
const getExecuteChangeSetParams = require('./lib/get-execute-change-set-params');
const getSharedStackActionParams = require('./lib/get-shared-stack-action-params');
const getCreateStackParams = require('./lib/get-create-stack-params');
const getUpdateStackParams = require('./lib/get-update-stack-params');
const findAndGroupDeployments = require('./utils/find-and-group-deployments');
const isS3ListAccessDeniedError = require('./utils/is-s3-list-access-denied-error');
const s3BodyToString = require('../../aws/s3-body-to-string');
const ServerlessError = require('../../serverless-error');
const { style, log, progress } = require('../../utils/serverless-utils/log');
const { S3Client, GetObjectCommand, paginateListObjectsV2 } = require('@aws-sdk/client-s3');
const { isS3GetObjectNoSuchKeyError } = require('../../aws/aws-sdk-v3-error');
const { retryOnTransientNetworkError } = require('../../aws/retry');

const slsConsoleLog = log.get('console');

const mainProgress = progress.get('main');

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

class AwsRollback {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    Object.assign(
      this,
      validate,
      setBucketName,
      updateStack,
      monitorStack,
      waitForChangeSetCreation,
      getCreateChangeSetParams,
      getExecuteChangeSetParams,
      getCreateStackParams,
      getUpdateStackParams,
      getSharedStackActionParams
    );

    this.hooks = {
      'before:rollback:initialize': async () => this.validate(),

      'rollback:rollback': async () => {
        if (!this.options.timestamp) {
          log.notice(
            'Select a timestamp from the deploy list below and run "sls rollback -t <timestamp>" to rollback your service to a specific version.'
          );
          log.notice();
          await this.serverless.pluginManager.spawn('deploy:list');
          return;
        }

        log.notice();
        log.notice(
          `Rolling back ${this.serverless.service.service} to timestamp "${this.options.timestamp}"`
        );
        log.info(); // Ensure gap between verbose logging

        mainProgress.notice('Validating', { isMainEvent: true });
        await this.setBucketName();
        await this.setStackToUpdate();
        mainProgress.notice('Updating CloudFormation stack', { isMainEvent: true });
        const result = await this.updateStack();

        log.notice();
        if (result) {
          log.notice.success(
            `Service rolled back to timestamp "${this.options.timestamp}" ${style.aside(
              `(${Math.floor(
                (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
              )}s)`
            )}`
          );
          if (this.serverless.service.provider.deploymentMode === 'express') {
            log.notice(
              style.aside(
                'Rolled back with CloudFormation express mode. Resources may still be stabilizing in the background.'
              )
            );
          }
        } else {
          log.notice.skip(
            `No updates to be performed. Rollback skipped. ${style.aside(
              `(${Math.floor(
                (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
              )}s)`
            )}`
          );
        }
      },
    };
  }

  async setStackToUpdate() {
    const service = this.serverless.service;
    const serviceName = this.serverless.service.service;
    const stage = this.provider.getStage();
    const deploymentPrefix = this.provider.getDeploymentPrefix();
    const prefix = `${deploymentPrefix}/${serviceName}/${stage}/`;

    const response = { Contents: [] };
    const s3 = await getS3Client(this);
    try {
      for await (const page of paginateListObjectsV2(
        { client: s3 },
        {
          Bucket: this.bucketName,
          Prefix: prefix,
        }
      )) {
        response.Contents.push(...(page?.Contents || []));
      }
    } catch (err) {
      if (isS3ListAccessDeniedError(err)) throw createS3ListObjectsAccessDeniedError();
      throw err;
    }

    const deployments = findAndGroupDeployments(response, deploymentPrefix, serviceName, stage);

    if (deployments.length === 0) {
      const msg = "Couldn't find any existing deployments.";
      const hint = 'Please verify that stage and region are correct.';
      throw new ServerlessError(`${msg} ${hint}`, 'ROLLBACK_DEPLOYMENTS_NOT_FOUND');
    }

    let date = new Date(this.options.timestamp);

    // The if below is added due issues#5664 - Check it for more details
    if (date instanceof Date === false || isNaN(date.valueOf())) {
      date = new Date(Number(this.options.timestamp));
    }

    const dateString = `${date.getTime().toString()}-${date.toISOString()}`;
    const exists = deployments.some((deployment) =>
      deployment.some(
        (item) =>
          item.directory === dateString &&
          item.file === this.provider.naming.getCompiledTemplateS3Suffix()
      )
    );

    if (!exists) {
      const msg = `Couldn't find a deployment for the timestamp: ${this.options.timestamp}.`;
      const hint = 'Please verify that the timestamp, stage and region are correct.';
      throw new ServerlessError(`${msg} ${hint}`, 'ROLLBACK_DEPLOYMENT_NOT_FOUND');
    }

    service.package.artifactDirectoryName = `${prefix}${dateString}`;
    const stateString = await (async () => {
      try {
        // Body-phase network failures occur after send() resolves, outside the SDK
        // retry middleware, so the read is retried as a whole
        return await retryOnTransientNetworkError(
          async () => {
            const result = await s3.send(
              new GetObjectCommand({
                Bucket: this.bucketName,
                Key: `${
                  service.package.artifactDirectoryName
                }/${this.provider.naming.getServiceStateFileName()}`,
              })
            );
            return s3BodyToString(result.Body);
          },
          { name: 'service state download' }
        );
      } catch (error) {
        if (isS3GetObjectNoSuchKeyError(error)) return null;
        throw error;
      }
    })();
    const state = stateString === null ? {} : JSON.parse(stateString);
    slsConsoleLog.debug('resolved state %o', state);
    if (state.console) {
      throw new ServerlessError(
        'Cannot rollback deployment: Target deployment was packaged with old ' +
          'Serverless Console integration, which is no longer supported',
        'CONSOLE_ACTIVATION_MISMATCH_ROLLBACK'
      );
    }
  }
}

module.exports = AwsRollback;
