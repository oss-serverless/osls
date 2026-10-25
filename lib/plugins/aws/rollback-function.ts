'use strict';

const {
  LambdaClient,
  GetFunctionCommand,
  UpdateFunctionCodeCommand,
} = require('@aws-sdk/client-lambda');
const ServerlessError = require('../../serverless-error');
const validate = require('./lib/validate');
const buildFetchDispatcher = require('../../utils/build-fetch-dispatcher');
const { style, log, progress } = require('../../utils/serverless-utils/log');
const {
  getAwsErrorCode,
  getAwsErrorMessage,
  getAwsErrorStatusCode,
  isAwsCredentialError,
  isLambdaResourceNotFoundError,
} = require('../../aws/aws-sdk-v3-error');

const mainProgress = progress.get('main');

class AwsRollbackFunction {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('aws');

    Object.assign(this, validate);

    this.hooks = {
      'rollback:function:rollback': async () => {
        await this.validate();
        await this.rejectDurableFunctionRollback();
        const func = await this.getFunctionToBeRestored();
        const zipBuffer = await this.fetchFunctionCode(func);
        return this.restoreFunction(zipBuffer);
      },
    };
  }

  async getLambdaClient() {
    this.lambdaClientPromise ||= this.provider
      .getAwsSdkV3Config()
      .then((config) => new LambdaClient(config));
    return this.lambdaClientPromise;
  }

  async getFunctionToBeRestored() {
    const funcName = this.options.function;

    // versions need to be string so that AWS understands it
    const funcVersion = String(this.options['function-version']);

    log.notice();
    log.notice(`Rolling back function ${funcName} to version "${funcVersion}"`);
    log.info(); // Ensure gap between verbose logging

    mainProgress.notice('Updating', { isMainEvent: true });

    const funcObj = this.serverless.service.getFunction(funcName);

    const params = {
      FunctionName: funcObj.name,
      Qualifier: funcVersion,
    };

    try {
      const lambda = await this.getLambdaClient();
      return await lambda.send(new GetFunctionCommand(params));
    } catch (error) {
      if (isLambdaResourceNotFoundError(error)) {
        const errorMessage = [
          `Function "${funcName}" with version "${funcVersion}" not found.`,
          ` Please check if you've deployed "${funcName}"`,
          ` and version "${funcVersion}" is available for this function.`,
          ' Please check the docs for more info.',
        ].join('');
        throw new ServerlessError(errorMessage, 'AWS_FUNCTION_NOT_FOUND');
      }
      if (isAwsCredentialError(error)) {
        throw error;
      }
      const errorDetail =
        getAwsErrorMessage(error) ||
        String(getAwsErrorCode(error) || getAwsErrorStatusCode(error) || 'Error');
      throw new ServerlessError(
        `Cannot resolve function "${funcName}": ${errorDetail}`,
        'AWS_FUNCTION_NOT_ACCESSIBLE'
      );
    }
  }

  throwDurableFunctionRollbackError(funcName) {
    throw new ServerlessError(
      `Function "${funcName}" is configured with durableConfig locally or in AWS. Use "serverless deploy" to publish and retarget durable function versions instead of rolling back only $LATEST.`,
      'DURABLE_ROLLBACK_FUNCTION_UNSUPPORTED'
    );
  }

  async rejectDurableFunctionRollback() {
    const funcName = this.options.function;
    const funcObj = this.serverless.service.getFunction(funcName);

    if (funcObj.durableConfig) {
      this.throwDurableFunctionRollbackError(funcName);
    }

    let currentFunction;
    try {
      const lambda = await this.getLambdaClient();
      currentFunction = await lambda.send(new GetFunctionCommand({ FunctionName: funcObj.name }));
    } catch (error) {
      // Missing functions fall through to getFunctionToBeRestored's version-aware error.
      if (isLambdaResourceNotFoundError(error)) {
        return;
      }
      if (isAwsCredentialError(error)) {
        throw error;
      }
      const errorDetail =
        getAwsErrorMessage(error) ||
        String(getAwsErrorCode(error) || getAwsErrorStatusCode(error) || 'Error');
      throw new ServerlessError(
        `Cannot resolve function "${funcName}": ${errorDetail}`,
        'AWS_FUNCTION_NOT_ACCESSIBLE'
      );
    }

    if (currentFunction.Configuration && currentFunction.Configuration.DurableConfig) {
      this.throwDurableFunctionRollbackError(funcName);
    }
  }

  async fetchFunctionCode(func) {
    const codeUrl = func.Code.Location;

    const response = await fetch(codeUrl, { dispatcher: buildFetchDispatcher() });
    if (!response.ok) {
      // Without this check an expired presigned URL's XML error document would be
      // uploaded as the function code
      throw new ServerlessError(
        `Could not download function code (HTTP ${response.status})`,
        'LAMBDA_CODE_DOWNLOAD_FAILED'
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async restoreFunction(zipBuffer) {
    const funcName = this.options.function;

    const funcObj = this.serverless.service.getFunction(funcName);
    if (funcObj.durableConfig) {
      this.throwDurableFunctionRollbackError(funcName);
    }

    const params = {
      FunctionName: funcObj.name,
      ZipFile: zipBuffer,
    };

    const lambda = await this.getLambdaClient();
    await lambda.send(new UpdateFunctionCodeCommand(params));
    log.notice();
    log.notice.success(
      `Successfully rolled back function ${funcName} to version "${
        this.options['function-version']
      }" ${style.aside(
        `(${Math.floor((Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000)}s)`
      )}`
    );
  }
}

module.exports = AwsRollbackFunction;
