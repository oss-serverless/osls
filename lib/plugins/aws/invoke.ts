'use strict';

const path = require('path');
const validate = require('./lib/validate');
const stdin = require('../../utils/get-stdin');
const formatLambdaLogEvent = require('./utils/format-lambda-log-event');
const ServerlessError = require('../../serverless-error');
const { writeText, style } = require('../../utils/serverless-utils/log');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

class AwsInvoke {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('aws');

    Object.assign(this, validate);

    this.hooks = {
      'invoke:invoke': async () => {
        await this.extendedValidate();
        this.log(await this.invoke());
      },
    };
  }

  async validateFile(key) {
    const absolutePath = path.resolve(this.serverless.serviceDir, this.options[key]);
    try {
      return await this.serverless.utils.readFile(absolutePath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new ServerlessError('The file you provided does not exist.', 'FILE_NOT_FOUND');
      }
      throw err;
    }
  }

  async extendedValidate() {
    this.validate();
    // validate function exists in service
    this.options.functionObj = this.serverless.service.getFunction(this.options.function);
    const durableExecutionName = this.options['durable-execution-name'];

    if (
      durableExecutionName !== undefined &&
      (typeof durableExecutionName !== 'string' ||
        !/^[A-Za-z0-9-_]{1,64}$/.test(durableExecutionName))
    ) {
      throw new ServerlessError(
        'Durable execution names must be 1-64 characters and can contain only alphanumeric characters, hyphens, and underscores.',
        'INVALID_DURABLE_EXECUTION_NAME'
      );
    }

    if (
      (durableExecutionName || this.options.functionObj.durableConfig) &&
      !this.options.qualifier
    ) {
      throw new ServerlessError(
        'Durable function invocations must include "--qualifier" with a version, alias, or "$LATEST".',
        'DURABLE_INVOKE_REQUIRES_QUALIFIER'
      );
    }

    this.options.data = this.options.data || '';

    if (!this.options.data) {
      if (this.options.path) {
        this.options.data = await this.validateFile('path');
      } else {
        try {
          this.options.data = await stdin();
        } catch {
          // continue if no stdin was provided
        }
      }
    }

    if (!this.options.context && this.options.contextPath) {
      this.options.context = await this.validateFile('contextPath');
    }

    try {
      if (!this.options.raw) {
        this.options.data = JSON.parse(this.options.data);
      }
    } catch {
      // do nothing if it's a simple string or object already
    }

    try {
      if (!this.options.raw && this.options.context) {
        this.options.context = JSON.parse(this.options.context);
      }
    } catch {
      // do nothing if it's a simple string or object already
    }
  }

  async getLambdaClient() {
    this.lambdaClientPromise ||= this.provider
      .getAwsSdkV3Config()
      .then((config) => new LambdaClient(config));
    return this.lambdaClientPromise;
  }

  async invoke() {
    const invocationType = this.options.type || 'RequestResponse';
    if (invocationType !== 'RequestResponse') {
      this.options.log = 'None';
    } else {
      this.options.log = this.options.log ? 'Tail' : 'None';
    }

    const params = {
      FunctionName: this.options.functionObj.name,
      InvocationType: invocationType,
      LogType: this.options.log,
      Payload: Buffer.from(JSON.stringify(this.options.data || {})),
    };

    if (this.options.context) {
      params.ClientContext = Buffer.from(JSON.stringify(this.options.context)).toString('base64');
    }

    if (this.options.qualifier) {
      params.Qualifier = this.options.qualifier;
    }

    if (this.options['durable-execution-name']) {
      params.DurableExecutionName = this.options['durable-execution-name'];
    }

    const lambda = await this.getLambdaClient();
    return lambda.send(new InvokeCommand(params));
  }

  payloadToString(payload) {
    if (payload instanceof Uint8Array) {
      return new TextDecoder().decode(payload);
    }

    if (Buffer.isBuffer(payload)) {
      return payload.toString();
    }

    return payload;
  }

  log(invocationReply) {
    if (invocationReply.Payload) {
      const payload = this.payloadToString(invocationReply.Payload);
      if (payload) {
        const response = JSON.parse(payload);

        writeText(JSON.stringify(response, null, 4));
      }
    }

    if (invocationReply.LogResult) {
      writeText(
        style.aside('--------------------------------------------------------------------')
      );
      const logResult = Buffer.from(invocationReply.LogResult, 'base64').toString();
      logResult.split('\n').forEach((line) => {
        if (line.includes('SERVERLESS_ENTERPRISE') || line.startsWith('END')) {
          return;
        }
        writeText(formatLambdaLogEvent(line));
      });
    }

    if (invocationReply.DurableExecutionArn) {
      writeText(`DurableExecutionArn: ${invocationReply.DurableExecutionArn}`);
    }

    if (invocationReply.FunctionError) {
      throw new ServerlessError('Invoked function failed', 'AWS_LAMBDA_INVOCATION_FAILED');
    }
  }
}

module.exports = AwsInvoke;
