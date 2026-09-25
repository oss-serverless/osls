'use strict';

const runServerless = require('../../../../utils/run-serverless');
const AwsProvider = require('../../../../../lib/plugins/aws/provider');
const AwsRollback = require('../../../../../lib/plugins/aws/rollback');
const Serverless = require('../../../../../lib/serverless');
const chai = require('chai');
const assert = require('chai').assert;
const sinon = require('sinon');
const logEmitter = require('log/lib/emitter');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');

const expect = chai.expect;

describe('AwsRollback', () => {
  let awsRollback;
  let s3Key;
  let spawnStub;
  let serverless;
  let provider;
  let s3SendStub;
  const selectedDeploymentDirectory = '1476779096930-2016-10-18T08:24:56.930Z';

  const createInstance = (options) => {
    if (serverless && serverless.pluginManager.spawn.restore) {
      serverless.pluginManager.spawn.restore();
    }
    if (S3Client.prototype.send.restore) S3Client.prototype.send.restore();
    serverless = new Serverless({ commands: [], options: {} });
    provider = new AwsProvider(serverless, options);
    serverless.setProvider('aws', provider);
    serverless.service.service = 'rollback';

    spawnStub = sinon.stub(serverless.pluginManager, 'spawn');

    awsRollback = new AwsRollback(serverless, options);
    awsRollback.serverless.cli = new serverless.classes.CLI();
    const prefix = provider.getDeploymentPrefix();
    s3Key = `${prefix}/${serverless.service.service}/${provider.getStage()}`;
    s3SendStub = sinon.stub(S3Client.prototype, 'send');
  };

  beforeEach(() =>
    createInstance({
      stage: 'dev',
      region: 'us-east-1',
      timestamp: 1476779096930,
    })
  );

  afterEach(() => {
    if (S3Client.prototype.send.restore) S3Client.prototype.send.restore();
    serverless.pluginManager.spawn.restore();
  });

  function expectListObjectsCall(call, input) {
    expect(call.args[0]).to.be.instanceOf(ListObjectsV2Command);
    expect(call.args[0].input).to.include(input);
  }

  function stubSelectedDeploymentList() {
    s3SendStub.onFirstCall().resolves({
      Contents: [
        {
          Key: `${s3Key}/${selectedDeploymentDirectory}/compiled-cloudformation-template.json`,
        },
      ],
    });
  }

  function expectGetStateFileCall(call) {
    expect(call.args[0]).to.be.instanceOf(GetObjectCommand);
    expect(call.args[0].input).to.deep.equal({
      Bucket: awsRollback.bucketName,
      Key: 'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z/serverless-state.json',
    });
  }

  function readableState(state) {
    return Readable.from([JSON.stringify(state)]);
  }

  async function expectSetStackToUpdateToRejectWith(expectedError) {
    try {
      await awsRollback.setStackToUpdate();
    } catch (error) {
      expect(error).to.equal(expectedError);
      return;
    }

    throw new Error('Expected setStackToUpdate to reject');
  }

  const createSignatureMismatchListError = () => {
    return Object.assign(new Error('signature mismatch'), {
      name: 'SignatureDoesNotMatch',
      $metadata: { httpStatusCode: 403 },
    });
  };

  const createAccessDeniedListError = () => {
    return Object.assign(new Error('access denied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
  };

  const createStatusOnlyListError = () => {
    return Object.assign(new Error('forbidden'), {
      $metadata: { httpStatusCode: 403 },
    });
  };

  describe('#constructor()', () => {
    it('should have hooks', () => expect(awsRollback.hooks).to.be.not.empty);

    it('should set the provider variable to an instance of AwsProvider', () =>
      expect(awsRollback.provider).to.be.instanceof(AwsProvider));
  });

  describe('hooks', () => {
    it('should run "before:rollback:initialize" hook promise chain in order', async () => {
      const validateStub = sinon.stub(awsRollback, 'validate').resolves();

      return awsRollback.hooks['before:rollback:initialize']().then(() => {
        expect(validateStub.calledOnce).to.be.equal(true);
      });
    });

    it('should run "rollback:rollback" promise chain in order', async () => {
      const setBucketNameStub = sinon.stub(awsRollback, 'setBucketName').resolves();
      const setStackToUpdateStub = sinon.stub(awsRollback, 'setStackToUpdate').resolves();
      const updateStackStub = sinon.stub(awsRollback, 'updateStack').resolves();

      return awsRollback.hooks['rollback:rollback']().then(() => {
        expect(setBucketNameStub.calledOnce).to.be.equal(true);
        expect(setStackToUpdateStub.calledAfter(setBucketNameStub)).to.be.equal(true);
        expect(updateStackStub.calledAfter(setStackToUpdateStub)).to.be.equal(true);
      });
    });

    it('should run "deploy:list" if timestamp is not specified', async () => {
      const spawnDeployListStub = spawnStub.withArgs('deploy:list').resolves();
      awsRollback.options.timestamp = undefined;

      return awsRollback.hooks['rollback:rollback']().then(() => {
        expect(spawnDeployListStub.calledOnce).to.be.equal(true);
      });
    });
  });

  describe('#setStackToUpdate()', () => {
    it('should resolve when the timestamp argument is passed as a string', async () => {
      createInstance({
        stage: 'dev',
        region: 'us-east-1',
        timestamp: '1476779096930',
      });

      const s3Objects = [
        {
          Key: 'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z/compiled-cloudformation-template.json',
        },
        {
          Key: 'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z/test.zip',
        },
      ];
      const s3Response = {
        Contents: s3Objects,
      };

      s3SendStub.onFirstCall().resolves(s3Response).onSecondCall().resolves({ Body: '{}' });

      return awsRollback.setStackToUpdate().then(() => {
        expect(awsRollback.serverless.service.package.artifactDirectoryName).to.be.equal(
          'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z'
        );
      });
    });

    it('should reject in case no deployments are available', async () => {
      const s3Response = {
        Contents: [],
      };
      s3SendStub.resolves(s3Response);

      return awsRollback
        .setStackToUpdate()
        .then(() => {
          assert.isNotOk(true, 'setStackToUpdate should not resolve');
        })
        .catch((error) => {
          expect(error.code).to.equal('ROLLBACK_DEPLOYMENTS_NOT_FOUND');
          expect(s3SendStub.calledOnce).to.be.equal(true);
          expectListObjectsCall(s3SendStub.firstCall, {
            Bucket: awsRollback.bucketName,
            Prefix: `${s3Key}/`,
          });
        });
    });

    it('should reject in case this specific deployments is not available', async () => {
      const s3Objects = [
        {
          Key: 'serverless/rollback/dev/2000000000000-2016-10-18T08:24:56.930Z/compiled-cloudformation-template.json',
        },
        {
          Key: 'serverless/rollback/dev/2000000000000-2016-10-18T08:24:56.930Z/test.zip',
        },
      ];
      const s3Response = {
        Contents: s3Objects,
      };

      s3SendStub.resolves(s3Response);

      return awsRollback
        .setStackToUpdate()
        .then(() => {
          assert.isNotOk(true, 'setStackToUpdate should not resolve');
        })
        .catch((error) => {
          expect(error.code).to.equal('ROLLBACK_DEPLOYMENT_NOT_FOUND');
          expect(s3SendStub.calledOnce).to.be.equal(true);
          expectListObjectsCall(s3SendStub.firstCall, {
            Bucket: awsRollback.bucketName,
            Prefix: `${s3Key}/`,
          });
        });
    });

    it('should resolve set the artifactDirectoryName and resolve', async () => {
      const s3Objects = [
        {
          Key: 'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z/compiled-cloudformation-template.json',
        },
        {
          Key: 'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z/test.zip',
        },
      ];
      const s3Response = {
        Contents: s3Objects,
      };

      s3SendStub.onFirstCall().resolves(s3Response).onSecondCall().resolves({ Body: '{}' });

      return awsRollback.setStackToUpdate().then(() => {
        expect(awsRollback.serverless.service.package.artifactDirectoryName).to.be.equal(
          'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z'
        );
        expectListObjectsCall(s3SendStub.firstCall, {
          Bucket: awsRollback.bucketName,
          Prefix: `${s3Key}/`,
        });
      });
    });

    it('should resolve when the target deployment is found on a later S3 page', async () => {
      s3SendStub
        .onFirstCall()
        .resolves({
          Contents: [],
          NextContinuationToken: 'next-page',
        })
        .onSecondCall()
        .resolves({
          Contents: [
            {
              Key: 'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z/compiled-cloudformation-template.json',
            },
          ],
        });
      s3SendStub.onThirdCall().resolves({ Body: '{}' });

      await awsRollback.setStackToUpdate();

      expect(awsRollback.serverless.service.package.artifactDirectoryName).to.equal(
        'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z'
      );
      expectListObjectsCall(s3SendStub.secondCall, {
        Bucket: awsRollback.bucketName,
        Prefix: `${s3Key}/`,
        ContinuationToken: 'next-page',
      });
    });

    it('should not rewrite specific S3 list authentication failures', async () => {
      const listError = createSignatureMismatchListError();
      s3SendStub.rejects(listError);

      try {
        await awsRollback.setStackToUpdate();
        throw new Error('Expected setStackToUpdate to reject');
      } catch (error) {
        expect(error).to.equal(listError);
      }
    });

    it('should rewrite explicit S3 list access denied failures', async () => {
      const listError = createAccessDeniedListError();
      s3SendStub.rejects(listError);

      await expect(awsRollback.setStackToUpdate()).to.be.eventually.rejected.and.have.property(
        'code',
        'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED'
      );
    });

    it('should rewrite status-only S3 list access denied failures', async () => {
      const listError = createStatusOnlyListError();
      s3SendStub.rejects(listError);

      await expect(awsRollback.setStackToUpdate()).to.be.eventually.rejected.and.have.property(
        'code',
        'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED'
      );
    });

    it('should read the state file for the selected deployment', async () => {
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().resolves({
        Body: readableState({ service: { service: 'rollback' } }),
      });

      await awsRollback.setStackToUpdate();

      expect(s3SendStub.secondCall.args[0]).to.be.instanceOf(GetObjectCommand);
      expect(s3SendStub.secondCall.args[0].input).to.deep.equal({
        Bucket: awsRollback.bucketName,
        Key: 'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z/serverless-state.json',
      });
    });

    it('uses an existing S3 client promise when resolving rollback deployment state', async () => {
      const s3 = new S3Client({});
      const send = sinon.stub().callsFake(async (command) => {
        if (command instanceof ListObjectsV2Command) {
          return {
            Contents: [
              {
                Key: 'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z/compiled-cloudformation-template.json',
              },
            ],
          };
        }
        if (command instanceof GetObjectCommand) return { Body: readableState({}) };
        throw new Error(`Unexpected S3 command ${command.constructor.name}`);
      });
      const getAwsSdkV3ConfigStub = sinon
        .stub(awsRollback.provider, 'getAwsSdkV3Config')
        .throws(new Error('Expected existing S3 client to be reused'));
      s3.send = send;
      awsRollback.s3ClientPromise = Promise.resolve(s3);

      try {
        await awsRollback.setStackToUpdate();

        expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
        expect(send).to.have.been.calledTwice;
        expectListObjectsCall(send.firstCall, {
          Bucket: awsRollback.bucketName,
          Prefix: `${s3Key}/`,
        });
        expectGetStateFileCall(send.secondCall);
        expect(awsRollback.serverless.service.package.artifactDirectoryName).to.equal(
          'serverless/rollback/dev/1476779096930-2016-10-18T08:24:56.930Z'
        );
      } finally {
        getAwsSdkV3ConfigStub.restore();
      }
    });

    it('should continue when the selected deployment has no state file', async () => {
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().rejects(
        Object.assign(new Error('The specified key does not exist.'), {
          name: 'NoSuchKey',
          $metadata: { httpStatusCode: 404 },
        })
      );

      await expect(awsRollback.setStackToUpdate()).to.eventually.be.fulfilled;
      expectGetStateFileCall(s3SendStub.secondCall);
    });

    it('should continue when legacy providerError reports missing state file', async () => {
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().rejects(
        Object.assign(new Error('The specified key does not exist.'), {
          providerError: { code: 'NoSuchKey', statusCode: 404 },
        })
      );

      await expect(awsRollback.setStackToUpdate()).to.eventually.be.fulfilled;
      expectGetStateFileCall(s3SendStub.secondCall);
    });

    it('should rethrow missing bucket errors when reading the deployment state file', async () => {
      const error = Object.assign(new Error('The specified bucket does not exist.'), {
        name: 'NoSuchBucket',
        $metadata: { httpStatusCode: 404 },
      });
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().rejects(error);

      await expectSetStackToUpdateToRejectWith(error);
    });

    it('should rethrow status-only 404 errors when reading the deployment state file', async () => {
      const error = Object.assign(new Error('not found'), {
        $metadata: { httpStatusCode: 404 },
      });
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().rejects(error);

      await expectSetStackToUpdateToRejectWith(error);
    });

    it('should rethrow access denied errors when reading the deployment state file', async () => {
      const error = Object.assign(new Error('access denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().rejects(error);

      await expectSetStackToUpdateToRejectWith(error);
    });

    it('should reject rollback for unsupported console deployment state', async () => {
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().resolves({
        Body: readableState({ console: true }),
      });

      await expect(awsRollback.setStackToUpdate()).to.be.eventually.rejected.and.have.property(
        'code',
        'CONSOLE_ACTIVATION_MISMATCH_ROLLBACK'
      );
    });

    it('should reject malformed deployment state JSON', async () => {
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().resolves({
        Body: Readable.from(['{not-json']),
      });

      await expect(awsRollback.setStackToUpdate()).to.be.rejectedWith(SyntaxError);
      expectGetStateFileCall(s3SendStub.secondCall);
    });

    it('should reject empty deployment state JSON', async () => {
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().resolves({
        Body: Readable.from([]),
      });

      await expect(awsRollback.setStackToUpdate()).to.be.rejectedWith(SyntaxError);
      expectGetStateFileCall(s3SendStub.secondCall);
    });

    it('should reject empty string deployment state JSON', async () => {
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().resolves({
        Body: '',
      });

      await expect(awsRollback.setStackToUpdate()).to.be.rejectedWith(SyntaxError);
      expectGetStateFileCall(s3SendStub.secondCall);
    });

    it('should not update the stack if deployment state validation fails', async () => {
      sinon.stub(awsRollback, 'setBucketName').callsFake(async () => {
        awsRollback.bucketName = 'deployment-bucket';
      });
      const updateStackStub = sinon.stub(awsRollback, 'updateStack').resolves();
      stubSelectedDeploymentList();
      s3SendStub.onSecondCall().resolves({
        Body: readableState({ console: true }),
      });

      await expect(
        awsRollback.hooks['rollback:rollback']()
      ).to.be.eventually.rejected.and.have.property('code', 'CONSOLE_ACTIVATION_MISMATCH_ROLLBACK');
      expect(updateStackStub).not.to.be.called;
    });
  });
});

describe('test/unit/lib/plugins/aws/rollback.test.js', () => {
  it('Should gently handle error of listing objects from S3 bucket', async () => {
    await expect(
      runServerless({
        fixture: 'function',
        command: 'rollback',
        awsSdkV3StubMap: {
          CloudFormation: {
            describeStacks: {},
            describeStackResource: {
              StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
            },
          },
          STS: {
            getCallerIdentity: {
              ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
              UserId: 'XXXXXXXXXXXXXXXXXXXXX',
              Account: '999999999999',
              Arn: 'arn:aws:iam::999999999999:user/test',
            },
          },
          S3: {
            headObject: () => {},
            headBucket: () => {},
            listObjectsV2: () => {
              const err = new Error('error!');
              err.code = 'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED';
              throw err;
            },
          },
        },
      })
    ).to.eventually.be.rejected.and.have.property('code', 'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED');
  });

  it('does not touch deletion protection', async () => {
    const updateTerminationProtectionStub = sinon.stub().resolves({});
    const updateStackStub = sinon.stub().resolves({});
    const deploymentDirectory = '1476779096930-2016-10-18T08:24:56.930Z';
    const { awsSdkV3Stub } = await runServerless({
      fixture: 'function',
      command: 'rollback',
      options: { timestamp: '1476779096930' },
      configExt: { provider: { deploymentMethod: 'direct', deletionProtection: true } },
      awsSdkV3StubMap: {
        CloudFormation: {
          describeStackResource: {
            StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
          },
          updateStack: updateStackStub,
          updateTerminationProtection: updateTerminationProtectionStub,
          describeStackEvents: {
            StackEvents: [
              {
                EventId: '1e2f3g4h',
                StackName: 'service-dev',
                LogicalResourceId: 'service-dev',
                ResourceType: 'AWS::CloudFormation::Stack',
                Timestamp: new Date(),
                ResourceStatus: 'UPDATE_COMPLETE',
              },
            ],
          },
        },
        STS: {
          getCallerIdentity: {
            ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
            UserId: 'XXXXXXXXXXXXXXXXXXXXX',
            Account: '999999999999',
            Arn: 'arn:aws:iam::999999999999:user/test',
          },
        },
        S3: {
          headObject: () => {},
          headBucket: () => {},
          listObjectsV2: ({ Prefix }) => ({
            Contents: [
              { Key: `${Prefix}${deploymentDirectory}/compiled-cloudformation-template.json` },
              { Key: `${Prefix}${deploymentDirectory}/service.zip` },
            ],
          }),
          getObject: { Body: '{}' },
        },
      },
    });

    expect(updateStackStub).to.have.been.calledOnce;
    const sentMethods = awsSdkV3Stub.sends.map(({ method }) => method);
    expect(sentMethods).to.include('updateStack');
    expect(sentMethods).to.not.include('updateTerminationProtection');
    expect(updateTerminationProtectionStub).not.to.have.been.called;
  });

  it('rolls back in express mode and reports it', async () => {
    const updateStackStub = sinon.stub().resolves({});
    const deploymentDirectory = '1476779096930-2016-10-18T08:24:56.930Z';
    const logEvents = [];
    const listener = (event) => logEvents.push(event);
    logEmitter.on('log', listener);
    try {
      await runServerless({
        fixture: 'function',
        command: 'rollback',
        options: { timestamp: '1476779096930' },
        configExt: { provider: { deploymentMethod: 'direct', deploymentMode: 'express' } },
        awsSdkV3StubMap: {
          CloudFormation: {
            describeStackResource: {
              StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
            },
            updateStack: updateStackStub,
            describeStackEvents: {
              StackEvents: [
                {
                  EventId: '1e2f3g4h',
                  StackName: 'service-dev',
                  LogicalResourceId: 'service-dev',
                  ResourceType: 'AWS::CloudFormation::Stack',
                  Timestamp: new Date(),
                  ResourceStatus: 'UPDATE_COMPLETE',
                },
              ],
            },
          },
          STS: {
            getCallerIdentity: {
              ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
              UserId: 'XXXXXXXXXXXXXXXXXXXXX',
              Account: '999999999999',
              Arn: 'arn:aws:iam::999999999999:user/test',
            },
          },
          S3: {
            headObject: () => {},
            headBucket: () => {},
            listObjectsV2: ({ Prefix }) => ({
              Contents: [
                { Key: `${Prefix}${deploymentDirectory}/compiled-cloudformation-template.json` },
                { Key: `${Prefix}${deploymentDirectory}/service.zip` },
              ],
            }),
            getObject: { Body: '{}' },
          },
        },
      });
    } finally {
      logEmitter.off('log', listener);
    }

    expect(updateStackStub).to.have.been.calledOnce;
    expect(updateStackStub.firstCall.args[0].DeploymentConfig).to.deep.equal({
      Mode: 'EXPRESS',
      DisableRollback: false,
    });
    expect(updateStackStub.firstCall.args[0]).to.not.have.property('DisableRollback');
    const noticeMessages = logEvents
      .filter((event) => event.logger.level === 'notice')
      .map((event) => String(event.messageTokens[0]));
    expect(noticeMessages.join('\n')).to.include('Rolled back with CloudFormation express mode');
  });
});
