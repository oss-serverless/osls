'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const logEmitter = require('log/lib/emitter');
const { HeadBucketCommand } = require('@aws-sdk/client-s3');
const { GetTemplateCommand, UpdateStackCommand } = require('@aws-sdk/client-cloudformation');
const ensureValidBucketExists = require('../../../../../../../lib/plugins/aws/deploy/lib/ensure-valid-bucket-exists');
const runServerless = require('../../../../../../utils/run-serverless');
const { createDeployAwsStubMap } = require('../../../../../../utils/aws-stub-maps');

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

describe('test/unit/lib/plugins/aws/deploy/lib/ensure-valid-bucket-exists.test.js', () => {
  const customBucketConfigExt = {
    service: 'web-function-service',
    provider: { deploymentBucket: 'custom-bucket' },
  };
  const lambdaStatement = {
    Effect: 'Allow',
    Principal: { Service: 'lambda.amazonaws.com' },
    Action: ['s3:GetObject', 's3:GetObjectVersion'],
    Resource: 'arn:aws:s3:::custom-bucket/*',
  };
  const createS3Error = (name, httpStatusCode) => () => {
    throw Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
  };
  const runDeploy = ({ fixture = 'web-function', configExt, s3 }) =>
    runServerless({
      fixture,
      command: 'deploy',
      lastLifecycleHookName: 'aws:deploy:deploy:checkForChanges',
      configExt,
      awsSdkV3StubMap: createDeployAwsStubMap({
        S3: { getBucketVersioning: { Status: 'Enabled' }, putBucketVersioning: {}, ...s3 },
      }),
    });
  const getS3Sends = (awsSdkV3Stub, method) =>
    awsSdkV3Stub.sends.filter(
      ({ service, method: sendMethod }) => service === 'S3' && sendMethod === method
    );

  it('should accept a versioned deployment bucket for web functions', async () => {
    const { awsSdkV3Stub } = await runDeploy({});

    expect(getS3Sends(awsSdkV3Stub, 'getBucketVersioning')).to.have.lengthOf(1);
    expect(getS3Sends(awsSdkV3Stub, 'putBucketVersioning')).to.have.lengthOf(0);
    expect(getS3Sends(awsSdkV3Stub, 'getBucketPolicy')).to.have.lengthOf(0);
  });

  it('should enable versioning on the deployment bucket of the stack for web functions', async () => {
    const { awsSdkV3Stub } = await runDeploy({ s3: { getBucketVersioning: {} } });

    expect(getS3Sends(awsSdkV3Stub, 'putBucketVersioning').map(({ input }) => input)).to.deep.equal(
      [{ Bucket: 'deployment-bucket', VersioningConfiguration: { Status: 'Enabled' } }]
    );
  });

  for (const [action, method] of [
    ['s3:GetBucketVersioning', 'getBucketVersioning'],
    ['s3:PutBucketVersioning', 'putBucketVersioning'],
  ]) {
    it(`should name the bucket and the action when "${action}" is denied`, async () => {
      await expect(
        runDeploy({ s3: { getBucketVersioning: {}, [method]: createS3Error('AccessDenied') } })
      )
        .to.eventually.be.rejectedWith(
          `Web functions need "${action}" on the deployment bucket "deployment-bucket"`
        )
        .and.have.property('code', 'DEPLOYMENT_BUCKET_WEB_FUNCTIONS_ACCESS_DENIED');
    });
  }

  it('should reject a custom deployment bucket without versioning for web functions', async () => {
    await expect(
      runDeploy({
        configExt: customBucketConfigExt,
        s3: { getBucketVersioning: { Status: 'Suspended' } },
      })
    )
      .to.eventually.be.rejectedWith('Deployment bucket "custom-bucket" is not versioned')
      .and.have.property('code', 'DEPLOYMENT_BUCKET_VERSIONING_NOT_ENABLED');
  });

  it('should accept a custom deployment bucket with a policy statement that names the Lambda service', async () => {
    const { awsSdkV3Stub } = await runDeploy({
      configExt: customBucketConfigExt,
      s3: {
        getBucketPolicy: {
          Policy: JSON.stringify({
            Statement: [
              { Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: '*' },
              {
                ...lambdaStatement,
                Principal: { Service: ['cloudfront.amazonaws.com', 'lambda.amazonaws.com'] },
              },
            ],
          }),
        },
      },
    });

    expect(getS3Sends(awsSdkV3Stub, 'getBucketPolicy').map(({ input }) => input)).to.deep.equal([
      { Bucket: 'custom-bucket' },
    ]);
  });

  it('should warn about a custom deployment bucket with a policy statement for all principals', async () => {
    const logEvents = [];
    const listener = (event) => logEvents.push(event);
    logEmitter.on('log', listener);
    try {
      await runDeploy({
        configExt: customBucketConfigExt,
        s3: {
          getBucketPolicy: {
            Policy: JSON.stringify({
              Statement: [
                {
                  ...lambdaStatement,
                  Principal: '*',
                  Condition: {
                    StringEquals: { 'aws:PrincipalServiceName': 'lambda.amazonaws.com' },
                    ArnLike: {
                      'aws:SourceArn':
                        'arn:aws:lambda:us-east-1:999999999999:web-function/web-function-service-dev-basic/revision/*',
                    },
                  },
                },
              ],
            }),
          },
        },
      });
    } finally {
      logEmitter.off('log', listener);
    }

    const warnings = logEvents
      .filter((event) => event.logger.level === 'warning')
      .map((event) => event.messageTokens[0]);
    expect(warnings).to.have.lengthOf(1);
    expect(warnings[0]).to.include('the policy of the deployment bucket "custom-bucket"');
  });

  for (const [description, getBucketPolicy] of [
    ['without a policy', createS3Error('NoSuchBucketPolicy')],
    [
      'with a policy that does not let Lambda read',
      {
        Policy: JSON.stringify({
          Statement: {
            Effect: 'Allow',
            Principal: { AWS: 'arn:aws:iam::999999999999:root' },
            Action: 's3:GetObject',
            Resource: 'arn:aws:s3:::custom-bucket/*',
          },
        }),
      },
    ],
    [
      'with a policy that only denies Lambda to read',
      { Policy: JSON.stringify({ Statement: [{ ...lambdaStatement, Effect: 'Deny' }] }) },
    ],
  ]) {
    it(`should reject a custom deployment bucket ${description} for web functions`, async () => {
      const error = await expect(
        runDeploy({ configExt: customBucketConfigExt, s3: { getBucketPolicy } })
      ).to.eventually.be.rejected;

      expect(error).to.have.property('code', 'DEPLOYMENT_BUCKET_WEB_FUNCTIONS_POLICY_MISSING');
      expect(
        JSON.parse(
          error.message.slice(error.message.indexOf('{'), error.message.lastIndexOf('}') + 1)
        )
      ).to.deep.equal({
        ...lambdaStatement,
        Condition: {
          ArnLike: {
            'aws:SourceArn': 'arn:aws:lambda:us-east-1:999999999999:web-function/*/revision/*',
          },
        },
      });
    });
  }

  for (const [description, getBucketPolicy] of [
    ['reading it is denied', createS3Error('AccessDenied', 403)],
    ['reading it from another account is not allowed', createS3Error('MethodNotAllowed', 405)],
    ['reading it fails', createS3Error('InternalError', 500)],
    ['it cannot be parsed', { Policy: 'not a policy' }],
  ]) {
    it(`should skip the policy check of a custom deployment bucket when ${description}`, async () => {
      const { awsSdkV3Stub } = await runDeploy({
        configExt: customBucketConfigExt,
        s3: { getBucketPolicy },
      });

      expect(getS3Sends(awsSdkV3Stub, 'getBucketPolicy')).to.have.lengthOf(1);
    });
  }

  it('should skip the versioning check of a custom deployment bucket when reading it is denied', async () => {
    const { awsSdkV3Stub } = await runDeploy({
      configExt: customBucketConfigExt,
      s3: {
        getBucketVersioning: createS3Error('AccessDenied'),
        getBucketPolicy: { Policy: JSON.stringify({ Statement: [lambdaStatement] }) },
      },
    });

    expect(getS3Sends(awsSdkV3Stub, 'getBucketPolicy')).to.have.lengthOf(1);
  });

  it('should not check the deployment bucket without web functions', async () => {
    const { awsSdkV3Stub } = await runDeploy({ fixture: 'function' });

    expect(getS3Sends(awsSdkV3Stub, 'getBucketVersioning')).to.have.lengthOf(0);
  });
});
