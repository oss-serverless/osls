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

    // validate function exists in service
    const lambdaName = this.serverless.service.getFunction(this.options.function).name;

    this.options.interval = this.options.interval || 1000;
    this.options.logGroupName = this.provider.naming.getLogGroupName(lambdaName);
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
      throw new ServerlessError('No existing streams for the function', 'NO_EXISTING_LOG_STREAMS');
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
