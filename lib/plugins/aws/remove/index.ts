import validate from '../lib/validate.ts';
import monitorStack from '../lib/monitor-stack.ts';
import checkIfBucketExists from '../lib/check-if-bucket-exists.ts';
import emptyS3Bucket from './lib/bucket.ts';
import removeStack from './lib/stack.ts';
import removeEcrRepository from './lib/ecr.ts';
import checkIfEcrRepositoryExists from '../lib/check-if-ecr-repository-exists.ts';
import { log, style, progress } from '../../../utils/serverless-utils/log.ts';

const mainProgress = progress.get('main');

class AwsRemove {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('aws');

    Object.assign(
      this,
      validate,
      emptyS3Bucket,
      removeStack,
      monitorStack,
      removeEcrRepository,
      checkIfEcrRepositoryExists,
      checkIfBucketExists
    );

    this.hooks = {
      'initialize': async () => {
        if (this.serverless.processedInput.commands.join(' ') === 'remove') {
          log.notice(
            `Removing ${this.serverless.service.service} from stage ${this.serverless
              .getProvider('aws')
              .getStage()} ${style.aside(`(${this.serverless.getProvider('aws').getRegion()})`)}`
          );
          log.info(); // Ensure gap between verbose logging

          // Core no longer reads `provider.accountId`, but it is resolved here
          // as some plugins may rely on it being available during `remove`
          this.provider.getAccountId().then(
            (accountId) => (this.provider.accountId = accountId),
            () => {
              /* pass on all errors */
            }
          );
        }
      },
      'remove:remove': async () => {
        await this.validate();
        const doesEcrRepositoryExistPromise = this.checkIfEcrRepositoryExists();
        // The probe is only awaited once the stack is gone; do not let a failure of the steps
        // in between (e.g. the deletion protection guard) turn its rejection into an unhandled one
        doesEcrRepositoryExistPromise.catch(() => {});
        await this.ensureStackIsNotDeletionProtected();
        mainProgress.notice('Removing objects from S3 bucket', { isMainEvent: true });
        await this.emptyS3Bucket();
        mainProgress.notice('Removing CloudFormation stack', { isMainEvent: true });
        const cfData = await this.removeStack();
        await this.monitorStack('delete', cfData);
        if (await doesEcrRepositoryExistPromise) {
          mainProgress.notice('Removing ECR repository', { isMainEvent: true });
          await this.removeEcrRepository();
        }
      },
      'finalize': async () => {
        if (this.serverless.processedInput.commands.join(' ') !== 'remove') return;
        log.notice();
        log.notice.success(
          `Service ${this.serverless.service.service} has been successfully removed ${style.aside(
            `(${Math.floor(
              (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
            )}s)`
          )}`
        );
        if (this.serverless.service.provider.deploymentMode === 'express') {
          log.notice(
            style.aside(
              'Removed with CloudFormation express mode. Resources may still be deleting in the background.'
            )
          );
        }
      },
    };
  }
}

export default AwsRemove;
