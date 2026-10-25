'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const logEmitter = require('log/lib/emitter');
const { UpdateTerminationProtectionCommand } = require('@aws-sdk/client-cloudformation');
const AwsDeletionProtection = require('../../../../../lib/plugins/aws/deletion-protection');
const ServerlessError = require('../../../../../lib/serverless-error');
const { retryOnThrottlingError } = require('../../../../../lib/aws/retry');

const fastRetry = {
  retryOnThrottlingError: (task, options) =>
    retryOnThrottlingError(task, { ...options, delayMs: 1 }),
};
const createThrottlingError = () =>
  Object.assign(new Error('Rate exceeded'), { name: 'Throttling' });
const AwsDeletionProtectionWithFastRetry = proxyquire(
  '../../../../../lib/plugins/aws/deletion-protection',
  { '../../aws/retry': fastRetry }
);

describe('AwsDeletionProtection', () => {
  let serverless;
  let provider;
  let awsDeletionProtection;

  const collectLogEvents = async (fn) => {
    const logEvents = [];
    const listener = (event) => logEvents.push(event);
    logEmitter.on('log', listener);
    try {
      await fn();
    } finally {
      logEmitter.off('log', listener);
    }
    return logEvents;
  };

  beforeEach(() => {
    const options = { stage: 'dev', region: 'us-east-1' };
    provider = {
      getStage: sinon.stub().returns('dev'),
      getAwsSdkV3Config: sinon.stub().resolves({}),
      naming: { getStackName: sinon.stub().returns('service-dev') },
    };
    serverless = {
      service: {
        provider: { name: 'aws' },
      },
      getProvider: sinon.stub().withArgs('aws').returns(provider),
    };
    awsDeletionProtection = new AwsDeletionProtection(serverless, options);
  });

  afterEach(() => sinon.restore());

  describe('#constructor()', () => {
    it('should only hook the deploy lifecycle', () => {
      expect(Object.keys(awsDeletionProtection.hooks)).to.deep.equal([
        'before:deploy:deploy',
        'after:deploy:deploy',
      ]);
      expect(awsDeletionProtection.hooks['before:deploy:deploy']).to.be.a('function');
      expect(awsDeletionProtection.hooks['after:deploy:deploy']).to.be.a('function');
    });
  });

  describe('#resolveDeletionProtection()', () => {
    it('should return null when not configured', () => {
      expect(awsDeletionProtection.resolveDeletionProtection()).to.equal(null);
    });

    it('should enable for true', () => {
      serverless.service.provider.deletionProtection = true;
      expect(awsDeletionProtection.resolveDeletionProtection()).to.deep.equal({ enabled: true });
    });

    it('should disable for false', () => {
      serverless.service.provider.deletionProtection = false;
      expect(awsDeletionProtection.resolveDeletionProtection()).to.deep.equal({ enabled: false });
    });

    it('should enable when the current stage is listed', () => {
      serverless.service.provider.deletionProtection = { stages: ['dev', 'prod'] };
      expect(awsDeletionProtection.resolveDeletionProtection()).to.deep.equal({ enabled: true });
      expect(provider.getStage).to.have.been.called;
    });

    it('should disable when the current stage is not listed', () => {
      serverless.service.provider.deletionProtection = { stages: ['prod'] };
      expect(awsDeletionProtection.resolveDeletionProtection()).to.deep.equal({ enabled: false });
    });

    for (const [description, deletionProtection] of [
      ['an empty object', {}],
      ['an empty stages list', { stages: [] }],
      ['a string stages value', { stages: 'prod' }],
      ['a null stages value', { stages: null }],
      ['an object stages value', { stages: {} }],
      ['a non-string stage', { stages: ['prod', 1] }],
      ['an array', ['prod']],
      ['a string', 'prod'],
      ['a number', 1],
    ]) {
      it(`should throw for ${description}`, () => {
        serverless.service.provider.deletionProtection = deletionProtection;
        expect(() => awsDeletionProtection.resolveDeletionProtection())
          .to.throw(ServerlessError)
          .with.property('code', 'INVALID_DELETION_PROTECTION_CONFIG');
      });
    }
  });

  describe('#validateConfiguration()', () => {
    it('should not throw when not configured', () => {
      expect(() => awsDeletionProtection.validateConfiguration()).to.not.throw();
    });

    it('should not throw for a valid stages list', () => {
      serverless.service.provider.deletionProtection = { stages: ['prod'] };
      expect(() => awsDeletionProtection.validateConfiguration()).to.not.throw();
    });

    it('should throw for an invalid configuration', () => {
      serverless.service.provider.deletionProtection = { stages: [] };
      expect(() => awsDeletionProtection.validateConfiguration())
        .to.throw(ServerlessError)
        .with.property('code', 'INVALID_DELETION_PROTECTION_CONFIG');
    });

    it('should not call AWS', () => {
      serverless.service.provider.deletionProtection = true;
      awsDeletionProtection.validateConfiguration();
      expect(provider.getAwsSdkV3Config).to.not.have.been.called;
    });
  });

  describe('#postDeploy()', () => {
    let send;

    beforeEach(() => {
      send = sinon.stub().resolves({});
      sinon.stub(awsDeletionProtection, 'getCloudFormationClient').resolves({ send });
    });

    it('should do nothing when not configured', async () => {
      await awsDeletionProtection.postDeploy();
      expect(awsDeletionProtection.getCloudFormationClient).to.not.have.been.called;
      expect(send).to.not.have.been.called;
    });

    it('should enable protection on the stack', async () => {
      serverless.service.provider.deletionProtection = true;
      await awsDeletionProtection.postDeploy();
      expect(send).to.have.been.calledOnce;
      expect(send.firstCall.args[0]).to.be.instanceOf(UpdateTerminationProtectionCommand);
      expect(send.firstCall.args[0].input).to.deep.equal({
        StackName: 'service-dev',
        EnableTerminationProtection: true,
      });
    });

    it('should retry the termination protection update on throttling errors', async () => {
      serverless.service.provider.deletionProtection = true;
      const retryingSend = sinon.stub();
      retryingSend.onFirstCall().rejects(createThrottlingError());
      retryingSend.onSecondCall().resolves({});
      const awsDeletionProtectionWithFastRetry = new AwsDeletionProtectionWithFastRetry(
        serverless,
        { stage: 'dev', region: 'us-east-1' }
      );
      sinon
        .stub(awsDeletionProtectionWithFastRetry, 'getCloudFormationClient')
        .resolves({ send: retryingSend });

      await awsDeletionProtectionWithFastRetry.postDeploy();

      expect(retryingSend).to.have.been.calledTwice;
      expect(retryingSend.secondCall.args[0]).to.be.instanceOf(UpdateTerminationProtectionCommand);
    });

    it('should disable protection when the stage is not listed', async () => {
      serverless.service.provider.deletionProtection = { stages: ['prod'] };
      await awsDeletionProtection.postDeploy();
      expect(send).to.have.been.calledOnce;
      expect(send.firstCall.args[0].input).to.deep.equal({
        StackName: 'service-dev',
        EnableTerminationProtection: false,
      });
    });

    it('should skip a stack that was not created because of an empty change set', async () => {
      serverless.service.provider.deletionProtection = true;
      provider.didCreateService = true;
      serverless.service.provider.deploymentWithEmptyChangeSet = true;

      const logEvents = await collectLogEvents(() => awsDeletionProtection.postDeploy());

      expect(send).to.not.have.been.called;
      const infoMessages = logEvents
        .filter((event) => event.logger.level === 'info')
        .map((event) => event.messageTokens[0]);
      expect(infoMessages).to.include(
        'Skipping deletion protection update as the stack has not been created'
      );
    });

    it('should still reconcile a subsequent deploy with an empty change set', async () => {
      serverless.service.provider.deletionProtection = true;
      serverless.service.provider.deploymentWithEmptyChangeSet = true;
      await awsDeletionProtection.postDeploy();
      expect(send).to.have.been.calledOnce;
    });

    it('should still reconcile a freshly created stack', async () => {
      serverless.service.provider.deletionProtection = true;
      provider.didCreateService = true;
      await awsDeletionProtection.postDeploy();
      expect(send).to.have.been.calledOnce;
    });

    it('should log the applied state', async () => {
      serverless.service.provider.deletionProtection = true;

      const logEvents = await collectLogEvents(() => awsDeletionProtection.postDeploy());

      const infoMessages = logEvents
        .filter((event) => event.logger.level === 'info')
        .map((event) => event.messageTokens[0]);
      expect(infoMessages).to.include('Enabled deletion protection for stack "service-dev"');
    });

    it('should wrap AWS failures', async () => {
      serverless.service.provider.deletionProtection = true;
      const awsError = Object.assign(
        new Error('User is not authorized to perform: cloudformation:UpdateTerminationProtection'),
        { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }
      );
      send.rejects(awsError);

      await expect(awsDeletionProtection.postDeploy())
        .to.eventually.be.rejectedWith(ServerlessError)
        .and.satisfy((error) => {
          expect(error.code).to.equal('AWS_CLOUDFORMATION_DELETION_PROTECTION_UPDATE_FAILED');
          expect(error.message).to.include('service-dev');
          expect(error.message).to.include(
            'User is not authorized to perform: cloudformation:UpdateTerminationProtection'
          );
          expect(error.cause).to.equal(awsError);
          return true;
        });
    });

    it('should throw on invalid configuration before calling AWS', async () => {
      serverless.service.provider.deletionProtection = { stages: [] };

      await expect(awsDeletionProtection.postDeploy())
        .to.eventually.be.rejectedWith(ServerlessError)
        .and.have.property('code', 'INVALID_DELETION_PROTECTION_CONFIG');
      expect(awsDeletionProtection.getCloudFormationClient).to.not.have.been.called;
    });
  });

  describe('#getCloudFormationClient()', () => {
    it('should reuse the client promise', async () => {
      const first = await awsDeletionProtection.getCloudFormationClient();
      const second = await awsDeletionProtection.getCloudFormationClient();
      expect(first).to.equal(second);
      expect(provider.getAwsSdkV3Config).to.have.been.calledOnce;
    });
  });
});
