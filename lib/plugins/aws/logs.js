'use strict';

const wait = require('../../utils/sleep');
const { writeText } = require('../../utils/serverless-utils/log');
const validate = require('./lib/validate');
const formatLambdaLogEvent = require('./utils/format-lambda-log-event');
const { parseTimeInput, subtractTime } = require('./utils/time');
const ServerlessError = require('../../serverless-error');
const { hasOwn } = require('../../utils/safe-object');
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

    const { service } = this.serverless;
    if (this.options.function != null && this.options['web-app'] != null) {
      throw new ServerlessError(
        'The "--function" and "--web-app" options of osls command "logs" cannot be combined. Run "serverless logs --help" for more info',
        'LOGS_FUNCTION_AND_WEB_APP_OPTIONS'
      );
    }
    if (this.options.function == null && this.options['web-app'] == null) {
      throw new ServerlessError(
        'osls command "logs" requires "--function" or "--web-app" option. Run "serverless logs --help" for more info',
        'MISSING_REQUIRED_CLI_OPTION'
      );
    }

    this.options.interval = this.options.interval || 1000;

    if (this.options['web-app'] != null) {
      // validate web app exists in service
      const webAppObject = service.getWebApp(this.options['web-app']);
      const endpointType = (webAppObject.url && webAppObject.url.type) || 'HomeRegion';
      // Lambda writes to the ".local" log group of the Region that served a request, and later
      // copies the lines to the other log group, the only one with the lines of every Region
      this.options.logGroupName =
        endpointType === 'HomeRegion'
          ? this.provider.naming.getWebFunctionLocalLogGroupName(webAppObject.name)
          : this.provider.naming.getWebFunctionLogGroupName(webAppObject.name);
      return;
    }

    if (
      !hasOwn(service.functions, this.options.function) &&
      hasOwn(service.webApps, this.options.function)
    ) {
      throw new ServerlessError(
        `"${this.options.function}" is a web app. Read its logs with "serverless logs --web-app ${this.options.function}".`,
        'LOGS_WEB_APP_REQUIRES_WEB_APP_OPTION'
      );
    }

    // validate function exists in service
    const functionObject = service.getFunction(this.options.function);
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
          : `Web app "${this.options['web-app']}" has not logged anything yet. Its logs start with the first request it receives.`,
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
