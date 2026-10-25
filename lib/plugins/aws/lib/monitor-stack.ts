'use strict';

const wait = require('../../../utils/sleep');
const ServerlessError = require('../../../serverless-error');
const { log, style, progress } = require('../../../utils/serverless-utils/log');
const getMonitoringFrequency = require('../utils/get-monitoring-frequency');
const {
  CloudFormationClient,
  DescribeStackEventsCommand,
} = require('@aws-sdk/client-cloudformation');
const { isCloudFormationMissingStackError } = require('../../../aws/aws-sdk-v3-error');
const { retryOnThrottlingError } = require('../../../aws/retry');

const mainProgress = progress.get('main');
const validStatuses = new Set(['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'DELETE_COMPLETE']);

const normalizerPattern = /(?<!^)([A-Z])/g;
const resourceTypePattern = /^(?<domain>[^:]+)::(?<service>[^:]+)(?:::(?<method>.+))?$/;
const resourceTypeToErrorCodePostfix = (resourceType) => {
  const { domain, service, method } = resourceType.match(resourceTypePattern).groups;
  if (domain !== 'AWS') return `_${domain.replace(normalizerPattern, '_$1').toUpperCase()}`;
  return `_${service.replace(normalizerPattern, '_$1')}_${method.replace(
    normalizerPattern,
    '_$1'
  )}`.toUpperCase();
};

function getCloudFormationClient(context) {
  context.cloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.cloudFormationClientPromise;
}

module.exports = {
  async checkStackProgress(action, cfData, stackUrl, options, state = {}) {
    let {
      loggedEventIds = new Set(),
      stackStatus = null,
      stackLatestError = null,
      firstEventId = null,
      completedResources = new Set(),
    } = state;
    const cloudFormation = await getCloudFormationClient(this);
    await wait(getMonitoringFrequency(options.frequency));

    try {
      // CloudFormation returns events newest-first; page through them until the
      // current operation's boundary (the root stack *_IN_PROGRESS event, or the
      // firstEventId locked on an earlier poll) so later-page events are included.
      const stackEvents = [];
      let nextToken;
      let boundaryReached = false;
      do {
        const input = { StackName: cfData.StackId };
        if (nextToken) input.NextToken = nextToken;
        const result = await retryOnThrottlingError(
          () => cloudFormation.send(new DescribeStackEventsCommand(input)),
          { name: 'CloudFormation stack polling' }
        );
        for (const event of result.StackEvents || []) {
          stackEvents.push(event);
          if (firstEventId) {
            if (event.EventId === firstEventId) {
              boundaryReached = true;
              break;
            }
          } else if (
            event.ResourceType === 'AWS::CloudFormation::Stack' &&
            event.ResourceStatus === `${action.toUpperCase()}_IN_PROGRESS`
          ) {
            firstEventId = event.EventId;
            boundaryReached = true;
            break;
          }
        }
        nextToken = boundaryReached ? undefined : result.NextToken;
      } while (nextToken);

      if (stackEvents.length) {
        stackEvents.reverse();

        // Loop through stack events
        stackEvents.forEach((event) => {
          if (loggedEventIds.has(event.EventId)) return;
          const eventStatus = event.ResourceStatus || null;
          const isRootStackEvent =
            event.ResourceType === 'AWS::CloudFormation::Stack' &&
            event.StackName === event.LogicalResourceId;
          // Keep track of stack status
          if (isRootStackEvent) {
            stackStatus = eventStatus;
          }
          // Keep track of first failed event
          if (
            eventStatus &&
            (eventStatus.endsWith('FAILED') ||
              eventStatus === 'UPDATE_ROLLBACK_IN_PROGRESS' ||
              // During non-delete monitoring, root stack deletion indicates deployment failure.
              (action !== 'delete' && eventStatus === 'DELETE_IN_PROGRESS' && isRootStackEvent)) &&
            stackLatestError === null
          ) {
            stackLatestError = event;
          }
          // Log stack events
          log.info(
            style.aside(`  ${eventStatus} - ${event.ResourceType} - ${event.LogicalResourceId}`)
          );

          if (
            event.ResourceType !== 'AWS::CloudFormation::Stack' &&
            eventStatus &&
            eventStatus.endsWith('COMPLETE')
          ) {
            completedResources.add(event.LogicalResourceId);
          }

          if (action !== 'delete' && cfData.Changes) {
            const progressMessagePrefix = (() => {
              if (action === 'create') return 'Creating';
              if (action === 'update') return 'Updating';
              throw new Error(`Unrecognized action: ${action}`);
            })();
            mainProgress.notice(
              `${progressMessagePrefix} CloudFormation stack (${completedResources.size}/${cfData.Changes.length})`
            );
          }

          // Prepare for next monitoring action
          loggedEventIds.add(event.EventId);
        });
        // Handle stack create/update/delete failures
        if (
          stackLatestError &&
          (!this.options.verbose ||
            (stackStatus &&
              (stackStatus.endsWith('FAILED') ||
                stackStatus.endsWith('ROLLBACK_COMPLETE') ||
                stackStatus === 'DELETE_COMPLETE')))
        ) {
          const decoratedErrorMessage = `${stackLatestError.ResourceStatus}: ${
            stackLatestError.LogicalResourceId
          } ${style.aside(`(${stackLatestError.ResourceType})`)}\n${
            stackLatestError.ResourceStatusReason
          }\n\n${style.aside(`View the full error: ${style.link(stackUrl)}`)}`;

          let errorMessage = 'An error occurred: ';
          errorMessage += `${stackLatestError.LogicalResourceId} - `;
          errorMessage += `${
            stackLatestError.ResourceStatusReason || stackLatestError.ResourceStatus
          }.`;
          const errorCode = (() => {
            if (stackLatestError.ResourceStatusReason) {
              if (
                stackLatestError.ResourceStatusReason.startsWith('Properties validation failed')
              ) {
                return `AWS_CLOUD_FORMATION_${action.toUpperCase()}_STACK_INTERNAL_VALIDATION_ERROR`;
              }
              if (stackLatestError.ResourceStatusReason.includes('is not authorized to perform')) {
                return `AWS_CLOUD_FORMATION_${action.toUpperCase()}_STACK_INTERNAL_INSUFFICIENT_PERMISSIONS`;
              }
            }
            return (
              `AWS_CLOUD_FORMATION_${action.toUpperCase()}_STACK_INTERNAL` +
              `${resourceTypeToErrorCodePostfix(stackLatestError.ResourceType)}_${
                stackLatestError.ResourceStatus
              }`
            );
          })();
          throw new ServerlessError(errorMessage, errorCode, {
            decoratedMessage: decoratedErrorMessage,
          });
        }
      }
    } catch (e) {
      if (action === 'delete' && isCloudFormationMissingStackError(e)) {
        stackStatus = 'DELETE_COMPLETE';
      } else {
        throw e;
      }
    }

    if (validStatuses.has(stackStatus)) return stackStatus;
    return this.checkStackProgress(action, cfData, stackUrl, options, {
      loggedEventIds,
      stackStatus,
      stackLatestError,
      firstEventId,
      completedResources,
    });
  },
  async monitorStack(action, cfData, options = {}) {
    // Skip monitoring if stack was already created
    if (cfData === 'alreadyCreated') return undefined;

    const region = this.provider.getRegion();
    const baseCfUrl = `https://${region}.console.aws.amazon.com/cloudformation/home`;
    const encodedStackId = `${encodeURIComponent(cfData.StackId)}`;
    const cfQueryString = `region=${region}#/stack/detail?stackId=${encodedStackId}`;
    const stackUrl = `${baseCfUrl}?${cfQueryString}`;

    // Monitor stack creation/update/removal

    return this.checkStackProgress(action, cfData, stackUrl, options);
  },
};
