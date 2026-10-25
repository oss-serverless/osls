'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const {
  CloudFormationClient,
  DescribeChangeSetCommand,
} = require('@aws-sdk/client-cloudformation');

describe('waitForChangeSetCreation', () => {
  let awsPlugin;
  let sendStub;
  let sleepStub;

  beforeEach(() => {
    sleepStub = sinon.stub().resolves();
    sendStub = sinon.stub(CloudFormationClient.prototype, 'send');

    const waitForChangeSetCreation = proxyquire(
      '../../../../../../lib/plugins/aws/lib/wait-for-change-set-creation',
      {
        '../../../utils/sleep': sleepStub,
      }
    );

    awsPlugin = {
      provider: {
        getAwsSdkV3Config: sinon.stub().resolves({
          region: 'us-east-1',
          credentials: async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' }),
        }),
      },
      ...waitForChangeSetCreation,
    };
  });

  afterEach(() => {
    CloudFormationClient.prototype.send.restore();
  });

  const expectDescribeChangeSetCall = (call) => {
    expect(call.args[0]).to.be.instanceOf(DescribeChangeSetCommand);
    expect(call.args[0].input).to.deep.equal({
      ChangeSetName: 'change-set',
      StackName: 'stack',
    });
  };

  it('passes credential provider unchanged to the CloudFormation client constructor', async () => {
    const credentials = async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' });
    const clientConfigs = [];
    const commands = [];
    class StubCloudFormationClient {
      constructor(config) {
        clientConfigs.push(config);
      }

      async send(command) {
        commands.push(command);
        return { ChangeSetName: 'change-set', Status: 'CREATE_COMPLETE', Changes: [] };
      }
    }
    const waitForChangeSetCreation = proxyquire(
      '../../../../../../lib/plugins/aws/lib/wait-for-change-set-creation',
      {
        '../../../utils/sleep': sleepStub,
        '@aws-sdk/client-cloudformation': {
          CloudFormationClient: StubCloudFormationClient,
          DescribeChangeSetCommand,
        },
      }
    );
    const plugin = {
      provider: {
        getAwsSdkV3Config: sinon.stub().resolves({ region: 'us-west-2', credentials }),
      },
      ...waitForChangeSetCreation,
    };

    await plugin.waitForChangeSetCreation('change-set', 'stack');

    expect(clientConfigs).to.have.length(1);
    expect(clientConfigs[0].region).to.equal('us-west-2');
    expect(clientConfigs[0].credentials).to.equal(credentials);
    expect(commands).to.have.length(1);
    expect(commands[0]).to.be.instanceOf(DescribeChangeSetCommand);
  });

  it('returns a completed change set description', async () => {
    const changeSetDescription = {
      ChangeSetName: 'change-set',
      StackId: 'stack',
      Status: 'CREATE_COMPLETE',
      Changes: [],
    };
    sendStub.resolves(changeSetDescription);

    const result = await awsPlugin.waitForChangeSetCreation('change-set', 'stack');

    expect(result).to.equal(changeSetDescription);
    expect(sendStub).to.have.been.calledOnce;
    expectDescribeChangeSetCall(sendStub.firstCall);
    expect(awsPlugin.provider.getAwsSdkV3Config).to.have.been.calledOnce;
  });

  it('uses an existing CloudFormation client promise from the plugin context', async () => {
    const send = sinon
      .stub()
      .resolves({ ChangeSetName: 'change-set', Status: 'CREATE_COMPLETE', Changes: [] });
    awsPlugin.provider.getAwsSdkV3Config.throws(
      new Error('Expected existing CloudFormation client to be reused')
    );
    awsPlugin.cloudFormationClientPromise = Promise.resolve({ send });

    await awsPlugin.waitForChangeSetCreation('change-set', 'stack');

    expect(awsPlugin.provider.getAwsSdkV3Config).to.not.have.been.called;
    expect(send).to.have.been.calledOnce;
    expect(send.firstCall.args[0]).to.be.instanceOf(DescribeChangeSetCommand);
    expect(send.firstCall.args[0].input).to.deep.equal({
      ChangeSetName: 'change-set',
      StackName: 'stack',
    });
  });

  it('retries pending and in-progress change set descriptions', async () => {
    sendStub
      .onFirstCall()
      .resolves({ ChangeSetName: 'change-set', Status: 'CREATE_PENDING' })
      .onSecondCall()
      .resolves({ ChangeSetName: 'change-set', Status: 'CREATE_IN_PROGRESS' })
      .onThirdCall()
      .resolves({ ChangeSetName: 'change-set', Status: 'CREATE_COMPLETE', Changes: [] });

    const result = await awsPlugin.waitForChangeSetCreation('change-set', 'stack');

    expect(result.Status).to.equal('CREATE_COMPLETE');
    expect(sendStub).to.have.been.calledThrice;
    expect(sleepStub).to.have.been.calledTwice;
    for (const call of sendStub.getCalls()) expectDescribeChangeSetCall(call);
  });

  for (const statusReason of [
    'No updates are to be performed.',
    "The submitted information didn't contain changes.",
  ]) {
    it(`returns an empty change set description for: ${statusReason}`, async () => {
      const changeSetDescription = {
        ChangeSetName: 'change-set',
        Status: 'FAILED',
        StatusReason: statusReason,
      };
      sendStub.resolves(changeSetDescription);

      const result = await awsPlugin.waitForChangeSetCreation('change-set', 'stack');

      expect(result).to.equal(changeSetDescription);
      expect(sendStub).to.have.been.calledOnce;
    });
  }

  it('throws a ServerlessError when change set creation fails', async () => {
    sendStub.resolves({
      ChangeSetName: 'change-set',
      Status: 'FAILED',
      StatusReason: 'Some internal reason',
    });

    await expect(
      awsPlugin.waitForChangeSetCreation('change-set', 'stack')
    ).to.eventually.be.rejected.and.have.property(
      'code',
      'AWS_CLOUD_FORMATION_CHANGE_SET_CREATION_FAILED'
    );
  });

  it('preserves first-page-only DescribeChangeSet behavior', async () => {
    sendStub.resolves({
      ChangeSetName: 'change-set',
      StackId: 'stack',
      Status: 'CREATE_COMPLETE',
      Changes: [],
      NextToken: 'next-page',
    });

    await awsPlugin.waitForChangeSetCreation('change-set', 'stack');

    expect(sendStub).to.have.been.calledOnce;
    expect(sendStub.firstCall.args[0].input).to.not.have.property('NextToken');
  });
});
