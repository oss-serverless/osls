'use strict';

const { progress, log } = require('../../../../utils/serverless-utils/log');
const ServerlessError = require('../../../../serverless-error');
const isChangeSetWithoutChanges = require('../../utils/is-change-set-without-changes');
const {
  CloudFormationClient,
  CreateStackCommand,
  CreateChangeSetCommand,
  DeleteChangeSetCommand,
  ExecuteChangeSetCommand,
  DescribeStacksCommand,
} = require('@aws-sdk/client-cloudformation');
const { isCloudFormationMissingStackError } = require('../../../../aws/aws-sdk-v3-error');

const inactiveStateNames = new Set(['REVIEW_IN_PROGRESS']);

function getCloudFormationClient(context) {
  context.cloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.cloudFormationClientPromise;
}

module.exports = {
  async create() {
    // Note: using three dots instead of ellipsis to support non uni-code consoles.
    progress.get('main').notice('Creating CloudFormation stack', { isMainEvent: true });
    const stackName = this.provider.naming.getStackName();
    const cloudFormation = await getCloudFormationClient(this);
    let monitorCfData;

    if (this.serverless.service.provider.deploymentMethod === 'direct') {
      const params = this.getCreateStackParams({
        templateBody: this.serverless.service.provider.coreCloudFormationTemplate,
      });
      monitorCfData = await cloudFormation.send(new CreateStackCommand(params));
    } else {
      // Change-set based deployment
      const changeSetName = this.provider.naming.getStackChangeSetName();
      const createChangeSetParams = this.getCreateChangeSetParams({
        changeSetType: 'CREATE',
        templateBody: this.serverless.service.provider.coreCloudFormationTemplate,
      });

      const executeChangeSetParams = this.getExecuteChangeSetParams();

      // Create new change set
      log.info('Creating new change set');
      await cloudFormation.send(new CreateChangeSetCommand(createChangeSetParams));

      // Wait for changeset to be created
      log.info('Waiting for new change set to be created');
      const changeSetDescription = await this.waitForChangeSetCreation(changeSetName, stackName);

      // Check if stack has changes
      if (isChangeSetWithoutChanges(changeSetDescription)) {
        // Cleanup changeset when it does not include any changes
        log.info('Created change set does not include any changes, removing it');
        await cloudFormation.send(
          new DeleteChangeSetCommand({
            StackName: stackName,
            ChangeSetName: changeSetName,
          })
        );
        this.serverless.service.provider.deploymentWithEmptyChangeSet = true;
        return;
      }

      this.provider.didCreateService = true;
      log.info('Executing created change set');
      await cloudFormation.send(new ExecuteChangeSetCommand(executeChangeSetParams));
      monitorCfData = changeSetDescription;
    }
    await this.monitorStack('create', monitorCfData);
  },

  async createStack() {
    const stackName = this.provider.naming.getStackName();
    if (/^[^a-zA-Z].+|.*[^a-zA-Z0-9-].*/.test(stackName) || stackName.length > 128) {
      const errorMessage = [
        `The stack service name "${stackName}" is not valid. `,
        'A service name should only contain alphanumeric',
        ' (case sensitive) and hyphens. It should start',
        " with an alphabetic character and shouldn't",
        ' exceed 128 characters.',
      ].join('');
      throw new ServerlessError(errorMessage, 'INVALID_STACK_NAME_ERROR');
    }

    const cloudFormation = await getCloudFormationClient(this);
    try {
      const data = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
      const shouldCheckStackOutput =
        // check stack output only if acceleration is requested
        this.provider.isS3TransferAccelerationEnabled() &&
        // custom deployment bucket won't generate any output (no check)
        !this.serverless.service.provider.deploymentBucket;
      if (shouldCheckStackOutput) {
        const isAlreadyAccelerated = data.Stacks[0].Outputs.some(
          (output) => output.OutputKey === 'ServerlessDeploymentBucketAccelerated'
        );

        if (!isAlreadyAccelerated) {
          log.info('Not using S3 Transfer Acceleration (1st deploy)');
          this.provider.disableTransferAccelerationForCurrentDeploy();
        }
      }

      const stackStatus = data.Stacks[0].StackStatus;
      if (inactiveStateNames.has(stackStatus)) {
        const errorMessage = [
          'Service cannot be deployed as the CloudFormation stack ',
          `is in the '${stackStatus}' state. `,
          'This may signal either that stack is currently deployed by a different entity, ',
          'or that the previous deployment failed and was left in an abnormal state, ',
          "in which case you can mitigate the issue by running 'sls remove' command",
        ].join('');
        throw new ServerlessError(errorMessage, 'AWS_CLOUDFORMATION_INACTIVE_STACK');
      }
      return 'alreadyCreated';
    } catch (e) {
      if (isCloudFormationMissingStackError(e)) {
        if (this.serverless.service.provider.deploymentBucket) {
          this.createLater = true;
          return undefined;
        }
        return this.create();
      }
      throw e;
    }
  },
};
