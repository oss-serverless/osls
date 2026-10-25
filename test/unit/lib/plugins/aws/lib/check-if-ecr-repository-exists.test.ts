'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const { ECRClient, DescribeRepositoriesCommand } = require('@aws-sdk/client-ecr');

describe('test/unit/lib/plugins/aws/lib/check-if-ecr-repository-exists.test.js', () => {
  let context;
  let describeRepositoriesStub;
  let warningStub;

  beforeEach(() => {
    warningStub = sinon.stub();
    const checkIfEcrRepositoryExists = proxyquire
      .noCallThru()
      .load('../../../../../../lib/plugins/aws/lib/check-if-ecr-repository-exists', {
        '../../../utils/serverless-utils/log': { log: { warning: warningStub } },
      });
    context = {
      provider: {
        getAccountId: sinon.stub().resolves('123456789012'),
        getAwsSdkV3Config: sinon
          .stub()
          .resolves({ region: 'us-east-1', credentials: sinon.stub() }),
        naming: {
          getEcrRepositoryName: sinon.stub().returns('repository'),
        },
      },
      serverless: {
        service: {
          provider: {},
        },
      },
      ...checkIfEcrRepositoryExists,
    };
    describeRepositoriesStub = sinon.stub(ECRClient.prototype, 'send');
  });

  afterEach(() => {
    ECRClient.prototype.send.restore();
  });

  it('returns true when repository exists', async () => {
    describeRepositoriesStub.resolves({ repositories: [{ repositoryName: 'repository' }] });

    await expect(context.checkIfEcrRepositoryExists()).to.eventually.equal(true);

    expect(context.provider.getAccountId).to.have.been.calledOnce;
    expect(describeRepositoriesStub.firstCall.args[0]).to.be.instanceOf(
      DescribeRepositoriesCommand
    );
    expect(describeRepositoriesStub.firstCall.args[0].input).to.deep.equal({
      repositoryNames: ['repository'],
      registryId: '123456789012',
    });
  });

  for (const error of [
    { providerError: { code: 'RepositoryNotFoundException' } },
    { name: 'RepositoryNotFoundException' },
  ]) {
    it(`returns false for missing repository shape ${JSON.stringify(error)}`, async () => {
      describeRepositoriesStub.rejects(error);

      await expect(context.checkIfEcrRepositoryExists()).to.eventually.equal(false);
    });
  }

  for (const error of [
    { providerError: { code: 'AccessDeniedException' } },
    { name: 'AccessDeniedException' },
  ]) {
    it(`returns false for access denied shape ${JSON.stringify(error)}`, async () => {
      describeRepositoriesStub.rejects(error);

      await expect(context.checkIfEcrRepositoryExists()).to.eventually.equal(false);
      expect(warningStub).to.not.have.been.called;
    });
  }

  for (const error of [
    { name: 'InvalidSignatureException', $metadata: { httpStatusCode: 403 } },
    { name: 'UnrecognizedClientException', $metadata: { httpStatusCode: 403 } },
    { $metadata: { httpStatusCode: 403 } },
  ]) {
    it(`rethrows non-access-denied 403 ECR error ${JSON.stringify(error)}`, async () => {
      describeRepositoriesStub.rejects(error);

      try {
        await context.checkIfEcrRepositoryExists();
        throw new Error('Expected checkIfEcrRepositoryExists to reject');
      } catch (caughtError) {
        expect(caughtError).to.equal(error);
      }
      expect(warningStub).to.not.have.been.called;
    });
  }

  it('warns on access denied when provider ECR images are configured', async () => {
    context.serverless.service.provider.ecr = { images: { image: { path: './' } } };
    describeRepositoriesStub.rejects({ name: 'AccessDeniedException' });

    await expect(context.checkIfEcrRepositoryExists()).to.eventually.equal(false);

    expect(warningStub).to.have.been.calledOnce;
  });

  it('rethrows unexpected errors', async () => {
    describeRepositoriesStub.rejects(new Error('boom'));

    await expect(context.checkIfEcrRepositoryExists()).to.be.rejectedWith('boom');
  });

  it('reuses one ECR client across repository existence and delete operations', async () => {
    const ecrClients = [];
    const commands = [];
    class FakeCommand {
      constructor(input) {
        this.input = input;
      }
    }
    class FakeDescribeRepositoriesCommand extends FakeCommand {}
    class FakeDeleteRepositoryCommand extends FakeCommand {}
    class FakeECRClient {
      constructor(config) {
        this.config = config;
        ecrClients.push(this);
      }

      async send(command) {
        commands.push(command);
        if (command instanceof FakeDescribeRepositoriesCommand) {
          return { repositories: [{ repositoryName: 'repository' }] };
        }
        if (command instanceof FakeDeleteRepositoryCommand) return {};
        throw new Error(`Unexpected ECR command ${command.constructor.name}`);
      }
    }
    const checkIfEcrRepositoryExists = proxyquire(
      '../../../../../../lib/plugins/aws/lib/check-if-ecr-repository-exists',
      {
        '@aws-sdk/client-ecr': {
          ECRClient: FakeECRClient,
          DescribeRepositoriesCommand: FakeDescribeRepositoriesCommand,
        },
        '../../../utils/serverless-utils/log': { log: { warning: warningStub } },
      }
    );
    const removeEcrRepository = proxyquire('../../../../../../lib/plugins/aws/remove/lib/ecr', {
      '@aws-sdk/client-ecr': {
        ECRClient: FakeECRClient,
        DeleteRepositoryCommand: FakeDeleteRepositoryCommand,
      },
    });
    const sharedContext = {
      provider: {
        getAccountId: sinon.stub().resolves('123456789012'),
        getAwsSdkV3Config: sinon.stub().resolves({ region: 'us-east-1' }),
        naming: {
          getEcrRepositoryName: sinon.stub().returns('repository'),
        },
      },
      serverless: {
        service: {
          provider: {},
        },
      },
      ...checkIfEcrRepositoryExists,
      ...removeEcrRepository,
    };

    await expect(sharedContext.checkIfEcrRepositoryExists()).to.eventually.equal(true);
    await sharedContext.removeEcrRepository();

    expect(ecrClients).to.have.length(1);
    expect(sharedContext.provider.getAwsSdkV3Config).to.have.been.calledOnce;
    expect(commands[0]).to.be.instanceOf(FakeDescribeRepositoriesCommand);
    expect(commands[0].input).to.deep.equal({
      repositoryNames: ['repository'],
      registryId: '123456789012',
    });
    expect(commands[1]).to.be.instanceOf(FakeDeleteRepositoryCommand);
    expect(commands[1].input).to.deep.equal({
      registryId: '123456789012',
      repositoryName: 'repository',
      force: true,
    });
  });
});
