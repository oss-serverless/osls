import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import ServerlessError from '../../../../serverless-error.ts';
import { log } from '../../../../utils/serverless-utils/log.ts';
import {
  getAwsErrorMessage,
  isCloudFormationMissingStackError,
} from '../../../../aws/aws-sdk-v3-error.ts';

function getCloudFormationClient(context) {
  context.cloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.cloudFormationClientPromise;
}

export default {
  async ensureStackIsNotDeletionProtected() {
    const stackName = this.provider.naming.getStackName();
    const cloudFormation = await getCloudFormationClient(this);
    let stack;

    try {
      const result = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
      stack = result.Stacks && result.Stacks[0];
    } catch (error) {
      if (isCloudFormationMissingStackError(error)) return;
      // Removal must not depend on cloudformation:DescribeStacks being granted: fall back to
      // the previous behaviour, where CloudFormation itself rejects deleting a protected stack
      log.warning(
        `Could not check whether stack "${stackName}" has deletion protection enabled ` +
          `(${getAwsErrorMessage(error) || String(error)}). Continuing with removal.`
      );
      return;
    }

    if (!stack || !stack.EnableTerminationProtection) return;

    throw new ServerlessError(
      `Cannot remove stack "${stackName}" because deletion protection is enabled. ` +
        'Set provider.deletionProtection to false (or remove this stage from ' +
        'provider.deletionProtection.stages) and deploy the service before removing it. ' +
        'To turn it off without deploying, run: aws cloudformation ' +
        `update-termination-protection --no-enable-termination-protection --stack-name ${stackName}`,
      'AWS_CLOUDFORMATION_DELETION_PROTECTION_ENABLED'
    );
  },

  async remove() {
    const stackName = this.provider.naming.getStackName();
    const params = {
      StackName: stackName,
    };

    const customDeploymentRole = this.provider.getCustomDeploymentRole();
    if (customDeploymentRole) {
      params.RoleARN = customDeploymentRole;
    }

    if (this.serverless.service.provider.deploymentMode === 'express') {
      params.DeploymentConfig = { Mode: 'EXPRESS' };
    }

    const cfData = {
      StackId: stackName,
    };

    const cloudFormation = await getCloudFormationClient(this);
    await cloudFormation.send(new DeleteStackCommand(params));
    return cfData;
  },

  async removeStack() {
    return this.remove();
  },
};
