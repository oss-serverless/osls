'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const { HeadBucketCommand, GetBucketLocationCommand } = require('@aws-sdk/client-s3');
const { GetTemplateCommand, UpdateStackCommand } = require('@aws-sdk/client-cloudformation');
const ensureValidBucketExists = require('../../../../../../../lib/plugins/aws/deploy/lib/ensure-valid-bucket-exists');

const forbiddenHeadBucketError = () =>
  Object.assign(new Error('UnknownError'), {
    name: 'Forbidden',
    $metadata: { httpStatusCode: 403 },
  });

const customBucketContext = (send, region = 'us-east-1') => ({
  bucketName: 'deployment-bucket',
  provider: { getRegion: sinon.stub().returns(region) },
  serverless: { service: { provider: { deploymentBucket: 'deployment-bucket' } } },
  setBucketName: sinon.stub().resolves(),
  s3ClientPromise: Promise.resolve({ send }),
  ...ensureValidBucketExists,
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

  it('falls back to GetBucketLocation when HeadBucket is forbidden', async () => {
    // A role whose s3:ListBucket is limited by an s3:prefix condition cannot HeadBucket
    const send = sinon.stub().callsFake(async (command) => {
      if (command instanceof HeadBucketCommand) throw forbiddenHeadBucketError();
      if (command instanceof GetBucketLocationCommand) return { LocationConstraint: undefined };
      throw new Error(`Unexpected S3 command ${command.constructor.name}`);
    });
    const context = customBucketContext(send);

    await context.ensureValidBucketExists();

    expect(send).to.have.been.calledTwice;
    expect(send.secondCall.args[0]).to.be.instanceOf(GetBucketLocationCommand);
    expect(send.secondCall.args[0].input).to.deep.equal({ Bucket: 'deployment-bucket' });
  });

  it('rejects a bucket in another region found through the GetBucketLocation fallback', async () => {
    const send = sinon.stub().callsFake(async (command) => {
      if (command instanceof HeadBucketCommand) throw forbiddenHeadBucketError();
      return { LocationConstraint: 'EU' };
    });

    await expect(
      customBucketContext(send).ensureValidBucketExists()
    ).to.eventually.be.rejected.and.have.property('code', 'DEPLOYMENT_BUCKET_INVALID_REGION');
  });

  it('reports the HeadBucket error when the GetBucketLocation fallback fails too', async () => {
    const send = sinon.stub().callsFake(async (command) => {
      if (command instanceof HeadBucketCommand) throw forbiddenHeadBucketError();
      throw Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
    });

    const error = await customBucketContext(send)
      .ensureValidBucketExists()
      .then(
        () => null,
        (err) => err
      );

    expect(error).to.have.property('code', 'DEPLOYMENT_BUCKET_NOT_FOUND');
    expect(error.message).to.include('UnknownError');
  });

  it('does not fall back when HeadBucket fails for a reason other than a 403', async () => {
    const send = sinon.stub().rejects(
      Object.assign(new Error('NotFound'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      })
    );

    await expect(
      customBucketContext(send).ensureValidBucketExists()
    ).to.eventually.be.rejected.and.have.property('code', 'DEPLOYMENT_BUCKET_NOT_FOUND');
    expect(send).to.have.been.calledOnce;
  });
});
