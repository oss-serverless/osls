import wait from '../../../utils/sleep.ts';
import ServerlessError from '../../../serverless-error.ts';
import isChangeSetWithoutChanges from '../utils/is-change-set-without-changes.ts';
import { log } from '../../../utils/serverless-utils/log.ts';
import getMonitoringFrequency from '../utils/get-monitoring-frequency.ts';
import { CloudFormationClient, DescribeChangeSetCommand } from '@aws-sdk/client-cloudformation';
import retry from '../../../aws/retry.ts';
const { retryOnThrottlingError } = retry;

function getCloudFormationClient(context) {
  context.cloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.cloudFormationClientPromise;
}

export default {
  async waitForChangeSetCreation(changeSetName, stackName) {
    const params = {
      ChangeSetName: changeSetName,
      StackName: stackName,
    };
    const cloudFormation = await getCloudFormationClient(this);

    const callWithRetry = async () => {
      const changeSetDescription = await retryOnThrottlingError(
        () => cloudFormation.send(new DescribeChangeSetCommand(params)),
        { name: 'CloudFormation change set polling' }
      );
      if (
        changeSetDescription.Status === 'CREATE_COMPLETE' ||
        isChangeSetWithoutChanges(changeSetDescription)
      ) {
        return changeSetDescription;
      }

      if (
        changeSetDescription.Status === 'CREATE_PENDING' ||
        changeSetDescription.Status === 'CREATE_IN_PROGRESS'
      ) {
        log.info('Change Set did not reach desired state, retrying');
        await wait(getMonitoringFrequency());
        return await callWithRetry();
      }

      throw new ServerlessError(
        `Could not create Change Set "${changeSetDescription.ChangeSetName}" due to: ${changeSetDescription.StatusReason}`,
        'AWS_CLOUD_FORMATION_CHANGE_SET_CREATION_FAILED'
      );
    };

    return await callWithRetry();
  },
};
