import ServerlessError from '../../../serverless-error.ts';
import writeServiceOutputs from '../../../cli/write-service-outputs.ts';
import extendedValidate from './lib/extended-validate.ts';
import setBucketName from '../lib/set-bucket-name.ts';
import checkForChanges from './lib/check-for-changes.ts';
import monitorStack from '../lib/monitor-stack.ts';
import checkIfBucketExists from '../lib/check-if-bucket-exists.ts';
import getCreateChangeSetParams from '../lib/get-create-change-set-params.ts';
import getSharedStackActionParams from '../lib/get-shared-stack-action-params.ts';
import getCreateStackParams from '../lib/get-create-stack-params.ts';
import getUpdateStackParams from '../lib/get-update-stack-params.ts';
import getExecuteChangeSetParams from '../lib/get-execute-change-set-params.ts';
import waitForChangeSetCreation from '../lib/wait-for-change-set-creation.ts';
import uploadZipFile from '../lib/upload-zip-file.ts';
import createStack from './lib/create-stack.ts';
import cleanupS3Bucket from './lib/cleanup-s3-bucket.ts';
import uploadArtifacts from './lib/upload-artifacts.ts';
import validateTemplate from './lib/validate-template.ts';
import updateStack from '../lib/update-stack.ts';
import ensureValidBucketExists from './lib/ensure-valid-bucket-exists.ts';
import path from 'node:path';
import { style, log, progress, writeText } from '../../../utils/serverless-utils/log.ts';
import memoize from 'memoizee';

const mainProgress = progress.get('main');

class AwsDeploy {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');
    this.servicePath = this.serverless.serviceDir || '';
    this.packagePath =
      this.options.package ||
      this.serverless.service.package.path ||
      path.join(this.servicePath, '.serverless');

    Object.assign(
      this,
      extendedValidate,
      createStack,
      setBucketName,
      checkForChanges,
      cleanupS3Bucket,
      ensureValidBucketExists,
      uploadArtifacts,
      validateTemplate,
      updateStack,
      monitorStack,
      checkIfBucketExists,
      waitForChangeSetCreation,
      uploadZipFile,
      getCreateChangeSetParams,
      getCreateStackParams,
      getExecuteChangeSetParams,
      getUpdateStackParams,
      getSharedStackActionParams
    );

    this.getFileStats = memoize(this.getFileStats.bind(this), { promise: true });

    // Define the internal lifecycle model
    this.commands = {
      aws: {
        type: 'entrypoint',
        commands: {
          deploy: {
            commands: {
              deploy: {
                lifecycleEvents: [
                  'createStack',
                  'checkForChanges',
                  'uploadArtifacts',
                  'validateTemplate',
                  'updateStack',
                ],
              },
              finalize: {
                lifecycleEvents: ['cleanup'],
              },
            },
          },
        },
      },
    };

    this.hooks = {
      'initialize': () => {
        const isDeployCommand = this.serverless.processedInput.commands.join(' ') === 'deploy';
        if (isDeployCommand && !this.options.function) {
          log.notice();
          log.notice(
            `Deploying ${this.serverless.service.service} to stage ${this.serverless
              .getProvider('aws')
              .getStage()} ${style.aside(`(${this.serverless.getProvider('aws').getRegion()})`)}`
          );
          log.info(); // Ensure gap between verbose logging

          // Core no longer reads `provider.accountId`, but it is resolved here
          // as some plugins may rely on it being available during `deploy`
          this.provider.getAccountId().then(
            (accountId) => (this.provider.accountId = accountId),
            () => {
              /* pass on all errors */
            }
          );
        }
      },

      'before:deploy:deploy': async () => {
        await this.serverless.pluginManager.spawn('aws:common:validate');

        if (!this.options.package && !this.serverless.service.package.path) {
          return this.extendedValidate();
        }
        await this.serverless.pluginManager.spawn('aws:common:moveArtifactsToTemp');
        return this.extendedValidate();
      },

      // Deploy outer lifecycle
      'deploy:deploy': async () => this.serverless.pluginManager.spawn('aws:deploy:deploy'),

      'deploy:finalize': async () => this.serverless.pluginManager.spawn('aws:deploy:finalize'),

      // Deploy deploy inner lifecycle
      'before:aws:deploy:deploy:createStack': () =>
        mainProgress.notice('Retrieving CloudFormation stack', { isMainEvent: true }),
      'aws:deploy:deploy:createStack': async () => this.createStack(),

      'aws:deploy:deploy:checkForChanges': async () => {
        await this.ensureValidBucketExists();
        await this.checkForChanges();
        if (this.serverless.service.provider.shouldNotDeploy) return;

        if (this.state.console) {
          throw new ServerlessError(
            'Cannot deploy service: Service was packaged with old ' +
              'Serverless Console integration, which is no longer supported',
            'CONSOLE_ACTIVATION_MISMATCH'
          );
        }
      },

      'before:aws:deploy:deploy:uploadArtifacts': () => {
        if (this.serverless.service.provider.shouldNotDeploy) return;
        mainProgress.notice('Uploading', { isMainEvent: true });
      },
      'aws:deploy:deploy:uploadArtifacts': async () => {
        if (this.serverless.service.provider.shouldNotDeploy) return;
        await this.uploadArtifacts();
      },

      'aws:deploy:deploy:validateTemplate': async () => {
        if (this.serverless.service.provider.shouldNotDeploy) return;
        await this.validateTemplate();
      },

      'before:aws:deploy:deploy:updateStack': () => {
        if (this.serverless.service.provider.shouldNotDeploy) return;
        mainProgress.notice('Updating CloudFormation stack', { isMainEvent: true });
      },
      'aws:deploy:deploy:updateStack': async () => {
        if (this.serverless.service.provider.shouldNotDeploy) return;
        await this.updateStack();
      },

      'after:deploy:deploy': () => mainProgress.notice('Updating'),

      // Deploy finalize inner lifecycle
      'aws:deploy:finalize:cleanup': async () => {
        if (this.serverless.service.provider.shouldNotDeploy) return;
        await this.cleanupS3Bucket();
        if (this.options.package || this.serverless.service.package.path) {
          await this.serverless.pluginManager.spawn('aws:common:cleanupTempDir');
        }
      },

      'error': async () => {
        if (this.serverless.processedInput.commands.join(' ') !== 'deploy') return;
        log.error(); // In order to ensure extra new line before the error message
        log.error(
          `Stack ${serverless
            .getProvider('aws')
            .naming.getStackName()} failed to deploy ${style.aside(
            `(${Math.floor(
              (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
            )}s)`
          )}`
        );
      },

      'finalize': async () => {
        if (this.serverless.processedInput.commands.join(' ') !== 'deploy') return;
        if (this.serverless.service.provider.shouldNotDeploy) {
          log.notice();
          log.notice.skip(
            `No changes to deploy. Deployment skipped. ${style.aside(
              `(${Math.floor(
                (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
              )}s)`
            )}`
          );
          return;
        }

        if (this.serverless.service.provider.deploymentWithEmptyChangeSet) {
          log.notice();
          log.notice.skip(
            `Change set did not include any changes to be deployed. ${style.aside(
              `(${Math.floor(
                (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
              )}s)`
            )}`
          );
          return;
        }

        log.notice();
        log.notice.success(
          `Service deployed to stack ${this.serverless
            .getProvider('aws')
            .naming.getStackName()} ${style.aside(
            `(${Math.floor(
              (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
            )}s)`
          )}`
        );
        if (this.serverless.service.provider.deploymentMode === 'express') {
          log.notice(
            style.aside(
              'Deployed with CloudFormation express mode. Resources may still be stabilizing in the background.'
            )
          );
        }
        writeText();
        writeServiceOutputs(this.serverless.serviceOutputs);
        writeServiceOutputs(this.serverless.servicePluginOutputs);
      },
    };
  }
}

export default AwsDeploy;
