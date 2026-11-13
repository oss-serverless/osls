'use strict';

const wait = require('../../utils/sleep');
const { writeText } = require('../../utils/serverless-utils/log');
const validate = require('./lib/validate');
const formatLambdaLogEvent = require('./utils/format-lambda-log-event');
const { parseTimeInput, subtractTime } = require('./utils/time');
const ServerlessError = require('../../serverless-error');
const {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

class AwsLogs {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('aws');

    Object.assign(this, validate);

    this.hooks = {
      'logs:logs': async () => {
        this.extendedValidate();
        const logStreamNames = await this.getLogStreams();
        await this.showLogs(logStreamNames);
      },
    };
  }

  extendedValidate() {
    this.validate();

    if ((this.options.function == null) === (this.options['web-app'] == null)) {
      throw new ServerlessError(
        'osls command "logs" requires either the "--function" or the "--web-app" option. Run "serverless logs --help" for more info',
        'MISSING_REQUIRED_CLI_OPTION'
      );
    }

    this.options.interval = this.options.interval || 1000;

    if (this.options['web-app'] != null) {
      // validate web app exists in service
      const webAppObject = this.serverless.service.getWebApp(this.options['web-app']);
      // Log lines arrive in the ".local" log group first
      this.options.logGroupName = this.provider.naming.getWebFunctionLocalLogGroupName(
        webAppObject.name
      );
      return;
    }

    // validate function exists in service
    const functionObject = this.serverless.service.getFunction(this.options.function);
    if (this.provider.isFunctionLogGroupInfrequentAccess(functionObject)) {
      throw new ServerlessError(
        `Function "${this.options.function}" logs to an Infrequent Access log group, which "serverless logs" cannot read. Use CloudWatch Logs Insights instead.`,
        'LOGS_INFREQUENT_ACCESS_UNSUPPORTED'
      );
    }

    this.options.logGroupName = this.provider.naming.getLogGroupName(functionObject.name);
  }

  async getCloudWatchLogsClient() {
    this.cloudWatchLogsClientPromise ||= this.provider
      .getAwsSdkV3Config()
      .then((config) => new CloudWatchLogsClient(config));
    return this.cloudWatchLogsClientPromise;
  }

  async getLogStreams() {
    const params = {
      logGroupName: this.options.logGroupName,
      descending: true,
      limit: 50,
      orderBy: 'LastEventTime',
    };

    const cloudWatchLogs = await this.getCloudWatchLogsClient();
    const reply = await cloudWatchLogs.send(new DescribeLogStreamsCommand(params));
    if (!reply || !reply.logStreams || reply.logStreams.length === 0) {
      throw new ServerlessError(
        this.options['web-app'] == null
          ? 'No existing streams for the function'
          : `No logs yet for web app "${this.options['web-app']}". Send it a request, then run this command again.`,
        'NO_EXISTING_LOG_STREAMS'
      );
    }

    return reply.logStreams.map((logStream) => logStream.logStreamName);
  }

  async showLogs(logStreamNames) {
    if (!logStreamNames || !logStreamNames.length) {
      if (this.options.tail) {
        await wait(this.options.interval);
        const newLogStreamNames = await this.getLogStreams();
        await this.showLogs(newLogStreamNames);
      }
    }

    const params = {
      logGroupName: this.options.logGroupName,
      interleaved: true,
      logStreamNames,
    };

    if (this.options.filter) params.filterPattern = this.options.filter;
    if (this.options.nextToken) params.nextToken = this.options.nextToken;
    if (this.options.startTime) {
      params.startTime = parseTimeInput(this.options.startTime, '--startTime');
    } else {
      params.startTime = subtractTime(new Date(), 10, this.options.tail ? 's' : 'm').getTime();
    }

    const cloudWatchLogs = await this.getCloudWatchLogsClient();
    const results = await cloudWatchLogs.send(new FilterLogEventsCommand(params));
    if (results.events) {
      results.events.forEach((e) => {
        if (e.message.includes('SERVERLESS_ENTERPRISE') || e.message.startsWith('END')) {
          return;
        }
        writeText(formatLambdaLogEvent(e.message));
      });
    }

    if (results.nextToken) {
      this.options.nextToken = results.nextToken;
    } else {
      delete this.options.nextToken;
    }

    if (this.options.tail) {
      if (results.events && results.events.length) {
        this.options.startTime = results.events.at(-1).timestamp + 1;
      }

      await wait(this.options.interval);
      const newLogStreamNames = await this.getLogStreams();
      await this.showLogs(newLogStreamNames);
    }
  }
}

module.exports = AwsLogs;
