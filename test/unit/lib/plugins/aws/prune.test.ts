'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const logEmitter = require('log/lib/emitter');
const { ListVersionsByFunctionCommand } = require('@aws-sdk/client-lambda');
const AwsPrune = require('../../../../../lib/plugins/aws/prune');
const ServerlessError = require('../../../../../lib/serverless-error');
const { retryOnThrottlingError } = require('../../../../../lib/aws/retry');

const fastRetry = {
  retryOnThrottlingError: (task, options) =>
    retryOnThrottlingError(task, { ...options, delayMs: 1 }),
};
const createThrottlingError = () =>
  Object.assign(new Error('Rate exceeded'), { name: 'Throttling' });
const AwsPruneWithFastRetry = proxyquire('../../../../../lib/plugins/aws/prune', {
  '../../aws/retry': fastRetry,
});

describe('AwsPrune', () => {
  let serverless;
  let awsPrune;
  let awsPruneWithFastRetry;

  beforeEach(() => {
    const options = { stage: 'dev', region: 'us-east-1' };
    const provider = { getAwsSdkV3Config: sinon.stub().resolves({}) };
    serverless = {
      service: {
        provider: { name: 'aws', versionFunctions: true },
        functions: {
          FunctionA: { name: 'service-FunctionA' },
          FunctionB: { name: 'service-FunctionB' },
        },
        layers: {
          LayerA: { name: 'layer-LayerA' },
        },
        getAllFunctions() {
          return Object.keys(this.functions);
        },
        getFunction(key) {
          return this.functions[key];
        },
        getAllLayers() {
          return Object.keys(this.layers);
        },
        getLayer(key) {
          return this.layers[key];
        },
      },
      getProvider: sinon.stub().withArgs('aws').returns(provider),
    };
    awsPrune = new AwsPrune(serverless, options);
    awsPruneWithFastRetry = new AwsPruneWithFastRetry(serverless, options);
  });

  afterEach(() => sinon.restore());

  describe('#constructor()', () => {
    it('should define deploy hooks', () => {
      expect(awsPrune.hooks['before:deploy:deploy']).to.be.a('function');
      expect(awsPrune.hooks['after:deploy:deploy']).to.be.a('function');
    });
  });

  describe('#resolvePruneConfig()', () => {
    it('should return null when pruning is not configured', () => {
      expect(awsPrune.resolvePruneConfig()).to.equal(null);
    });

    it('should return the default number when enabled with true', () => {
      serverless.service.provider.pruneFunctionVersions = true;
      expect(awsPrune.resolvePruneConfig()).to.deep.equal({ number: 10 });
    });

    it('should return an explicit number from object configuration', () => {
      serverless.service.provider.pruneFunctionVersions = { number: 20 };
      expect(awsPrune.resolvePruneConfig()).to.deep.equal({ number: 20 });
    });

    it('should return null when explicitly disabled', () => {
      serverless.service.provider.pruneFunctionVersions = false;
      expect(awsPrune.resolvePruneConfig()).to.equal(null);
    });

    it('should throw when number is not numeric', () => {
      serverless.service.provider.pruneFunctionVersions = { number: 'invalid' };
      expect(() => awsPrune.resolvePruneConfig()).to.throw(ServerlessError);
    });

    it('should throw when number is zero', () => {
      serverless.service.provider.pruneFunctionVersions = { number: 0 };
      expect(() => awsPrune.resolvePruneConfig()).to.throw(ServerlessError);
    });

    it('should throw when number is negative', () => {
      serverless.service.provider.pruneFunctionVersions = { number: -1 };
      expect(() => awsPrune.resolvePruneConfig()).to.throw(ServerlessError);
    });

    it('should throw when object configuration has no number', () => {
      serverless.service.provider.pruneFunctionVersions = {};
      expect(() => awsPrune.resolvePruneConfig()).to.throw(ServerlessError);
    });
  });

  describe('#shouldVersionFunction()', () => {
    it('should skip functions with versionFunction set to false', () => {
      serverless.service.functions.FunctionA.versionFunction = false;
      expect(awsPrune.shouldVersionFunction('FunctionA')).to.equal(false);
      expect(awsPrune.shouldVersionFunction('FunctionB')).to.equal(true);
    });

    it('should skip all functions when provider versionFunctions is false', () => {
      serverless.service.provider.versionFunctions = false;
      expect(awsPrune.shouldVersionFunction('FunctionA')).to.equal(false);
    });

    it('should let a per-function versionFunction true override provider false', () => {
      serverless.service.provider.versionFunctions = false;
      serverless.service.functions.FunctionA.versionFunction = true;
      expect(awsPrune.shouldVersionFunction('FunctionA')).to.equal(true);
    });

    it('should skip durable functions', () => {
      serverless.service.functions.FunctionA.versionFunction = true;
      serverless.service.functions.FunctionA.durableConfig = { executionTimeout: 3600 };
      expect(awsPrune.shouldVersionFunction('FunctionA')).to.equal(false);
    });
  });

  describe('#validateConfiguration()', () => {
    it('should throw when versionFunctions is false', () => {
      serverless.service.provider.pruneFunctionVersions = true;
      serverless.service.provider.versionFunctions = false;

      expect(() => awsPrune.validateConfiguration())
        .to.throw(ServerlessError)
        .with.property('code', 'PRUNE_INCOMPATIBLE_WITH_VERSION_FUNCTIONS');
    });

    it('should not throw when only durable functions force versioning', () => {
      serverless.service.provider.pruneFunctionVersions = true;
      serverless.service.provider.versionFunctions = false;
      serverless.service.functions.FunctionA.durableConfig = { executionTimeout: 3600 };
      delete serverless.service.functions.FunctionB;

      expect(() => awsPrune.validateConfiguration()).to.not.throw();
    });

    it('should throw when versionFunctions is false and a non-durable function is prunable', () => {
      serverless.service.provider.pruneFunctionVersions = true;
      serverless.service.provider.versionFunctions = false;
      serverless.service.functions.FunctionA.durableConfig = { executionTimeout: 3600 };
      serverless.service.functions.FunctionB.versionFunction = true;

      expect(() => awsPrune.validateConfiguration())
        .to.throw(ServerlessError)
        .with.property('code', 'PRUNE_INCOMPATIBLE_WITH_VERSION_FUNCTIONS');
    });

    it('should not throw when durable functions are mixed with non-prunable functions', () => {
      serverless.service.provider.pruneFunctionVersions = true;
      serverless.service.provider.versionFunctions = false;
      serverless.service.functions.FunctionA.durableConfig = { executionTimeout: 3600 };

      expect(() => awsPrune.validateConfiguration()).to.not.throw();
    });

    it('should not throw when pruning is disabled', () => {
      serverless.service.provider.versionFunctions = false;
      expect(() => awsPrune.validateConfiguration()).to.not.throw();
    });
  });

  describe('#selectPruneVersionsForFunction()', () => {
    beforeEach(() => {
      serverless.service.provider.pruneFunctionVersions = { number: 2 };
    });

    it('should keep the requested number of newest versions', () => {
      const versions = [{ Version: '1' }, { Version: '2' }, { Version: '3' }, { Version: '4' }];
      const result = awsPrune.selectPruneVersionsForFunction(versions, []);
      expect(result).to.deep.equal(['2', '1']);
    });

    it('should delete only non-$LATEST, non-aliased versions beyond the limit', () => {
      serverless.service.provider.pruneFunctionVersions = { number: 1 };
      const versions = [
        { Version: '$LATEST' },
        { Version: '1' },
        { Version: '2' },
        { Version: '3' },
        { Version: '4' },
        { Version: '5' },
      ];
      const aliases = [{ FunctionVersion: '1' }, { FunctionVersion: '3' }];
      // candidates {2,4,5}; sorted newest-first [5,4,2]; keep 1 newest -> delete [4,2]
      const result = awsPrune.selectPruneVersionsForFunction(versions, aliases);
      expect(result).to.deep.equal(['4', '2']);
    });

    it('should not delete aliased versions when alias version is a number', () => {
      const versions = [{ Version: '1' }, { Version: '2' }, { Version: '3' }, { Version: '4' }];
      const aliases = [{ FunctionVersion: 2 }];
      const result = awsPrune.selectPruneVersionsForFunction(versions, aliases);
      expect(result).to.not.include('2');
    });
  });

  describe('#selectPruneVersionsForLayer()', () => {
    beforeEach(() => {
      serverless.service.provider.pruneFunctionVersions = { number: 2 };
    });

    it('should keep the requested number of newest layer versions', () => {
      const versions = [{ Version: 1 }, { Version: 2 }, { Version: 3 }, { Version: 4 }];
      const result = awsPrune.selectPruneVersionsForLayer(versions);
      expect(result).to.deep.equal([2, 1]);
    });
  });

  describe('#paginateLambda()', () => {
    it('should follow NextMarker and aggregate all pages', async () => {
      const send = sinon.stub();
      send.onFirstCall().resolves({ Versions: [{ Version: '1' }], NextMarker: 'm2' });
      send.onSecondCall().resolves({ Versions: [{ Version: '2' }] });
      sinon.stub(awsPrune, 'getLambdaClient').resolves({ send });

      const result = await awsPrune.paginateLambda(
        ListVersionsByFunctionCommand,
        { FunctionName: 'service-FunctionA' },
        'Versions'
      );

      expect(result).to.deep.equal([{ Version: '1' }, { Version: '2' }]);
      expect(send.callCount).to.equal(2);
      expect(send.firstCall.args[0].input).to.deep.equal({ FunctionName: 'service-FunctionA' });
      expect(send.secondCall.args[0].input).to.deep.equal({
        FunctionName: 'service-FunctionA',
        Marker: 'm2',
      });
    });

    it('should retry throttled list requests', async () => {
      const send = sinon.stub();
      send.onFirstCall().rejects(createThrottlingError());
      send.onSecondCall().resolves({ Versions: [{ Version: '1' }] });
      sinon.stub(awsPruneWithFastRetry, 'getLambdaClient').resolves({ send });

      const result = await awsPruneWithFastRetry.paginateLambda(
        ListVersionsByFunctionCommand,
        { FunctionName: 'service-FunctionA' },
        'Versions',
        'Lambda function versions listing'
      );

      expect(result).to.deep.equal([{ Version: '1' }]);
      expect(send.callCount).to.equal(2);
    });
  });

  describe('list helpers', () => {
    const resourceNotFound = () =>
      Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' });

    it('listVersionsForFunction should return [] on ResourceNotFound', async () => {
      sinon
        .stub(awsPrune, 'getLambdaClient')
        .resolves({ send: sinon.stub().rejects(resourceNotFound()) });
      expect(await awsPrune.listVersionsForFunction('service-FunctionA')).to.deep.equal([]);
    });

    it('listAliasesForFunction should return [] on ResourceNotFound', async () => {
      sinon
        .stub(awsPrune, 'getLambdaClient')
        .resolves({ send: sinon.stub().rejects(resourceNotFound()) });
      expect(await awsPrune.listAliasesForFunction('service-FunctionA')).to.deep.equal([]);
    });

    it('listVersionsForLayer should return [] on ResourceNotFound', async () => {
      sinon
        .stub(awsPrune, 'getLambdaClient')
        .resolves({ send: sinon.stub().rejects(resourceNotFound()) });
      expect(await awsPrune.listVersionsForLayer('layer-LayerA')).to.deep.equal([]);
    });

    it('should rethrow non-ResourceNotFound list errors', async () => {
      const error = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
      sinon.stub(awsPrune, 'getLambdaClient').resolves({ send: sinon.stub().rejects(error) });
      await expect(awsPrune.listVersionsForFunction('service-FunctionA')).to.be.rejectedWith(
        'denied'
      );
    });
  });

  describe('#deleteVersionsForFunction()', () => {
    it('should call DeleteFunction with the right qualifier and count deletions', async () => {
      const send = sinon.stub().resolves({});
      sinon.stub(awsPrune, 'getLambdaClient').resolves({ send });

      const deleted = await awsPrune.deleteVersionsForFunction('service-FunctionA', ['3', '2']);

      expect(deleted).to.equal(2);
      expect(send.firstCall.args[0].input).to.deep.equal({
        FunctionName: 'service-FunctionA',
        Qualifier: '3',
      });
    });

    it('should retry throttled delete requests', async () => {
      const send = sinon.stub();
      send.onFirstCall().rejects(createThrottlingError());
      send.onSecondCall().resolves({});
      sinon.stub(awsPruneWithFastRetry, 'getLambdaClient').resolves({ send });

      const deleted = await awsPruneWithFastRetry.deleteVersionsForFunction('service-FunctionA', [
        '3',
      ]);

      expect(deleted).to.equal(1);
      expect(send.callCount).to.equal(2);
    });

    it('should swallow the replicated-function error and continue', async () => {
      const replicated = Object.assign(
        new Error(
          'Lambda was unable to delete arn:aws:lambda:us-east-1:1:function:service-FunctionA:7 because it is a replicated function.'
        ),
        { $metadata: { httpStatusCode: 400 } }
      );
      const send = sinon.stub();
      send.onFirstCall().rejects(replicated);
      send.onSecondCall().resolves({});
      sinon.stub(awsPrune, 'getLambdaClient').resolves({ send });

      const deleted = await awsPrune.deleteVersionsForFunction('service-FunctionA', ['7', '6']);

      expect(deleted).to.equal(1);
    });

    it('should rethrow non-replicated delete errors', async () => {
      const error = Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } });
      sinon.stub(awsPrune, 'getLambdaClient').resolves({ send: sinon.stub().rejects(error) });

      await expect(
        awsPrune.deleteVersionsForFunction('service-FunctionA', ['6'])
      ).to.be.rejectedWith('boom');
    });
  });

  describe('#deleteVersionsForLayer()', () => {
    it('should call DeleteLayerVersion with the right version number and count deletions', async () => {
      const send = sinon.stub().resolves({});
      sinon.stub(awsPrune, 'getLambdaClient').resolves({ send });

      const deleted = await awsPrune.deleteVersionsForLayer('layer-LayerA', [3, 2]);

      expect(deleted).to.equal(2);
      expect(send.firstCall.args[0].input).to.deep.equal({
        LayerName: 'layer-LayerA',
        VersionNumber: 3,
      });
    });

    it('should retry throttled delete requests', async () => {
      const send = sinon.stub();
      send.onFirstCall().rejects(createThrottlingError());
      send.onSecondCall().resolves({});
      sinon.stub(awsPruneWithFastRetry, 'getLambdaClient').resolves({ send });

      const deleted = await awsPruneWithFastRetry.deleteVersionsForLayer('layer-LayerA', [3]);

      expect(deleted).to.equal(1);
      expect(send.callCount).to.equal(2);
    });
  });

  describe('#pruneFunctions()', () => {
    let listVersionsStub;
    let listAliasesStub;
    let deleteStub;

    beforeEach(() => {
      serverless.service.provider.pruneFunctionVersions = { number: 2 };
      listVersionsStub = sinon.stub(awsPrune, 'listVersionsForFunction');
      listAliasesStub = sinon.stub(awsPrune, 'listAliasesForFunction');
      deleteStub = sinon.stub(awsPrune, 'deleteVersionsForFunction').resolves();
    });

    it('should delete old versions of functions', async () => {
      listVersionsStub.resolves([
        { Version: '1' },
        { Version: '2' },
        { Version: '3' },
        { Version: '4' },
        { Version: '5' },
      ]);
      listAliasesStub.resolves([]);

      await awsPrune.pruneFunctions();

      expect(deleteStub.callCount).to.equal(2);
      expect(deleteStub.getCall(0).args).to.deep.equal(['service-FunctionA', ['3', '2', '1']]);
      expect(deleteStub.getCall(1).args).to.deep.equal(['service-FunctionB', ['3', '2', '1']]);
    });

    it('should skip functions with versionFunction set to false', async () => {
      serverless.service.functions.FunctionA.versionFunction = false;
      listVersionsStub.resolves([{ Version: '1' }, { Version: '2' }, { Version: '3' }]);
      listAliasesStub.resolves([]);

      await awsPrune.pruneFunctions();

      expect(deleteStub.calledOnce).to.equal(true);
      expect(deleteStub.firstCall.args[0]).to.equal('service-FunctionB');
    });

    it('should log a verbose skip notice for durable functions', async () => {
      serverless.service.functions.FunctionA.durableConfig = { executionTimeout: 3600 };
      serverless.service.functions.FunctionB.versionFunction = false;
      const logEvents = [];
      const listener = (event) => logEvents.push(event);
      logEmitter.on('log', listener);

      try {
        await awsPrune.pruneFunctions();
      } finally {
        logEmitter.off('log', listener);
      }

      const infoMessages = logEvents
        .filter((event) => event.logger.level === 'info')
        .map((event) => event.messageTokens[0]);
      expect(infoMessages).to.include(
        'Skipped pruning 1 durable function; retained versions may be needed for durable execution replay.'
      );
    });
  });

  describe('#pruneLayers()', () => {
    it('should delete old layer versions using the deployed layer name', async () => {
      serverless.service.provider.pruneFunctionVersions = { number: 2 };
      const listVersionsStub = sinon
        .stub(awsPrune, 'listVersionsForLayer')
        .resolves([{ Version: 1 }, { Version: 2 }, { Version: 3 }, { Version: 4 }]);
      const deleteStub = sinon.stub(awsPrune, 'deleteVersionsForLayer').resolves(2);

      await awsPrune.pruneLayers();

      expect(listVersionsStub.calledOnceWith('layer-LayerA')).to.equal(true);
      expect(deleteStub.calledOnce).to.equal(true);
      expect(deleteStub.firstCall.args).to.deep.equal(['layer-LayerA', [2, 1]]);
    });
  });

  describe('#postDeploy()', () => {
    it('should prune functions and layers when enabled', async () => {
      serverless.service.provider.pruneFunctionVersions = true;
      const pruneFunctionsStub = sinon.stub(awsPrune, 'pruneFunctions').resolves();
      const pruneLayersStub = sinon.stub(awsPrune, 'pruneLayers').resolves();

      await awsPrune.postDeploy();

      expect(pruneFunctionsStub.calledOnce).to.equal(true);
      expect(pruneLayersStub.calledOnce).to.equal(true);
    });

    it('should not prune when disabled', async () => {
      const pruneFunctionsStub = sinon.stub(awsPrune, 'pruneFunctions').resolves();
      const pruneLayersStub = sinon.stub(awsPrune, 'pruneLayers').resolves();

      await awsPrune.postDeploy();

      expect(pruneFunctionsStub.called).to.equal(false);
      expect(pruneLayersStub.called).to.equal(false);
    });

    it('should prune only layers when only durable functions force versioning', async () => {
      serverless.service.provider.pruneFunctionVersions = { number: 2 };
      serverless.service.provider.versionFunctions = false;
      serverless.service.functions.FunctionA.durableConfig = { executionTimeout: 3600 };
      delete serverless.service.functions.FunctionB;
      const listFunctionVersionsStub = sinon.stub(awsPrune, 'listVersionsForFunction').resolves([]);
      const listFunctionAliasesStub = sinon.stub(awsPrune, 'listAliasesForFunction').resolves([]);
      const deleteFunctionVersionsStub = sinon
        .stub(awsPrune, 'deleteVersionsForFunction')
        .resolves(0);
      const listLayerVersionsStub = sinon
        .stub(awsPrune, 'listVersionsForLayer')
        .resolves([{ Version: 1 }, { Version: 2 }, { Version: 3 }, { Version: 4 }]);
      const deleteLayerVersionsStub = sinon.stub(awsPrune, 'deleteVersionsForLayer').resolves(2);

      await awsPrune.postDeploy();

      expect(listFunctionVersionsStub.called).to.equal(false);
      expect(listFunctionAliasesStub.called).to.equal(false);
      expect(deleteFunctionVersionsStub.called).to.equal(false);
      expect(listLayerVersionsStub.calledOnceWith('layer-LayerA')).to.equal(true);
      expect(deleteLayerVersionsStub.firstCall.args).to.deep.equal(['layer-LayerA', [2, 1]]);
    });
  });
});
