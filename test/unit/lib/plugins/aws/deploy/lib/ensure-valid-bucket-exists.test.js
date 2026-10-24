'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const { HeadBucketCommand } = require('@aws-sdk/client-s3');
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
});
