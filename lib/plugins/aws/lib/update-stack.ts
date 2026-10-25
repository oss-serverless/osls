'use strict';

const getS3EndpointForRegion = require('../utils/get-s3-endpoint-for-region');
const { log, progress } = require('../../../utils/serverless-utils/log');
const isChangeSetWithoutChanges = require('../utils/is-change-set-without-changes');
const {
  CloudFormationClient,
  CreateStackCommand,
  CreateChangeSetCommand,
  DeleteChangeSetCommand,
  ExecuteChangeSetCommand,
  UpdateStackCommand,
  SetStackPolicyCommand,
} = require('@aws-sdk/client-cloudformation');
const { isCloudFormationNoUpdateError } = require('../../../aws/aws-sdk-v3-error');
const { retryOnThrottlingError } = require('../../../aws/retry');

function getCloudFormationClient(context) {
  context.cloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.cloudFormationClientPromise;
}

module.exports = {
  async createFallback() {
    this.createLater = false;
    progress.get('main').notice('Creating CloudFormation stack', { isMainEvent: true });

    const stackName = this.provider.naming.getStackName();
    const compiledTemplateFileName = this.provider.naming.getCompiledTemplateS3Suffix();
    const s3Endpoint = getS3EndpointForRegion(this.provider.getRegion());
    const templateUrl = `https://${s3Endpoint}/${this.bucketName}/${this.serverless.service.package.artifactDirectoryName}/${compiledTemplateFileName}`;
    const cloudFormation = await getCloudFormationClient(this);

    let monitorCfData;
    if (this.serverless.service.provider.deploymentMethod === 'direct') {
      const params = this.getCreateStackParams({
        templateUrl,
      });

      monitorCfData = await cloudFormation.send(new CreateStackCommand(params));
    } else {
      const changeSetName = this.provider.naming.getStackChangeSetName();

      const createChangeSetParams = this.getCreateChangeSetParams({
        changeSetType: 'CREATE',
        templateUrl,
      });

      const executeChangeSetParams = this.getExecuteChangeSetParams();

      // Create new change set
      this.provider.didCreateService = true;
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
        return false;
      }

      log.info('Executing created change set');
      await cloudFormation.send(new ExecuteChangeSetCommand(executeChangeSetParams));
      monitorCfData = changeSetDescription;
    }
    await this.monitorStack('create', monitorCfData);
    return true;
  },

  async update() {
    const compiledTemplateFileName = this.provider.naming.getCompiledTemplateS3Suffix();
    const s3Endpoint = getS3EndpointForRegion(this.provider.getRegion());
    const templateUrl = `https://${s3Endpoint}/${this.bucketName}/${this.serverless.service.package.artifactDirectoryName}/${compiledTemplateFileName}`;

    const stackName = this.provider.naming.getStackName();
    const cloudFormation = await getCloudFormationClient(this);

    let monitorCfData;
    if (this.serverless.service.provider.deploymentMethod === 'direct') {
      const params = this.getUpdateStackParams({ templateUrl });

      try {
        monitorCfData = await cloudFormation.send(new UpdateStackCommand(params));
      } catch (e) {
        if (isCloudFormationNoUpdateError(e)) {
          return false;
        }
        throw e;
      }
    } else {
      const changeSetName = this.provider.naming.getStackChangeSetName();

      const createChangeSetParams = this.getCreateChangeSetParams({
        changeSetType: 'UPDATE',
        templateUrl,
      });

      const executeChangeSetParams = this.getExecuteChangeSetParams();

      // Ensure that previous change set has been removed
      await cloudFormation.send(
        new DeleteChangeSetCommand({
          StackName: stackName,
          ChangeSetName: changeSetName,
        })
      );

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
        return false;
      }

      log.info('Executing created change set');
      await cloudFormation.send(new ExecuteChangeSetCommand(executeChangeSetParams));
      monitorCfData = changeSetDescription;
    }

    await this.monitorStack('update', monitorCfData);

    // Policy must have at least one statement, otherwise no updates would be possible at all
    // Stack policy must be set after change set has been executed,
    // as it might reference resources newly added in that change set.
    // Applied only for ChangeSet deployments which is a default method
    if (
      (!this.serverless.service.provider.deploymentMethod ||
        this.serverless.service.provider.deploymentMethod === 'changesets') &&
      this.serverless.service.provider.stackPolicy &&
      Object.keys(this.serverless.service.provider.stackPolicy).length
    ) {
      log.info('Setting stack policy');
      const stackPolicyBody = JSON.stringify({
        Statement: this.serverless.service.provider.stackPolicy,
      });
      await retryOnThrottlingError(
        () =>
          cloudFormation.send(
            new SetStackPolicyCommand({
              StackName: stackName,
              StackPolicyBody: stackPolicyBody,
            })
          ),
        { name: 'CloudFormation stack policy update' }
      );
    }

    return true;
  },

  async updateStack() {
    if (this.createLater) {
      return this.createFallback();
    }
    return this.update();
  },
};
