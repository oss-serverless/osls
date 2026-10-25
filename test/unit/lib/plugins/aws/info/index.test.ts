'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const AwsInfo = require('../../../../../../lib/plugins/aws/info/index');

function createServerlessContext(options, getAwsInfo) {
  const provider = {
    getStage: () => options.stage,
    getRegion: () => options.region,
    getAwsSdkV3Config: async () => ({ region: options.region }),
  };

  return {
    provider,
    serverless: {
      processedInput: { commands: ['info'] },
      serviceOutputs: new Map(),
      servicePluginOutputs: new Map(),
      getProvider: sinon.stub().withArgs('aws').returns(provider),
      pluginManager: {
        spawn: sinon.stub().callsFake(async (command) => {
          if (command !== 'aws:info') throw new Error(`Unexpected command ${command}`);
          const awsInfo = getAwsInfo();
          const lifecycleEvents = awsInfo.commands.aws.commands.info.lifecycleEvents;
          for (const event of lifecycleEvents) {
            for (const hookName of [
              `before:${command}:${event}`,
              `${command}:${event}`,
              `after:${command}:${event}`,
            ]) {
              if (awsInfo.hooks[hookName]) await awsInfo.hooks[hookName]();
            }
          }
        }),
      },
    },
  };
}

describe('AwsInfo', () => {
  let serverless;
  let awsInfo;
  let validateStub;
  let getStackInfoStub;
  let getResourceCountStub;
  let getApiKeyValuesStub;
  let displayServiceInfoStub;
  let displayApiKeysStub;
  let displayEndpointsStub;
  let displayFunctionsStub;
  let displayLayersStub;
  let displayStackOutputsStub;

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    ({ serverless } = createServerlessContext(options, () => awsInfo));
    awsInfo = new AwsInfo(serverless, options);
    validateStub = sinon.stub(awsInfo, 'validate').resolves();
    getStackInfoStub = sinon.stub(awsInfo, 'getStackInfo').resolves();
    getResourceCountStub = sinon.stub(awsInfo, 'getResourceCount').resolves();
    getApiKeyValuesStub = sinon.stub(awsInfo, 'getApiKeyValues').resolves();
    displayServiceInfoStub = sinon.stub(awsInfo, 'displayServiceInfo').resolves();
    displayApiKeysStub = sinon.stub(awsInfo, 'displayApiKeys').resolves();
    displayEndpointsStub = sinon.stub(awsInfo, 'displayEndpoints').resolves();
    displayFunctionsStub = sinon.stub(awsInfo, 'displayFunctions').resolves();
    displayLayersStub = sinon.stub(awsInfo, 'displayLayers').resolves();
    displayStackOutputsStub = sinon.stub(awsInfo, 'displayStackOutputs').resolves();
  });

  afterEach(() => {
    awsInfo.validate.restore();
    awsInfo.getStackInfo.restore();
    awsInfo.getResourceCount.restore();
    awsInfo.getApiKeyValues.restore();
    awsInfo.displayServiceInfo.restore();
    awsInfo.displayApiKeys.restore();
    awsInfo.displayEndpoints.restore();
    awsInfo.displayFunctions.restore();
    awsInfo.displayLayers.restore();
    awsInfo.displayStackOutputs.restore();
  });

  describe('#constructor()', () => {
    it('should have hooks', () => expect(awsInfo.hooks).to.be.not.empty);

    it('should set the provider variable to the aws provider', () =>
      expect(awsInfo.provider).to.equal(serverless.getProvider('aws')));

    it('should set an empty options object if no options are given', () => {
      const awsInfoWithEmptyOptions = new AwsInfo(serverless);

      expect(awsInfoWithEmptyOptions.options).to.deep.equal({});
    });

    it('should run promise chain in order for "info:info" hook', async () =>
      awsInfo.hooks['info:info']().then(() => {
        expect(validateStub.calledOnce).to.equal(true);
        expect(getStackInfoStub.calledAfter(validateStub)).to.equal(true);
        expect(getResourceCountStub.calledAfter(getStackInfoStub)).to.equal(true);
        expect(displayServiceInfoStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
        expect(displayApiKeysStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
        expect(displayEndpointsStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
        expect(displayFunctionsStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
        expect(displayLayersStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
        expect(displayStackOutputsStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
      }));

    describe('when running "deploy:deploy" hook', () => {
      it('should run promise chain in order if no deploy is not set', async () =>
        awsInfo.hooks['deploy:deploy']().then(() => {
          expect(validateStub.calledOnce).to.equal(true);
          expect(getStackInfoStub.calledAfter(validateStub)).to.equal(true);
          expect(getResourceCountStub.calledAfter(getStackInfoStub)).to.equal(true);
          expect(displayServiceInfoStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
          expect(displayApiKeysStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
          expect(displayEndpointsStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
          expect(displayFunctionsStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
          expect(displayLayersStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
          expect(displayStackOutputsStub.calledAfter(getApiKeyValuesStub)).to.equal(true);
        }));
    });
  });
});
