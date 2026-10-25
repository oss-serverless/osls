'use strict';

const sinon = require('sinon');
const proxyquire = require('proxyquire');
const AwsLogs = require('../../../../../lib/plugins/aws/logs');
const ServerlessError = require('../../../../../lib/serverless-error');
const {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

// Configure chai
const expect = require('chai').expect;

function createServerlessContext(options) {
  const provider = {
    getStage: () => options.stage,
    getRegion: () => options.region,
    getAwsSdkV3Config: async () => ({ region: options.region }),
    naming: {
      getLogGroupName: (lambdaName) => `/aws/lambda/${lambdaName}`,
    },
  };
  const service = {
    service: 'new-service',
    functions: {},
    getFunction(functionName) {
      if (!this.functions || !Object.hasOwn(this.functions, functionName)) {
        throw new ServerlessError(
          `Function "${functionName}" doesn't exist in this Service`,
          'FUNCTION_MISSING_IN_SERVICE'
        );
      }
      return this.functions[functionName];
    },
  };

  return {
    provider,
    serverless: {
      service,
      serviceDir: false,
      processedInput: { commands: ['logs'] },
      getProvider: sinon.stub().withArgs('aws').returns(provider),
    },
  };
}

describe('AwsLogs', () => {
  let serverless;
  let awsLogs;

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
      function: 'first',
    };
    ({ serverless } = createServerlessContext(options));
    awsLogs = new AwsLogs(serverless, options);
  });

  afterEach(() => {
    if (CloudWatchLogsClient.prototype.send.restore) {
      CloudWatchLogsClient.prototype.send.restore();
    }
  });

  describe('#constructor()', () => {
    it('should have hooks', () => expect(awsLogs.hooks).to.be.not.empty);

    it('should set an empty options object if no options are given', () => {
      const awsLogsWithEmptyOptions = new AwsLogs(serverless);

      expect(awsLogsWithEmptyOptions.options).to.deep.equal({});
    });

    it('should set the provider variable to the aws provider', () =>
      expect(awsLogs.provider).to.equal(serverless.getProvider('aws')));

    it('should run promise chain in order', async () => {
      const validateStub = sinon.stub(awsLogs, 'extendedValidate').resolves();
      const getLogStreamsStub = sinon.stub(awsLogs, 'getLogStreams').resolves();
      const showLogsStub = sinon.stub(awsLogs, 'showLogs').resolves();

      await awsLogs.hooks['logs:logs']();

      expect(validateStub.calledOnce).to.be.equal(true);
      expect(getLogStreamsStub.calledAfter(validateStub)).to.be.equal(true);
      expect(showLogsStub.calledAfter(getLogStreamsStub)).to.be.equal(true);

      awsLogs.extendedValidate.restore();
      awsLogs.getLogStreams.restore();
      awsLogs.showLogs.restore();
    });
  });

  describe('#extendedValidate()', () => {
    beforeEach(() => {
      serverless.serviceDir = true;
      serverless.service.environment = {
        vars: {},
        stages: {
          dev: {
            vars: {},
            regions: {
              'us-east-1': {
                vars: {},
              },
            },
          },
        },
      };
      serverless.service.functions = {
        first: {
          handler: true,
          name: 'customName',
        },
      };
    });

    it('it should throw error if function is not provided', () => {
      serverless.service.functions = null;
      expect(() => awsLogs.extendedValidate()).to.throw(Error);
    });

    it('it should set default options', () => {
      awsLogs.extendedValidate();
      expect(awsLogs.options.stage).to.deep.equal('dev');
      expect(awsLogs.options.region).to.deep.equal('us-east-1');
      expect(awsLogs.options.function).to.deep.equal('first');
      expect(awsLogs.options.interval).to.be.equal(1000);
      expect(awsLogs.options.logGroupName).to.deep.equal(
        awsLogs.provider.naming.getLogGroupName('customName')
      );
    });
  });

  describe('#getLogStreams()', () => {
    beforeEach(() => {
      awsLogs.serverless.service.service = 'new-service';
      awsLogs.options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
      };
    });

    it('should get log streams with correct params', async () => {
      const replyMock = {
        logStreams: [
          {
            logStreamName: '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
            creationTime: 1469687512311,
          },
          {
            logStreamName: '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
            creationTime: 1469687512311,
          },
        ],
      };
      const getLogStreamsStub = sinon
        .stub(CloudWatchLogsClient.prototype, 'send')
        .resolves(replyMock);

      const logStreamNames = await awsLogs.getLogStreams();

      expect(getLogStreamsStub.calledOnce).to.be.equal(true);
      expect(getLogStreamsStub.firstCall.args[0]).to.be.instanceOf(DescribeLogStreamsCommand);
      expect(getLogStreamsStub.firstCall.args[0].input).to.deep.equal({
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        descending: true,
        limit: 50,
        orderBy: 'LastEventTime',
      });

      expect(logStreamNames[0]).to.be.equal('2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba');
      expect(logStreamNames[1]).to.be.equal('2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba');
    });

    it('should throw error if no log streams found', async () => {
      sinon.stub(CloudWatchLogsClient.prototype, 'send').resolves();

      await expect(awsLogs.getLogStreams()).to.eventually.be.rejected.and.have.property(
        'name',
        'ServerlessError'
      );
    });
  });

  describe('#showLogs()', () => {
    let clock;
    const fakeTime = new Date(Date.UTC(2016, 9, 1)).getTime();

    beforeEach(() => {
      // set the fake Date 'Sat Sep 01 2016 00:00:00'
      clock = sinon.useFakeTimers(fakeTime);
    });

    afterEach(() => {
      // new Date() => will return the real time again (now)
      clock.restore();
    });

    it('should call filterLogEvents API with correct params', async () => {
      const replyMock = {
        events: [
          {
            logStreamName: '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
            timestamp: 1469687512311,
            message: 'test',
          },
          {
            logStreamName: '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
            timestamp: 1469687512311,
            message: 'test',
          },
        ],
      };
      const logStreamNamesMock = [
        '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
        '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
      ];
      const filterLogEventsStub = sinon
        .stub(CloudWatchLogsClient.prototype, 'send')
        .resolves(replyMock);
      awsLogs.serverless.service.service = 'new-service';
      awsLogs.options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        startTime: '3h',
        filter: 'error',
      };

      await awsLogs.showLogs(logStreamNamesMock);

      expect(filterLogEventsStub.calledOnce).to.be.equal(true);
      expect(filterLogEventsStub.firstCall.args[0]).to.be.instanceOf(FilterLogEventsCommand);
      expect(filterLogEventsStub.firstCall.args[0].input).to.deep.equal({
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        interleaved: true,
        logStreamNames: logStreamNamesMock,
        filterPattern: 'error',
        startTime: fakeTime - 3 * 60 * 60 * 1000, // -3h
      });
    });

    it('should call filterLogEvents API with standard start time', async () => {
      const replyMock = {
        events: [
          {
            logStreamName: '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
            timestamp: 1469687512311,
            message: 'test',
          },
          {
            logStreamName: '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
            timestamp: 1469687512311,
            message: 'test',
          },
        ],
      };
      const logStreamNamesMock = [
        '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
        '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
      ];
      const filterLogEventsStub = sinon
        .stub(CloudWatchLogsClient.prototype, 'send')
        .resolves(replyMock);
      awsLogs.serverless.service.service = 'new-service';
      awsLogs.options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        startTime: '2010-10-20',
        filter: 'error',
      };

      await awsLogs.showLogs(logStreamNamesMock);

      expect(filterLogEventsStub.calledOnce).to.be.equal(true);
      expect(filterLogEventsStub.firstCall.args[0]).to.be.instanceOf(FilterLogEventsCommand);
      expect(filterLogEventsStub.firstCall.args[0].input).to.deep.equal({
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        interleaved: true,
        logStreamNames: logStreamNamesMock,
        startTime: 1287532800000, // '2010-10-20'
        filterPattern: 'error',
      });
    });

    it('should call filterLogEvents API with epoch start time', async () => {
      const logStreamNamesMock = ['2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba'];
      const filterLogEventsStub = sinon
        .stub(CloudWatchLogsClient.prototype, 'send')
        .resolves({ events: [] });
      awsLogs.serverless.service.service = 'new-service';
      awsLogs.options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        startTime: '1469694264', // epoch seconds
      };

      await awsLogs.showLogs(logStreamNamesMock);

      expect(filterLogEventsStub.firstCall.args[0].input.startTime).to.equal(1469694264000);
    });

    it('should call filterLogEvents API with epoch milliseconds start time', async () => {
      const logStreamNamesMock = ['2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba'];
      const filterLogEventsStub = sinon
        .stub(CloudWatchLogsClient.prototype, 'send')
        .resolves({ events: [] });
      awsLogs.serverless.service.service = 'new-service';
      awsLogs.options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        startTime: '1469694264000',
      };

      await awsLogs.showLogs(logStreamNamesMock);

      expect(filterLogEventsStub.firstCall.args[0].input.startTime).to.equal(1469694264000);
    });

    it('should throw on a malformed start time', async () => {
      awsLogs.serverless.service.service = 'new-service';
      awsLogs.options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        startTime: '1h30m',
      };

      await expect(
        awsLogs.showLogs(['2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba'])
      ).to.eventually.be.rejected.and.have.property('code', 'INVALID_TIME_INPUT');
    });

    it('should call filterLogEvents API with latest 10 minutes if startTime not given', async () => {
      const replyMock = {
        events: [
          {
            logStreamName: '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
            timestamp: 1469687512311,
            message: 'test',
          },
          {
            logStreamName: '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
            timestamp: 1469687512311,
            message: 'test',
          },
        ],
      };
      const logStreamNamesMock = [
        '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
        '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
      ];
      const filterLogEventsStub = sinon
        .stub(CloudWatchLogsClient.prototype, 'send')
        .resolves(replyMock);
      awsLogs.serverless.service.service = 'new-service';
      awsLogs.options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
      };

      await awsLogs.showLogs(logStreamNamesMock);

      expect(filterLogEventsStub.calledOnce).to.be.equal(true);
      expect(filterLogEventsStub.firstCall.args[0]).to.be.instanceOf(FilterLogEventsCommand);
      expect(filterLogEventsStub.firstCall.args[0].input).to.deep.equal({
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        interleaved: true,
        logStreamNames: logStreamNamesMock,
        startTime: fakeTime - 10 * 60 * 1000, // fakeTime - 10 minutes
      });
    });

    it('should call filterLogEvents API which starts 10 seconds in the past if tail given', async () => {
      const replyMock = {
        events: [
          {
            logStreamName: '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
            timestamp: 1469687512311,
            message: 'test',
          },
          {
            logStreamName: '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
            timestamp: 1469687512311,
            message: 'test',
          },
        ],
      };
      const logStreamNamesMock = [
        '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
        '2016/07/28/[$LATEST]83f5206ab2a8488290349b9c1fbfe2ba',
      ];

      const timersSleep = sinon.stub().rejects();
      const MockedAwsLogs = proxyquire('../../../../../lib/plugins/aws/logs', {
        '../../utils/sleep': timersSleep,
      });

      const options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
      };
      const { serverless: mockedServerless } = createServerlessContext(options);
      const mockedAwsLogs = new MockedAwsLogs(mockedServerless, options);

      const filterLogEventsStub = sinon
        .stub(CloudWatchLogsClient.prototype, 'send')
        .resolves(replyMock);
      mockedAwsLogs.serverless.service.service = 'new-service';
      mockedAwsLogs.options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        tail: true,
      };

      try {
        await mockedAwsLogs.showLogs(logStreamNamesMock);
      } catch {
        // timersSleep has to reject or it'll loop forever
      }

      expect(filterLogEventsStub.calledOnce).to.be.equal(true);
      expect(filterLogEventsStub.firstCall.args[0]).to.be.instanceOf(FilterLogEventsCommand);
      expect(filterLogEventsStub.firstCall.args[0].input).to.deep.equal({
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        interleaved: true,
        logStreamNames: logStreamNamesMock,
        startTime: fakeTime - 10 * 1000, // fakeTime - 10 seconds
      });
    });

    it('should poll from the last event timestamp + 1 when tailing', async () => {
      const lastEventTimestamp = 1469687512311;
      const stopError = new Error('stop tail loop');
      const sleepStub = sinon.stub().onFirstCall().resolves().onSecondCall().rejects(stopError);
      const MockedAwsLogs = proxyquire('../../../../../lib/plugins/aws/logs', {
        '../../utils/sleep': sleepStub,
      });

      const options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
      };
      const { serverless: mockedServerless } = createServerlessContext(options);
      const mockedAwsLogs = new MockedAwsLogs(mockedServerless, options);

      const sendStub = sinon
        .stub(CloudWatchLogsClient.prototype, 'send')
        .callsFake(async (command) => {
          if (command instanceof DescribeLogStreamsCommand) {
            return { logStreams: [{ logStreamName: 'stream' }] };
          }
          return {
            events: [{ logStreamName: 'stream', timestamp: lastEventTimestamp, message: 'test' }],
          };
        });
      mockedAwsLogs.serverless.service.service = 'new-service';
      mockedAwsLogs.options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
        logGroupName: awsLogs.provider.naming.getLogGroupName('new-service-dev-first'),
        tail: true,
      };

      await expect(mockedAwsLogs.showLogs(['stream'])).to.be.rejectedWith(stopError);

      const filterCalls = sendStub
        .getCalls()
        .filter((call) => call.args[0] instanceof FilterLogEventsCommand);
      expect(filterCalls).to.have.length(2);
      expect(filterCalls[0].args[0].input.startTime).to.equal(fakeTime - 10 * 1000);
      expect(filterCalls[1].args[0].input.startTime).to.equal(lastEventTimestamp + 1);
    });

    it('reuses one CloudWatch Logs client across tail polling', async () => {
      const stopError = new Error('stop tail loop');
      const sleepStub = sinon.stub().onFirstCall().resolves().onSecondCall().rejects(stopError);
      const cloudWatchLogsClients = [];
      class FakeCommand {
        constructor(input) {
          this.input = input;
        }
      }
      class FakeDescribeLogStreamsCommand extends FakeCommand {}
      class FakeFilterLogEventsCommand extends FakeCommand {}
      class FakeCloudWatchLogsClient {
        constructor(config) {
          this.config = config;
          cloudWatchLogsClients.push(this);
        }

        async send(command) {
          if (command instanceof FakeDescribeLogStreamsCommand) {
            return { logStreams: [{ logStreamName: 'stream' }] };
          }
          if (command instanceof FakeFilterLogEventsCommand) return { events: [] };
          throw new Error(`Unexpected command ${command.constructor.name}`);
        }
      }
      const MockedAwsLogs = proxyquire('../../../../../lib/plugins/aws/logs', {
        '../../utils/sleep': sleepStub,
        '@aws-sdk/client-cloudwatch-logs': {
          CloudWatchLogsClient: FakeCloudWatchLogsClient,
          DescribeLogStreamsCommand: FakeDescribeLogStreamsCommand,
          FilterLogEventsCommand: FakeFilterLogEventsCommand,
        },
      });
      const mockedAwsLogs = new MockedAwsLogs(serverless, {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
      });
      mockedAwsLogs.options = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
        logGroupName: '/aws/lambda/test',
        tail: true,
      };

      await expect(mockedAwsLogs.showLogs(['stream'])).to.be.rejectedWith(stopError);

      expect(cloudWatchLogsClients).to.have.length(1);
    });
  });
});
