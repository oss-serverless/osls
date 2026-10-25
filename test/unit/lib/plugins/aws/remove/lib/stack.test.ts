'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const logEmitter = require('log/lib/emitter');
const {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
} = require('@aws-sdk/client-cloudformation');
const removeStack = require('../../../../../../../lib/plugins/aws/remove/lib/stack');

describe('removeStack', () => {
  const stackName = 'removeStack-dev';
  const customDeploymentRole = 'arn:aws:iam::123456789012:role/myrole';

  let removeStackStub;

  const createRemoveStackContext = (overrides = {}) => {
    const provider = {
      naming: { getStackName: sinon.stub().returns(stackName) },
      getAwsSdkV3Config: sinon.stub().resolves({ region: 'us-east-1' }),
      getCustomDeploymentRole: sinon.stub().returns(null),
      ...overrides.provider,
    };
    return {
      ...removeStack,
      serverless: { service: { provider: {} } },
      ...overrides,
      provider,
    };
  };

  beforeEach(() => {
    removeStackStub = sinon.stub(CloudFormationClient.prototype, 'send').resolves();
  });

  afterEach(() => {
    CloudFormationClient.prototype.send.restore();
  });

  describe('#ensureStackIsNotDeletionProtected()', () => {
    it('passes when the stack is not deletion protected', async () => {
      removeStackStub.resolves({ Stacks: [{ EnableTerminationProtection: false }] });
      const context = createRemoveStackContext();

      await context.ensureStackIsNotDeletionProtected();

      expect(removeStackStub).to.have.been.calledOnce;
      expect(removeStackStub.firstCall.args[0]).to.be.instanceOf(DescribeStacksCommand);
      expect(removeStackStub.firstCall.args[0].input).to.deep.equal({ StackName: stackName });
    });

    it('fails when the stack is deletion protected', async () => {
      removeStackStub.resolves({ Stacks: [{ EnableTerminationProtection: true }] });
      const context = createRemoveStackContext();

      await expect(context.ensureStackIsNotDeletionProtected())
        .to.eventually.be.rejected.and.have.property(
          'code',
          'AWS_CLOUDFORMATION_DELETION_PROTECTION_ENABLED'
        )
        .and.satisfy(() => true);
      await expect(
        context.ensureStackIsNotDeletionProtected()
      ).to.eventually.be.rejected.and.satisfy((error) => {
        expect(error.message).to.include(`Cannot remove stack "${stackName}"`);
        expect(error.message).to.include('provider.deletionProtection.stages');
        expect(error.message).to.include(
          `update-termination-protection --no-enable-termination-protection --stack-name ${stackName}`
        );
        return true;
      });
    });

    it('passes with a warning when the stack cannot be described', async () => {
      removeStackStub.rejects(
        Object.assign(
          new Error('User is not authorized to perform: cloudformation:DescribeStacks'),
          {
            name: 'AccessDenied',
            $metadata: { httpStatusCode: 403 },
          }
        )
      );
      const context = createRemoveStackContext();
      const logEvents = [];
      const listener = (event) => logEvents.push(event);
      logEmitter.on('log', listener);

      try {
        await context.ensureStackIsNotDeletionProtected();
      } finally {
        logEmitter.off('log', listener);
      }

      const warnings = logEvents
        .filter((event) => event.logger.level === 'warning')
        .map((event) => event.messageTokens[0]);
      expect(warnings).to.have.lengthOf(1);
      expect(warnings[0]).to.include(`Could not check whether stack "${stackName}"`);
      expect(warnings[0]).to.include(
        'User is not authorized to perform: cloudformation:DescribeStacks'
      );
    });

    it('passes when the stack lookup returns no stacks', async () => {
      removeStackStub.resolves({ Stacks: [] });
      const context = createRemoveStackContext();

      await context.ensureStackIsNotDeletionProtected();
    });

    it('passes when the stack does not exist', async () => {
      removeStackStub.throws(
        Object.assign(new Error('Stack with id removeStack-dev does not exist'), {
          name: 'ValidationError',
        })
      );
      const context = createRemoveStackContext();

      await context.ensureStackIsNotDeletionProtected();
    });
  });

  describe('#remove()', () => {
    it('should remove a stack', async () => {
      const context = createRemoveStackContext();

      const result = await context.remove();

      expect(result).to.deep.equal({ StackId: stackName });
      expect(context.provider.getAwsSdkV3Config).to.have.been.calledOnceWithExactly();
      expect(removeStackStub).to.have.been.calledOnce;
      expect(removeStackStub.firstCall.args[0]).to.be.instanceOf(DeleteStackCommand);
      expect(removeStackStub.firstCall.args[0].input).to.deep.equal({ StackName: stackName });
    });

    it('uses an existing CloudFormation client promise from the plugin context', async () => {
      const send = sinon.stub().resolves();
      const context = createRemoveStackContext({
        cloudFormationClientPromise: Promise.resolve({ send }),
        provider: {
          getAwsSdkV3Config: sinon
            .stub()
            .throws(new Error('Expected existing CloudFormation client to be reused')),
        },
      });

      const result = await context.remove();

      expect(result).to.deep.equal({ StackId: stackName });
      expect(context.provider.getAwsSdkV3Config).to.not.have.been.called;
      expect(send).to.have.been.calledOnce;
      expect(send.firstCall.args[0]).to.be.instanceOf(DeleteStackCommand);
      expect(send.firstCall.args[0].input).to.deep.equal({ StackName: stackName });
    });

    it('should use CloudFormation service role if it is specified', async () => {
      const context = createRemoveStackContext({
        provider: {
          getCustomDeploymentRole: sinon.stub().returns(customDeploymentRole),
        },
      });

      await context.remove();

      expect(context.provider.getCustomDeploymentRole).to.have.been.calledOnceWithExactly();
      expect(removeStackStub.firstCall.args[0]).to.be.instanceOf(DeleteStackCommand);
      expect(removeStackStub.firstCall.args[0].input.RoleARN).to.equal(customDeploymentRole);
    });

    it('should delete the stack in express mode when configured', async () => {
      const context = createRemoveStackContext({
        serverless: { service: { provider: { deploymentMode: 'express' } } },
      });

      await context.remove();

      expect(removeStackStub.firstCall.args[0]).to.be.instanceOf(DeleteStackCommand);
      expect(removeStackStub.firstCall.args[0].input).to.deep.equal({
        StackName: stackName,
        DeploymentConfig: { Mode: 'EXPRESS' },
      });
    });
  });

  describe('#removeStack()', () => {
    it('should run promise chain in order', async () => {
      const context = createRemoveStackContext();
      const removeStub = sinon.stub(context, 'remove').resolves();

      await context.removeStack();

      expect(removeStub).to.have.been.calledOnceWithExactly();
    });
  });
});
