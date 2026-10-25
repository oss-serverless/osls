'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const AwsMetrics = require('../../../../../lib/plugins/aws/metrics');
const ServerlessError = require('../../../../../lib/serverless-error');
const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');
const releasePendingRequestsUntilSettled = require('../../../../utils/release-pending-requests-until-settled');

const { formatDisplayTime } = require('../../../../../lib/plugins/aws/utils/time');

const toLocalDateString = (date) =>
  `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

function createServerlessContext(options) {
  const provider = {
    getStage: () => options.stage,
    getRegion: () => options.region,
    getAwsSdkV3Config: async () => ({ region: options.region }),
  };
  const service = {
    service: 'my-service',
    functions: {},
    getAllFunctions() {
      return Object.keys(this.functions);
    },
    getFunction(functionName) {
      if (!this.functions || !Object.hasOwn(this.functions, functionName)) {
        throw new ServerlessError(
          `Function "${functionName}" doesn't exist in this Service`,
          'FUNCTION_MISSING_IN_SERVICE'
        );
      }
      return this.functions[functionName];
    },
    getAllFunctionsNames() {
      return this.getAllFunctions().map((functionName) => this.getFunction(functionName).name);
    },
  };

  return {
    provider,
    serverless: {
      service,
      getProvider: sinon.stub().withArgs('aws').returns(provider),
    },
  };
}

describe('AwsMetrics', () => {
  let awsMetrics;
  let serverless;

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    ({ serverless } = createServerlessContext(options));
    awsMetrics = new AwsMetrics(serverless, options);
  });

  describe('#constructor()', () => {
    it('should set the serverless instance to this.serverless', () => {
      expect(awsMetrics.serverless).to.deep.equal(serverless);
    });

    it('should set the passed in options to this.options', () => {
      expect(awsMetrics.options).to.deep.equal({ stage: 'dev', region: 'us-east-1' });
    });

    it('should set the provider variable to the aws provider', () =>
      expect(awsMetrics.provider).to.equal(serverless.getProvider('aws')));

    it('should have a "metrics:metrics" hook', () => {
      expect(awsMetrics.hooks['metrics:metrics']).to.not.be.undefined;
    });

    it('should run promise chain in order for "metrics:metrics" hook', async () => {
      const extendedValidateStub = sinon.stub(awsMetrics, 'extendedValidate').resolves();
      const getMetricsStub = sinon.stub(awsMetrics, 'getMetrics').resolves();
      const showMetricsStub = sinon.stub(awsMetrics, 'showMetrics').resolves();

      await awsMetrics.hooks['metrics:metrics']();

      expect(extendedValidateStub.calledOnce).to.equal(true);
      expect(getMetricsStub.calledAfter(extendedValidateStub)).to.equal(true);
      expect(showMetricsStub.calledAfter(getMetricsStub)).to.equal(true);

      awsMetrics.extendedValidate.restore();
      awsMetrics.getMetrics.restore();
      awsMetrics.showMetrics.restore();
    });
  });

  describe('#extendedValidate()', () => {
    let validateStub;

    beforeEach(() => {
      awsMetrics.serverless.service.functions = {
        function1: {},
      };
      awsMetrics.serverless.service.service = 'my-service';
      awsMetrics.options.function = 'function1';
      validateStub = sinon.stub(awsMetrics, 'validate').resolves();
    });

    afterEach(() => {
      awsMetrics.validate.restore();
    });

    it('should call the shared validate() function', () => {
      awsMetrics.extendedValidate();

      expect(validateStub.calledOnce).to.equal(true);
    });

    it('should set the startTime to yesterday as the default value if not provided', () => {
      awsMetrics.options.startTime = null;

      let yesterday = new Date();
      yesterday = yesterday.setDate(yesterday.getDate() - 1);
      yesterday = new Date(yesterday);
      const yesterdaysYear = yesterday.getFullYear();
      const yesterdaysMonth = yesterday.getMonth() + 1;
      const yesterdaysDay = yesterday.getDate();
      const yesterdaysDate = `${yesterdaysYear}-${yesterdaysMonth}-${yesterdaysDay}`;

      awsMetrics.extendedValidate();

      expect(toLocalDateString(awsMetrics.options.startTime)).to.equal(yesterdaysDate);
    });

    it('should set the startTime to the provided value', () => {
      awsMetrics.options.startTime = '1970-01-01';

      awsMetrics.extendedValidate();

      const startTime = awsMetrics.options.startTime.toISOString();
      const expectedStartTime = new Date('1970-01-01').toISOString();
      expect(startTime).to.equal(expectedStartTime);
    });

    it('should translate human friendly syntax (e.g. 24h) for startTime', () => {
      awsMetrics.options.startTime = '24h'; // 24 hours ago

      let yesterday = new Date();
      yesterday = yesterday.setDate(yesterday.getDate() - 1);
      yesterday = new Date(yesterday);
      const yesterdaysYear = yesterday.getFullYear();
      const yesterdaysMonth = yesterday.getMonth() + 1;
      const yesterdaysDay = yesterday.getDate();
      const yesterdaysDate = `${yesterdaysYear}-${yesterdaysMonth}-${yesterdaysDay}`;

      awsMetrics.extendedValidate();

      expect(toLocalDateString(awsMetrics.options.startTime)).to.equal(yesterdaysDate);
    });

    it('should translate minute-based human friendly syntax for startTime', () => {
      awsMetrics.options.startTime = '30m';

      awsMetrics.extendedValidate();

      expect(awsMetrics.options.startTime).to.be.instanceof(Date);
    });

    it('should set the endTime to today as the default value if not provided', () => {
      awsMetrics.options.endTime = null;

      const today = new Date();
      const todaysYear = today.getFullYear();
      const todaysMonth = today.getMonth() + 1;
      const todaysDay = today.getDate();
      const todaysDate = `${todaysYear}-${todaysMonth}-${todaysDay}`;

      awsMetrics.extendedValidate();

      expect(toLocalDateString(awsMetrics.options.endTime)).to.equal(todaysDate);
    });

    it('should set the endTime to the provided value', () => {
      awsMetrics.options.endTime = '1970-01-01';

      awsMetrics.extendedValidate();

      const endTime = awsMetrics.options.endTime.toISOString();
      const expectedEndTime = new Date('1970-01-01').toISOString();
      expect(endTime).to.equal(expectedEndTime);
    });

    it('should support epoch seconds for startTime', () => {
      awsMetrics.options.startTime = '1469705761';

      awsMetrics.extendedValidate();

      expect(awsMetrics.options.startTime.getTime()).to.equal(1469705761000);
    });

    it('should support epoch milliseconds for endTime', () => {
      awsMetrics.options.endTime = '1469705761000';

      awsMetrics.extendedValidate();

      expect(awsMetrics.options.endTime.getTime()).to.equal(1469705761000);
    });

    it('should interpret datetimes without an offset as UTC', () => {
      awsMetrics.options.startTime = '2016-07-01T10:00';

      awsMetrics.extendedValidate();

      expect(awsMetrics.options.startTime.getTime()).to.equal(Date.UTC(2016, 6, 1, 10));
    });

    it('should translate human friendly syntax for endTime', () => {
      awsMetrics.options.endTime = '1h';

      awsMetrics.extendedValidate();

      const expectedEndTime = Date.now() - 60 * 60 * 1000;
      expect(awsMetrics.options.endTime.getTime()).to.be.closeTo(expectedEndTime, 5000);
    });

    it('should throw on a malformed startTime', () => {
      awsMetrics.options.startTime = '1h30m';

      expect(() => awsMetrics.extendedValidate())
        .to.throw(ServerlessError)
        .with.property('code', 'INVALID_TIME_INPUT');
    });
  });

  describe('#getMetrics()', () => {
    let requestStub;

    beforeEach(() => {
      awsMetrics.serverless.service.functions = {
        function1: {
          name: 'func1',
        },
        function2: {
          name: 'func2',
        },
      };
      awsMetrics.options.startTime = new Date('1970-01-01');
      awsMetrics.options.endTime = new Date('1970-01-02');
      requestStub = sinon.stub(CloudWatchClient.prototype, 'send');
    });

    afterEach(() => {
      CloudWatchClient.prototype.send.restore();
    });

    it('should gather service wide function metrics if no function option is specified', async () => {
      // stubs for function1
      // invocations
      requestStub.onCall(0).resolves({
        ResponseMetadata: { RequestId: '1f50045b-b569-11e6-86c6-eb54d1aaa755-func1' },
        Label: 'Invocations',
        Datapoints: [],
      });
      // throttles
      requestStub.onCall(1).resolves({
        ResponseMetadata: { RequestId: '1f59059b-b569-11e6-aa18-c7bab68810d2-func1' },
        Label: 'Throttles',
        Datapoints: [],
      });
      // errors
      requestStub.onCall(2).resolves({
        ResponseMetadata: { RequestId: '1f50c7b1-b569-11e6-b1b6-ab86694b617b-func1' },
        Label: 'Errors',
        Datapoints: [],
      });
      // duration
      requestStub.onCall(3).resolves({
        ResponseMetadata: { RequestId: '1f63db14-b569-11e6-8501-d98a275ce164-func1' },
        Label: 'Duration',
        Datapoints: [],
      });
      // stubs for function2
      // invocations
      requestStub.onCall(4).resolves({
        ResponseMetadata: { RequestId: '1f50045b-b569-11e6-86c6-eb54d1aaa755-func2' },
        Label: 'Invocations',
        Datapoints: [],
      });
      // throttles
      requestStub.onCall(5).resolves({
        ResponseMetadata: { RequestId: '1f59059b-b569-11e6-aa18-c7bab68810d2-func2' },
        Label: 'Throttles',
        Datapoints: [],
      });
      // errors
      requestStub.onCall(6).resolves({
        ResponseMetadata: { RequestId: '1f50c7b1-b569-11e6-b1b6-ab86694b617b-func2' },
        Label: 'Errors',
        Datapoints: [],
      });
      // duration
      requestStub.onCall(7).resolves({
        ResponseMetadata: { RequestId: '1f63db14-b569-11e6-8501-d98a275ce164-func2' },
        Label: 'Duration',
        Datapoints: [],
      });

      const expectedResult = [
        [
          {
            ResponseMetadata: { RequestId: '1f50045b-b569-11e6-86c6-eb54d1aaa755-func1' },
            Label: 'Invocations',
            Datapoints: [],
          },
          {
            ResponseMetadata: { RequestId: '1f59059b-b569-11e6-aa18-c7bab68810d2-func1' },
            Label: 'Throttles',
            Datapoints: [],
          },
          {
            ResponseMetadata: { RequestId: '1f50c7b1-b569-11e6-b1b6-ab86694b617b-func1' },
            Label: 'Errors',
            Datapoints: [],
          },
          {
            ResponseMetadata: { RequestId: '1f63db14-b569-11e6-8501-d98a275ce164-func1' },
            Label: 'Duration',
            Datapoints: [],
          },
        ],
        [
          {
            ResponseMetadata: { RequestId: '1f50045b-b569-11e6-86c6-eb54d1aaa755-func2' },
            Label: 'Invocations',
            Datapoints: [],
          },
          {
            ResponseMetadata: { RequestId: '1f59059b-b569-11e6-aa18-c7bab68810d2-func2' },
            Label: 'Throttles',
            Datapoints: [],
          },
          {
            ResponseMetadata: { RequestId: '1f50c7b1-b569-11e6-b1b6-ab86694b617b-func2' },
            Label: 'Errors',
            Datapoints: [],
          },
          {
            ResponseMetadata: { RequestId: '1f63db14-b569-11e6-8501-d98a275ce164-func2' },
            Label: 'Duration',
            Datapoints: [],
          },
        ],
      ];

      const result = await awsMetrics.getMetrics();
      expect(result).to.deep.equal(expectedResult);
    });

    it('should gather function metrics if function option is specified', async () => {
      // only display metrics for function1
      awsMetrics.options.function = 'function1';

      // stubs for function1
      // invocations
      requestStub.onCall(0).resolves({
        ResponseMetadata: { RequestId: '1f50045b-b569-11e6-86c6-eb54d1aaa755-func1' },
        Label: 'Invocations',
        Datapoints: [],
      });
      // throttles
      requestStub.onCall(1).resolves({
        ResponseMetadata: { RequestId: '1f59059b-b569-11e6-aa18-c7bab68810d2-func1' },
        Label: 'Throttles',
        Datapoints: [],
      });
      // errors
      requestStub.onCall(2).resolves({
        ResponseMetadata: { RequestId: '1f50c7b1-b569-11e6-b1b6-ab86694b617b-func1' },
        Label: 'Errors',
        Datapoints: [],
      });
      // duration
      requestStub.onCall(3).resolves({
        ResponseMetadata: { RequestId: '1f63db14-b569-11e6-8501-d98a275ce164-func1' },
        Label: 'Duration',
        Datapoints: [],
      });

      const expectedResult = [
        [
          {
            ResponseMetadata: { RequestId: '1f50045b-b569-11e6-86c6-eb54d1aaa755-func1' },
            Label: 'Invocations',
            Datapoints: [],
          },
          {
            ResponseMetadata: { RequestId: '1f59059b-b569-11e6-aa18-c7bab68810d2-func1' },
            Label: 'Throttles',
            Datapoints: [],
          },
          {
            ResponseMetadata: { RequestId: '1f50c7b1-b569-11e6-b1b6-ab86694b617b-func1' },
            Label: 'Errors',
            Datapoints: [],
          },
          {
            ResponseMetadata: { RequestId: '1f63db14-b569-11e6-8501-d98a275ce164-func1' },
            Label: 'Duration',
            Datapoints: [],
          },
        ],
      ];

      const result = await awsMetrics.getMetrics();
      expect(result).to.deep.equal(expectedResult);
    });

    it('limits total CloudWatch metric requests to 6 across all functions', async () => {
      awsMetrics.serverless.service.functions = Object.fromEntries(
        Array.from({ length: 3 }, (_, index) => [`function${index}`, { name: `func${index}` }])
      );
      let activeRequests = 0;
      let observedMaxActiveRequests = 0;
      const pendingResolvers = [];
      requestStub.callsFake(async (command) => {
        activeRequests += 1;
        observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
        expect(activeRequests).to.be.at.most(6);
        await new Promise((resolve) => pendingResolvers.push(resolve));
        activeRequests -= 1;
        return {
          Label: command.input.MetricName,
          Datapoints: [],
        };
      });

      const promise = awsMetrics.getMetrics();

      for (let index = 0; index < 20 && pendingResolvers.length < 6; index += 1) {
        await Promise.resolve();
      }
      expect(observedMaxActiveRequests).to.equal(6);
      await releasePendingRequestsUntilSettled(pendingResolvers, promise);
      expect(observedMaxActiveRequests).to.equal(6);
    });

    it('reuses one CloudWatch client across repeated metric gathers', async () => {
      const getAwsSdkV3ConfigSpy = sinon.spy(awsMetrics.provider, 'getAwsSdkV3Config');
      requestStub.callsFake(async (command) => ({
        Label: command.input.MetricName,
        Datapoints: [],
      }));

      try {
        await awsMetrics.getMetrics();
        await awsMetrics.getMetrics();

        expect(getAwsSdkV3ConfigSpy).to.have.been.calledOnce;
        expect(requestStub).to.have.callCount(16);
        for (const call of requestStub.getCalls()) {
          expect(call.args[0]).to.be.instanceOf(GetMetricStatisticsCommand);
          expect(call.thisValue).to.equal(requestStub.firstCall.thisValue);
        }
      } finally {
        getAwsSdkV3ConfigSpy.restore();
      }
    });

    it('should gather metrics with 1 hour period for time span < 24 hours', async () => {
      awsMetrics.options.startTime = new Date('1970-01-01T09:00');
      awsMetrics.options.endTime = new Date('1970-01-01T16:00');

      await awsMetrics.getMetrics();

      expect(
        requestStub
          .getCalls()
          .some(
            (call) =>
              call.args[0] instanceof GetMetricStatisticsCommand &&
              call.args[0].input.Period === 3600
          )
      ).to.equal(true);
    });

    it('should gather metrics with 1 day period for time span > 24 hours', async () => {
      awsMetrics.options.startTime = new Date('1970-01-01');
      awsMetrics.options.endTime = new Date('1970-01-03');

      await awsMetrics.getMetrics();

      expect(
        requestStub
          .getCalls()
          .some(
            (call) =>
              call.args[0] instanceof GetMetricStatisticsCommand &&
              call.args[0].input.Period === 24 * 3600
          )
      ).to.equal(true);
    });

    it('should gather metrics with 1 hour period for exactly 24 hours', async () => {
      awsMetrics.options.startTime = new Date('1970-01-01T00:00:00.000Z');
      awsMetrics.options.endTime = new Date('1970-01-02T00:00:00.000Z');

      await awsMetrics.getMetrics();

      expect(
        requestStub
          .getCalls()
          .some(
            (call) =>
              call.args[0] instanceof GetMetricStatisticsCommand &&
              call.args[0].input.Period === 3600
          )
      ).to.equal(true);
    });
  });

  describe('#showMetrics()', () => {
    it('aggregates datapoints across functions and prints rounded output', () => {
      const writeTextStub = sinon.stub();
      const AwsMetricsProxy = proxyquire
        .noCallThru()
        .load('../../../../../lib/plugins/aws/metrics', {
          '../../utils/serverless-utils/log': {
            writeText: writeTextStub,
            style: {
              aside: (value) => value,
            },
          },
        });

      const proxiedMetrics = new AwsMetricsProxy(serverless, {
        stage: 'dev',
        region: 'us-east-1',
      });

      proxiedMetrics.options.startTime = new Date('1970-01-01T00:00:00.000Z');
      proxiedMetrics.options.endTime = new Date('1970-01-01T01:00:00.000Z');

      proxiedMetrics.showMetrics([
        [
          { Label: 'Invocations', Datapoints: [{ Sum: 3 }, { Sum: 2 }] },
          { Label: 'Errors', Datapoints: [{ Sum: 1 }] },
          { Label: 'Duration', Datapoints: [{ Average: 100 }, { Average: 200 }] },
        ],
        [
          { Label: 'Invocations', Datapoints: [{ Sum: 4 }] },
          { Label: 'Throttles', Datapoints: [{ Sum: 1 }] },
          { Label: 'Duration', Datapoints: [{ Average: 50 }] },
        ],
      ]);

      expect(writeTextStub).to.have.been.calledOnce;
      expect(writeTextStub.firstCall.args[0]).to.include(
        `${formatDisplayTime(proxiedMetrics.options.startTime)} - ` +
          `${formatDisplayTime(proxiedMetrics.options.endTime)}\n`
      );
      expect(writeTextStub.firstCall.args[0]).to.include('invocations: 9');
      expect(writeTextStub.firstCall.args[0]).to.include('throttles: 1');
      expect(writeTextStub.firstCall.args[0]).to.include('errors: 1');
      expect(writeTextStub.firstCall.args[0]).to.include('duration (avg.): 116.67ms');
    });

    it('prints the empty-state message when there are no metrics', () => {
      const writeTextStub = sinon.stub();
      const AwsMetricsProxy = proxyquire
        .noCallThru()
        .load('../../../../../lib/plugins/aws/metrics', {
          '../../utils/serverless-utils/log': {
            writeText: writeTextStub,
            style: {
              aside: (value) => value,
            },
          },
        });

      const proxiedMetrics = new AwsMetricsProxy(serverless, {
        stage: 'dev',
        region: 'us-east-1',
      });

      proxiedMetrics.options.startTime = new Date('1970-01-01T00:00:00.000Z');
      proxiedMetrics.options.endTime = new Date('1970-01-01T01:00:00.000Z');

      proxiedMetrics.showMetrics([]);

      expect(writeTextStub).to.have.been.calledOnce;
      expect(writeTextStub.firstCall.args[0]).to.include(
        'There are no metrics to show for these options'
      );
    });
  });
});
