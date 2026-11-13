'use strict';

const ServerlessError = require('../../../../serverless-error');
const { log, progress } = require('../../../../utils/serverless-utils/log');
const jsyaml = require('js-yaml');
const cloudformationSchema = require('../../../../utils/serverless-utils/cloudformation-schema');
const {
  S3Client,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
} = require('@aws-sdk/client-s3');
const {
  CloudFormationClient,
  GetTemplateCommand,
  UpdateStackCommand,
  DeleteChangeSetCommand,
  CreateChangeSetCommand,
  ExecuteChangeSetCommand,
} = require('@aws-sdk/client-cloudformation');
const {
  getS3BucketRegion,
  isCloudFormationMissingResourceError,
  isS3BucketAccessDeniedError,
  isS3GetBucketPolicyDeniedError,
  isS3GetBucketPolicyNotFoundError,
} = require('../../../../aws/aws-sdk-v3-error');

const mainProgress = progress.get('main');

function getS3Client(context) {
  context.s3ClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new S3Client(config));
  return context.s3ClientPromise;
}

function getCloudFormationClient(context) {
  context.cloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.cloudFormationClientPromise;
}

module.exports = {
  async ensureValidBucketExists() {
    // Ensure to set bucket name if it can be resolved
    // Result of this operation will determine how further validation will be performed
    try {
      await this.setBucketName();
    } catch (err) {
      // If there is a validation error with expected message, it means that logical resource for
      // S3 bucket does not exist and we want to proceed with handling that situation
      if (!isCloudFormationMissingResourceError(err)) {
        throw err;
      }
    }

    // Validate that custom deployment bucket exists and has proper location
    if (this.serverless.service.provider.deploymentBucket) {
      let bucketRegion;
      try {
        const s3 = await getS3Client(this);
        bucketRegion = getS3BucketRegion(
          await s3.send(new HeadBucketCommand({ Bucket: this.bucketName }))
        );
      } catch (err) {
        bucketRegion = getS3BucketRegion(err);
        if (!bucketRegion) {
          throw new ServerlessError(
            `Could not locate deployment bucket: "${this.bucketName}". Error: ${err.message}`,
            'DEPLOYMENT_BUCKET_NOT_FOUND'
          );
        }
      }

      if (bucketRegion && bucketRegion !== this.provider.getRegion()) {
        throw new ServerlessError(
          'Deployment bucket is not in the same region as the lambda function',
          'DEPLOYMENT_BUCKET_INVALID_REGION'
        );
      }
      // If above is satisfied, then custom S3 bucket is valid
      return;
    }

    // If bucket name is set, it means it's defined as a part of CloudFormation template (custom bucket case was handled by logic above)
    if (this.bucketName) {
      if (!(await this.checkIfBucketExists(this.bucketName))) {
        // It means that bucket was removed manually but is still a part of the CloudFormation stack, we cannot manually fix it
        throw new ServerlessError(
          'Deployment bucket has been removed manually. Please recreate it or remove your service and attempt to deploy it again',
          'DEPLOYMENT_BUCKET_REMOVED_MANUALLY'
        );
      }
      return;
    }

    log.info(
      'Deployment bucket not found. Updating stack to include deployment bucket definition.'
    );
    const stackName = this.provider.naming.getStackName();
    const changeSetName = this.provider.naming.getStackChangeSetName();
    const cloudFormation = await getCloudFormationClient(this);

    // This is situation where the bucket is not defined in the template at all
    // It covers the case where someone was using custom deployment bucket
    // but removed that setting from the configuration
    mainProgress.notice('Ensuring that deployment bucket exists', { isMainEvent: true });
    const getTemplateResult = await cloudFormation.send(
      new GetTemplateCommand({
        StackName: stackName,
        TemplateStage: 'Original',
      })
    );

    let templateBody;

    if (getTemplateResult.TemplateBody) {
      try {
        templateBody = JSON.parse(getTemplateResult.TemplateBody);
      } catch {
        try {
          templateBody = jsyaml.load(getTemplateResult.TemplateBody, {
            schema: cloudformationSchema,
          });
        } catch (error) {
          throw new ServerlessError(
            `Could not parse CloudFormation template: ${error.message}`,
            'CLOUDFORMATION_TEMPLATE_PARSE_FAILED'
          );
        }
      }
    } else {
      templateBody = {};
    }

    if (!templateBody.Resources) {
      templateBody.Resources = {};
    }
    if (!templateBody.Outputs) {
      templateBody.Outputs = {};
    }

    Object.assign(
      templateBody.Resources,
      this.serverless.service.provider.coreCloudFormationTemplate.Resources
    );
    Object.assign(
      templateBody.Outputs,
      this.serverless.service.provider.coreCloudFormationTemplate.Outputs
    );

    let monitorCfData;

    if (this.serverless.service.provider.deploymentMethod === 'direct') {
      const params = this.getUpdateStackParams({ templateBody });

      monitorCfData = await cloudFormation.send(new UpdateStackCommand(params));
    } else {
      const createChangeSetParams = this.getCreateChangeSetParams({
        changeSetType: 'UPDATE',
        templateBody,
      });

      const executeChangeSetParams = this.getExecuteChangeSetParams();

      // Ensure that previous change set has been removed
      await cloudFormation.send(
        new DeleteChangeSetCommand({
          StackName: stackName,
          ChangeSetName: changeSetName,
        })
      );

      log.info('Creating new change set.');
      // Create new change set
      const changeSet = await cloudFormation.send(
        new CreateChangeSetCommand(createChangeSetParams)
      );

      // Wait for changeset to be created
      log.info('Waiting for new change set to be created.');
      await this.waitForChangeSetCreation(changeSetName, stackName);

      // We are not checking if change set has any changes here because we already know that there was no deployment bucket
      // that needs to be created as a part of change set
      // If that would not be the case, that means we have a bug in the logic above

      await cloudFormation.send(new ExecuteChangeSetCommand(executeChangeSetParams));
      monitorCfData = changeSet;
    }
    await this.monitorStack('update', monitorCfData);
    await this.setBucketName();
  },

  // AWS Lambda reads the code of web apps straight from the bucket, which has to be versioned
  // and to allow that in its policy
  async ensureBucketSupportsWebApps() {
    const webAppNames = this.serverless.service.getAllWebApps();
    if (!webAppNames.length) return;

    const isBucketOfUser = Boolean(this.serverless.service.provider.deploymentBucket);
    const s3 = await getS3Client(this);
    const sendBucketCommand = async (command, action) => {
      try {
        return await s3.send(command);
      } catch (error) {
        if (!isS3BucketAccessDeniedError(error)) throw error;
        throw new ServerlessError(
          `Could not prepare the deployment bucket "${this.bucketName}" for web apps: access to "${action}" is denied. AWS Lambda reads the code of web apps straight from the deployment bucket, so osls checks that the bucket is versioned before it uploads the code.`,
          'WEB_APP_DEPLOYMENT_BUCKET_ACCESS_DENIED'
        );
      }
    };

    const { Status: versioningStatus } = await sendBucketCommand(
      new GetBucketVersioningCommand({ Bucket: this.bucketName }),
      's3:GetBucketVersioning'
    );
    if (versioningStatus !== 'Enabled') {
      if (isBucketOfUser) {
        throw new ServerlessError(
          `The deployment bucket "${this.bucketName}" is not versioned. AWS Lambda reads the code of web apps straight from the deployment bucket, which therefore has to be versioned. Enable versioning on the bucket and deploy again.`,
          'WEB_APP_DEPLOYMENT_BUCKET_NOT_VERSIONED'
        );
      }

      // The stack update enables versioning too, but only once the code is uploaded
      log.info('Enabling versioning on the deployment bucket');
      await sendBucketCommand(
        new PutBucketVersioningCommand({
          Bucket: this.bucketName,
          VersioningConfiguration: { Status: 'Enabled' },
        }),
        's3:PutBucketVersioning'
      );
    }

    // The policy of the bucket of the stack is a part of the template
    if (!isBucketOfUser) return;

    let policyStatements;
    try {
      const { Policy: policy } = await s3.send(
        new GetBucketPolicyCommand({ Bucket: this.bucketName })
      );
      policyStatements = [JSON.parse(policy).Statement].flat();
    } catch (error) {
      if (isS3GetBucketPolicyDeniedError(error)) return;
      if (!isS3GetBucketPolicyNotFoundError(error)) throw error;
      policyStatements = [];
    }
    const isReadableByLambda = policyStatements.some(
      (statement) =>
        statement &&
        statement.Effect === 'Allow' &&
        statement.Principal &&
        [statement.Principal.Service].flat().includes('lambda.amazonaws.com')
    );
    if (isReadableByLambda) return;

    const { accountId, partition } = await this.provider.getAccountInfo();
    throw new ServerlessError(
      [
        `The policy of the deployment bucket "${this.bucketName}" does not let AWS Lambda read the code of web apps. Add this statement to the bucket policy and deploy again:`,
        '',
        JSON.stringify(
          {
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: ['s3:GetObject', 's3:GetObjectVersion'],
            Resource: `arn:${partition}:s3:::${this.bucketName}/*`,
            Condition: {
              ArnLike: {
                'aws:SourceArn': webAppNames.map(
                  (webAppName) =>
                    `arn:${partition}:lambda:${this.provider.getRegion()}:${accountId}:web-function/${
                      this.serverless.service.getWebApp(webAppName).name
                    }/revision/*`
                ),
              },
            },
          },
          null,
          2
        ),
      ].join('\n'),
      'WEB_APP_DEPLOYMENT_BUCKET_POLICY_MISSING'
    );
  },
};
