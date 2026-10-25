'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { CloudFormationClient, SetStackPolicyCommand } = require('@aws-sdk/client-cloudformation');
const { retryOnThrottlingError } = require('../../../../../../lib/aws/retry');

const fastRetry = {
  retryOnThrottlingError: (task, options) =>
    retryOnThrottlingError(task, { ...options, delayMs: 1 }),
};
const createThrottlingError = () =>
  Object.assign(new Error('Rate exceeded'), { name: 'Throttling' });

describe('updateStack', () => {
  const stackPolicy = [{ Effect: 'Allow', Principal: '*', Action: 'Update:*', Resource: '*' }];
  let awsPlugin;
  let sendStub;

  beforeEach(() => {
    sendStub = sinon.stub(CloudFormationClient.prototype, 'send').resolves({});
    const updateStack = proxyquire('../../../../../../lib/plugins/aws/lib/update-stack', {
      '../../../aws/retry': fastRetry,
    });

    awsPlugin = {
      bucketName: 'deployment-bucket',
      createLater: false,
      provider: {
        getRegion: () => 'us-east-1',
        getAwsSdkV3Config: sinon.stub().resolves({ region: 'us-east-1' }),
        naming: {
          getStackName: () => 'stack',
          getStackChangeSetName: () => 'change-set',
          getCompiledTemplateS3Suffix: () => 'compiled-cloudformation-template.json',
        },
      },
      serverless: {
        service: {
          provider: { stackPolicy },
          package: { artifactDirectoryName: 'serverless/service/dev/1' },
        },
      },
      getCreateChangeSetParams: () => ({ StackName: 'stack', ChangeSetName: 'change-set' }),
      getExecuteChangeSetParams: () => ({ StackName: 'stack', ChangeSetName: 'change-set' }),
      waitForChangeSetCreation: sinon.stub().resolves({ StackId: 'stack-id', Changes: [{}] }),
      monitorStack: sinon.stub().resolves(),
      ...updateStack,
    };
  });

  afterEach(() => {
    CloudFormationClient.prototype.send.restore();
  });

  it('retries setting the stack policy on throttling errors', async () => {
    sendStub
      .withArgs(sinon.match.instanceOf(SetStackPolicyCommand))
      .onFirstCall()
      .rejects(createThrottlingError())
      .onSecondCall()
      .resolves({});

    await awsPlugin.updateStack();

    const setStackPolicyCalls = sendStub
      .getCalls()
      .filter((call) => call.args[0] instanceof SetStackPolicyCommand);
    expect(setStackPolicyCalls).to.have.length(2);
    expect(setStackPolicyCalls[1].args[0].input).to.deep.equal({
      StackName: 'stack',
      StackPolicyBody: JSON.stringify({ Statement: stackPolicy }),
    });
  });
});
