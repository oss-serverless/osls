'use strict';

const wait = require('../../../utils/sleep');
const ServerlessError = require('../../../serverless-error');
const isChangeSetWithoutChanges = require('../utils/is-change-set-without-changes');
const { log } = require('../../../utils/serverless-utils/log');
const getMonitoringFrequency = require('../utils/get-monitoring-frequency');
const {
  CloudFormationClient,
  DescribeChangeSetCommand,
} = require('@aws-sdk/client-cloudformation');
const { retryOnThrottlingError } = require('../../../aws/retry');

function getCloudFormationClient(context) {
  context.cloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.cloudFormationClientPromise;
}

module.exports = {
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
