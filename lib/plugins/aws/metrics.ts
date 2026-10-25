'use strict';

const promiseLimit = require('ext/promise/limit').bind(Promise);
const validate = require('./lib/validate');
const { writeText, style } = require('../../utils/serverless-utils/log');
const { parseTimeInput, subtractTime, formatDisplayTime } = require('./utils/time');
const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');

function getCloudWatchClient(context) {
  context.cloudWatchClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudWatchClient(config));
  return context.cloudWatchClientPromise;
}

class AwsMetrics {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');
    this.limitCloudWatchRequests = promiseLimit(6, async (task) => task());

    Object.assign(this, validate);

    this.hooks = {
      'metrics:metrics': async () => {
        this.extendedValidate();
        const metrics = await this.getMetrics();
        this.showMetrics(metrics);
      },
    };
  }

  extendedValidate() {
    this.validate();

    this.options.startTime = this.options.startTime
      ? new Date(parseTimeInput(this.options.startTime, '--startTime'))
      : subtractTime(new Date(), 1, 'd');
    this.options.endTime = this.options.endTime
      ? new Date(parseTimeInput(this.options.endTime, '--endTime'))
      : new Date();
  }

  async getMetrics() {
    const StartTime = this.options.startTime;
    const EndTime = this.options.endTime;
    const hoursDiff = Math.abs(EndTime - StartTime) / 36e5;
    const Period = hoursDiff > 24 ? 3600 * 24 : 3600;
    const functions = this.options.function
      ? [this.serverless.service.getFunction(this.options.function).name]
      : this.serverless.service.getAllFunctionsNames();
    const cloudWatch = await getCloudWatchClient(this);

    return Promise.all(
      functions.map(async (functionName) => {
        const commonParams = {
          StartTime,
          EndTime,
          Namespace: 'AWS/Lambda',
          Period,
          Dimensions: [{ Name: 'FunctionName', Value: functionName }],
        };

        const invocationsParams = Object.assign({}, commonParams, {
          MetricName: 'Invocations',
          Statistics: ['Sum'],
          Unit: 'Count',
        });
        const throttlesParams = Object.assign({}, commonParams, {
          MetricName: 'Throttles',
          Statistics: ['Sum'],
          Unit: 'Count',
        });
        const errorsParams = Object.assign({}, commonParams, {
          MetricName: 'Errors',
          Statistics: ['Sum'],
          Unit: 'Count',
        });
        const averageDurationParams = Object.assign({}, commonParams, {
          MetricName: 'Duration',
          Statistics: ['Average'],
          Unit: 'Milliseconds',
        });

        const getMetrics = (params) =>
          this.limitCloudWatchRequests(() =>
            cloudWatch.send(new GetMetricStatisticsCommand(params))
          );

        return Promise.all([
          getMetrics(invocationsParams),
          getMetrics(throttlesParams),
          getMetrics(errorsParams),
          getMetrics(averageDurationParams),
        ]);
      })
    );
  }

  showMetrics(metrics) {
    const modernMessageTokens = [];

    if (this.options.function) {
      modernMessageTokens.push(this.options.function);
    } else {
      modernMessageTokens.push('Service wide metrics');
    }

    const formattedStartTime = formatDisplayTime(this.options.startTime);
    const formattedEndTime = formatDisplayTime(this.options.endTime);
    modernMessageTokens.push(`${formattedStartTime} - ${formattedEndTime}\n`);

    if (metrics && metrics.length > 0) {
      const getDatapointsByLabel = (Label) =>
        metrics
          .flat()
          .filter((metric) => metric.Label === Label)
          .map((metric) => metric.Datapoints)
          .flat();

      const sumBy = (items, key) => items.reduce((result, item) => result + (item[key] || 0), 0);
      const meanBy = (items, key) => {
        if (!items.length) return 0;
        return sumBy(items, key) / items.length;
      };

      const invocationsCount = sumBy(getDatapointsByLabel('Invocations'), 'Sum');
      const throttlesCount = sumBy(getDatapointsByLabel('Throttles'), 'Sum');
      const errorsCount = sumBy(getDatapointsByLabel('Errors'), 'Sum');
      const durationAverage = meanBy(getDatapointsByLabel('Duration'), 'Average');

      modernMessageTokens.push(
        `${style.aside('invocations')}: ${invocationsCount}`,
        `${style.aside('throttles')}: ${throttlesCount}`,
        `${style.aside('errors')}: ${errorsCount}`,
        `${style.aside('duration (avg.)')}: ${Number(durationAverage.toFixed(2))}ms`
      );
    } else {
      modernMessageTokens.push('There are no metrics to show for these options');
    }

    writeText(modernMessageTokens);
  }
}

module.exports = AwsMetrics;
