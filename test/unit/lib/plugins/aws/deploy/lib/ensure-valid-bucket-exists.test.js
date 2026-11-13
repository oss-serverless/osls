'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const {
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
} = require('@aws-sdk/client-s3');
const { GetTemplateCommand, UpdateStackCommand } = require('@aws-sdk/client-cloudformation');
const ensureValidBucketExists = require('../../../../../../../lib/plugins/aws/deploy/lib/ensure-valid-bucket-exists');

const createCustomBucketContext = (send) => ({
  bucketName: 'deployment-bucket',
  provider: { getRegion: sinon.stub().returns('us-east-1') },
  serverless: { service: { provider: { deploymentBucket: 'deployment-bucket' } } },
  setBucketName: sinon.stub().resolves(),
  s3ClientPromise: Promise.resolve({ send }),
  ...ensureValidBucketExists,
});

const createWebAppContext = (send, { deploymentBucket } = {}) => ({
  bucketName: 'deployment-bucket',
  provider: {
    getAccountInfo: sinon.stub().resolves({ accountId: '123456789012', partition: 'aws' }),
    getRegion: sinon.stub().returns('us-east-1'),
  },
  serverless: {
    service: {
      provider: { deploymentBucket },
      getAllWebApps: () => ['api'],
      getWebApp: () => ({ name: 'service-dev-api' }),
    },
  },
  s3ClientPromise: Promise.resolve({ send }),
  ...ensureValidBucketExists,
});

const createS3Error = (name, httpStatusCode) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

const createHeadBucketError = (httpStatusCode, bucketRegion) =>
  Object.assign(new Error('UnknownError'), {
    name: String(httpStatusCode),
    $metadata: { httpStatusCode },
    $response: { headers: bucketRegion ? { 'x-amz-bucket-region': bucketRegion } : {} },
  });

describe('ensureValidBucketExists', () => {
  it('uses an existing S3 client promise for custom deployment bucket validation', async () => {
    const send = sinon.stub().resolves({});
    const context = {
      bucketName: 'deployment-bucket',
      provider: {
        getAwsSdkV3Config: sinon
          .stub()
          .throws(new Error('Expected existing S3 client to be reused')),
        getRegion: sinon.stub().returns('us-east-1'),
      },
      serverless: {
        service: {
          provider: {
            deploymentBucket: 'deployment-bucket',
          },
        },
      },
      setBucketName: sinon.stub().resolves(),
      s3ClientPromise: Promise.resolve({ send }),
      ...ensureValidBucketExists,
    };

    await context.ensureValidBucketExists();

    expect(context.provider.getAwsSdkV3Config).to.not.have.been.called;
    expect(send).to.have.been.calledOnce;
    expect(send.firstCall.args[0]).to.be.instanceOf(HeadBucketCommand);
    expect(send.firstCall.args[0].input).to.deep.equal({ Bucket: 'deployment-bucket' });
  });

  it('accepts a custom deployment bucket in the same region when HeadBucket is forbidden', async () => {
    const send = sinon.stub().rejects(createHeadBucketError(403, 'us-east-1'));
    const context = createCustomBucketContext(send);

    await context.ensureValidBucketExists();

    expect(send).to.have.been.calledOnce;
  });

  it('rejects a custom deployment bucket in another region when HeadBucket is forbidden', async () => {
    const send = sinon.stub().rejects(createHeadBucketError(403, 'eu-west-1'));
    const context = createCustomBucketContext(send);

    await expect(context.ensureValidBucketExists()).to.eventually.be.rejected.and.have.property(
      'code',
      'DEPLOYMENT_BUCKET_INVALID_REGION'
    );
  });

  it('rejects a missing custom deployment bucket', async () => {
    const send = sinon.stub().rejects(createHeadBucketError(404));
    const context = createCustomBucketContext(send);

    await expect(context.ensureValidBucketExists()).to.eventually.be.rejected.and.have.property(
      'code',
      'DEPLOYMENT_BUCKET_NOT_FOUND'
    );
  });

  it('uses an existing CloudFormation client promise when repairing a missing deployment bucket', async () => {
    const send = sinon.stub().callsFake(async (command) => {
      if (command instanceof GetTemplateCommand) {
        return {
          TemplateBody: JSON.stringify({
            Resources: {
              ExistingBucket: { Type: 'AWS::S3::Bucket' },
            },
            Outputs: {
              ExistingOutput: { Value: 'existing' },
            },
          }),
        };
      }
      if (command instanceof UpdateStackCommand) return { StackId: 'stack-id' };
      throw new Error(`Unexpected CloudFormation command ${command.constructor.name}`);
    });
    const missingBucketError = Object.assign(
      new Error('Resource ServerlessDeploymentBucket does not exist for stack service-dev'),
      { name: 'ValidationError' }
    );
    const setBucketName = sinon.stub();
    setBucketName.onFirstCall().rejects(missingBucketError);
    setBucketName.onSecondCall().resolves();
    const context = {
      bucketName: null,
      cloudFormationClientPromise: Promise.resolve({ send }),
      getUpdateStackParams: sinon.stub().callsFake(({ templateBody }) => ({
        StackName: 'service-dev',
        TemplateBody: JSON.stringify(templateBody),
      })),
      monitorStack: sinon.stub().resolves(),
      provider: {
        getAwsSdkV3Config: sinon
          .stub()
          .throws(new Error('Expected existing CloudFormation client to be reused')),
        naming: {
          getStackChangeSetName: sinon.stub().returns('service-dev-change-set'),
          getStackName: sinon.stub().returns('service-dev'),
        },
      },
      serverless: {
        service: {
          provider: {
            coreCloudFormationTemplate: {
              Resources: {
                NewBucket: { Type: 'AWS::S3::Bucket' },
              },
              Outputs: {
                NewOutput: { Value: 'new' },
              },
            },
            deploymentMethod: 'direct',
          },
        },
      },
      setBucketName,
      ...ensureValidBucketExists,
    };

    await context.ensureValidBucketExists();

    expect(context.provider.getAwsSdkV3Config).to.not.have.been.called;
    expect(send).to.have.been.calledTwice;
    expect(send.firstCall.args[0]).to.be.instanceOf(GetTemplateCommand);
    expect(send.firstCall.args[0].input).to.deep.equal({
      StackName: 'service-dev',
      TemplateStage: 'Original',
    });
    expect(send.secondCall.args[0]).to.be.instanceOf(UpdateStackCommand);
    expect(JSON.parse(send.secondCall.args[0].input.TemplateBody)).to.deep.equal({
      Resources: {
        ExistingBucket: { Type: 'AWS::S3::Bucket' },
        NewBucket: { Type: 'AWS::S3::Bucket' },
      },
      Outputs: {
        ExistingOutput: { Value: 'existing' },
        NewOutput: { Value: 'new' },
      },
    });
    expect(context.monitorStack).to.have.been.calledOnceWithExactly('update', {
      StackId: 'stack-id',
    });
    expect(setBucketName).to.have.been.calledTwice;
  });

  describe('#ensureBucketSupportsWebApps()', () => {
    const lambdaStatement = {
      Effect: 'Allow',
      Principal: { Service: 'lambda.amazonaws.com' },
      Action: ['s3:GetObject', 's3:GetObjectVersion'],
      Resource: 'arn:aws:s3:::deployment-bucket/*',
    };
    const createSend = ({ versioningStatus = 'Enabled', policy } = {}) =>
      sinon.stub().callsFake(async (command) => {
        if (command instanceof GetBucketVersioningCommand) return { Status: versioningStatus };
        if (command instanceof GetBucketPolicyCommand) {
          if (policy instanceof Error) throw policy;
          return { Policy: JSON.stringify(policy) };
        }
        return {};
      });

    it('does nothing for a service without web apps', async () => {
      const send = sinon.stub();
      const context = createWebAppContext(send);
      context.serverless.service.getAllWebApps = () => [];

      await context.ensureBucketSupportsWebApps();

      expect(send).to.not.have.been.called;
    });

    it('enables versioning on the deployment bucket of the stack before code is uploaded', async () => {
      const send = createSend({ versioningStatus: 'Suspended' });

      await createWebAppContext(send).ensureBucketSupportsWebApps();

      expect(send).to.have.been.calledTwice;
      expect(send.secondCall.args[0]).to.be.instanceOf(PutBucketVersioningCommand);
      expect(send.secondCall.args[0].input).to.deep.equal({
        Bucket: 'deployment-bucket',
        VersioningConfiguration: { Status: 'Enabled' },
      });
    });

    it('leaves a versioned deployment bucket of the stack as it is', async () => {
      const send = createSend();

      await createWebAppContext(send).ensureBucketSupportsWebApps();

      expect(send).to.have.been.calledOnce;
      expect(send.firstCall.args[0]).to.be.instanceOf(GetBucketVersioningCommand);
      expect(send.firstCall.args[0].input).to.deep.equal({ Bucket: 'deployment-bucket' });
    });

    it('reports which action is denied on the deployment bucket', async () => {
      const send = sinon.stub().rejects(createS3Error('AccessDenied', 403));

      const error = await createWebAppContext(send)
        .ensureBucketSupportsWebApps()
        .catch((caughtError) => caughtError);

      expect(error).to.have.property('code', 'WEB_APP_DEPLOYMENT_BUCKET_ACCESS_DENIED');
      expect(error.message).to.include('"deployment-bucket"').and.include('s3:GetBucketVersioning');
    });

    it('rejects a custom deployment bucket that is not versioned', async () => {
      const send = createSend({ versioningStatus: 'Suspended' });
      const context = createWebAppContext(send, { deploymentBucket: 'deployment-bucket' });

      await expect(
        context.ensureBucketSupportsWebApps()
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'WEB_APP_DEPLOYMENT_BUCKET_NOT_VERSIONED'
      );
      expect(send).to.have.been.calledOnce;
    });

    it('accepts a custom deployment bucket whose policy lets AWS Lambda read it', async () => {
      const send = createSend({ policy: { Statement: [lambdaStatement] } });
      const context = createWebAppContext(send, { deploymentBucket: 'deployment-bucket' });

      await context.ensureBucketSupportsWebApps();

      expect(send.secondCall.args[0]).to.be.instanceOf(GetBucketPolicyCommand);
      expect(send.secondCall.args[0].input).to.deep.equal({ Bucket: 'deployment-bucket' });
    });

    for (const [description, policy] of [
      ['has no policy', createS3Error('NoSuchBucketPolicy', 404)],
      [
        'has a policy without a statement for AWS Lambda',
        { Statement: { ...lambdaStatement, Principal: { AWS: '*' } } },
      ],
      [
        'has a policy that only denies access to AWS Lambda',
        { Statement: [{ ...lambdaStatement, Effect: 'Deny' }] },
      ],
    ]) {
      it(`rejects a custom deployment bucket that ${description}, with the statement to add`, async () => {
        const context = createWebAppContext(createSend({ policy }), {
          deploymentBucket: 'deployment-bucket',
        });

        const error = await context
          .ensureBucketSupportsWebApps()
          .catch((caughtError) => caughtError);

        expect(error).to.have.property('code', 'WEB_APP_DEPLOYMENT_BUCKET_POLICY_MISSING');
        expect(JSON.parse(error.message.slice(error.message.indexOf('{')))).to.deep.equal({
          ...lambdaStatement,
          Condition: {
            ArnLike: {
              'aws:SourceArn': [
                'arn:aws:lambda:us-east-1:123456789012:web-function/service-dev-api/revision/*',
              ],
            },
          },
        });
      });
    }

    for (const [description, error] of [
      ['is denied', createS3Error('AccessDenied', 403)],
      [
        'is not allowed from another account than the one of the bucket',
        createS3Error('MethodNotAllowed', 405),
      ],
    ]) {
      it(`skips the policy check when reading the policy of a custom deployment bucket ${description}`, async () => {
        const send = createSend({ policy: error });
        const context = createWebAppContext(send, { deploymentBucket: 'deployment-bucket' });

        await context.ensureBucketSupportsWebApps();

        expect(send).to.have.been.calledTwice;
      });
    }
  });
});
