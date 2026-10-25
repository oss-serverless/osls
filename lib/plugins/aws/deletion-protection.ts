'use strict';

const {
  CloudFormationClient,
  UpdateTerminationProtectionCommand,
} = require('@aws-sdk/client-cloudformation');
const ServerlessError = require('../../serverless-error');
const { log } = require('../../utils/serverless-utils/log');
const { getAwsErrorMessage } = require('../../aws/aws-sdk-v3-error');
const { retryOnThrottlingError } = require('../../aws/retry');

class AwsDeletionProtection {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'before:deploy:deploy': async () => this.validateConfiguration(),
      'after:deploy:deploy': async () => this.postDeploy(),
    };
  }

  resolveDeletionProtection() {
    const setting = this.serverless.service.provider.deletionProtection;
    if (setting == null) return null;
    if (typeof setting === 'boolean') return { enabled: setting };
    if (
      typeof setting === 'object' &&
      Array.isArray(setting.stages) &&
      setting.stages.length > 0 &&
      setting.stages.every((stage) => typeof stage === 'string')
    ) {
      return { enabled: setting.stages.includes(this.provider.getStage()) };
    }
    throw new ServerlessError(
      'provider.deletionProtection must be a boolean or an object with a non-empty stages list',
      'INVALID_DELETION_PROTECTION_CONFIG'
    );
  }

  validateConfiguration() {
    this.resolveDeletionProtection();
  }

  async postDeploy() {
    const config = this.resolveDeletionProtection();
    if (!config) return;

    // A change set based first deploy that ends with an empty change set does not create the
    // stack: it is left in REVIEW_IN_PROGRESS and the next deploy asks to run `remove` (see
    // `createFallback` in lib/plugins/aws/lib/update-stack.js). Protecting it would block that
    // `remove`, so leave it alone until the stack exists
    if (
      this.provider.didCreateService &&
      this.serverless.service.provider.deploymentWithEmptyChangeSet
    ) {
      log.info('Skipping deletion protection update as the stack has not been created');
      return;
    }

    const stackName = this.provider.naming.getStackName();
    const cloudFormation = await this.getCloudFormationClient();
    try {
      await retryOnThrottlingError(
        () =>
          cloudFormation.send(
            new UpdateTerminationProtectionCommand({
              StackName: stackName,
              EnableTerminationProtection: config.enabled,
            })
          ),
        { name: 'CloudFormation termination protection update' }
      );
    } catch (error) {
      throw new ServerlessError(
        `Could not ${config.enabled ? 'enable' : 'disable'} deletion protection for stack ` +
          `"${stackName}" (the stack itself was deployed): ${
            getAwsErrorMessage(error) || String(error)
          }`,
        'AWS_CLOUDFORMATION_DELETION_PROTECTION_UPDATE_FAILED',
        { cause: error }
      );
    }
    log.info(
      `${config.enabled ? 'Enabled' : 'Disabled'} deletion protection for stack "${stackName}"`
    );
  }

  async getCloudFormationClient() {
    this.cloudFormationClientPromise ||= this.provider
      .getAwsSdkV3Config()
      .then((config) => new CloudFormationClient(config));
    return this.cloudFormationClientPromise;
  }
}

module.exports = AwsDeletionProtection;
