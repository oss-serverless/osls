'use strict';

const chai = require('chai');
const os = require('os');
const path = require('path');
const awsNaming = require('../../../../../../lib/plugins/aws/lib/naming');
const { createTmpDir, pathExists, remove } = require('../../../../../utils/fs');
const {
  addCustomResourceToService,
} = require('../../../../../../lib/plugins/aws/custom-resources/index.js');
const runServerless = require('../../../../../utils/run-serverless');

const expect = chai.expect;

describe('#addCustomResourceToService()', () => {
  let tmpDirPath;
  let serverless;
  let provider;
  const serviceName = 'some-service';
  const iamRoleStatements = [
    {
      Effect: 'Allow',
      Resource: 'arn:aws:lambda:*:*:function:custom-resource-func',
      Action: ['lambda:AddPermission', 'lambda:RemovePermission'],
    },
  ];

  const createProviderContext = () => {
    const serverless = {
      serviceDir: tmpDirPath,
      service: {
        service: serviceName,
        provider: {
          compiledCloudFormationTemplate: { Resources: {} },
        },
        package: {
          artifactDirectoryName: 'artifact-dir-name',
        },
      },
    };
    const provider = {
      serverless,
      naming: Object.create(awsNaming),
      getStage: () => 'dev',
      getRuntime: () => serverless.service.provider.runtime || 'nodejs24.x',
      getCustomDeploymentRole: () => serverless.service.provider.iam?.deploymentRole,
      getLogRetentionInDays: () => serverless.service.provider.logRetentionInDays,
      getLogDataProtectionPolicy: () => serverless.service.provider.logDataProtectionPolicy,
    };
    provider.naming.provider = provider;
    return { serverless, provider };
  };

  beforeEach(() => {
    tmpDirPath = createTmpDir();
    ({ serverless, provider } = createProviderContext());
  });

  it('should add one IAM role and the custom resources to the service', async () => {
    await Promise.all([
      // add the custom S3 resource
      addCustomResourceToService(provider, 's3', [
        ...iamRoleStatements,
        {
          Effect: 'Allow',
          Resource: 'arn:aws:s3:::some-bucket',
          Action: ['s3:PutBucketNotification', 's3:GetBucketNotification'],
        },
      ]),
      // add the custom Cognito User Pool resource
      addCustomResourceToService(provider, 'cognitoUserPool', [
        ...iamRoleStatements,
        {
          Effect: 'Allow',
          Resource: '*',
          Action: [
            'cognito-idp:ListUserPools',
            'cognito-idp:DescribeUserPool',
            'cognito-idp:UpdateUserPool',
          ],
        },
      ]),
      // add the custom Event Bridge resource
      addCustomResourceToService(provider, 'eventBridge', [
        ...iamRoleStatements,
        {
          Effect: 'Allow',
          Resource: 'arn:aws:events:*:*:rule/some-rule',
          Action: [
            'events:PutRule',
            'events:RemoveTargets',
            'events:PutTargets',
            'events:DeleteRule',
          ],
        },
        {
          Action: ['events:CreateEventBus', 'events:DeleteEventBus'],
          Effect: 'Allow',
          Resource: 'arn:aws:events:*:*:event-bus/some-event-bus',
        },
      ]),
    ]);

    const { Resources } = serverless.service.provider.compiledCloudFormationTemplate;

    // S3 Lambda Function
    expect(Resources.CustomDashresourceDashexistingDashs3LambdaFunction).to.deep.equal({
      Type: 'AWS::Lambda::Function',
      Properties: {
        Code: {
          S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
          S3Key: 'artifact-dir-name/custom-resources.zip',
        },
        FunctionName: `${serviceName}-dev-custom-resource-existing-s3`,
        Handler: 's3/handler.handler',
        MemorySize: 1024,
        Role: {
          'Fn::GetAtt': ['IamRoleCustomResourcesLambdaExecution', 'Arn'],
        },
        Runtime: 'nodejs24.x',
        Timeout: 180,
      },
      DependsOn: ['IamRoleCustomResourcesLambdaExecution'],
    });
    // Cognito User Pool Lambda Function
    expect(Resources.CustomDashresourceDashexistingDashcupLambdaFunction).to.deep.equal({
      Type: 'AWS::Lambda::Function',
      Properties: {
        Code: {
          S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
          S3Key: 'artifact-dir-name/custom-resources.zip',
        },
        FunctionName: `${serviceName}-dev-custom-resource-existing-cup`,
        Handler: 'cognito-user-pool/handler.handler',
        MemorySize: 1024,
        Role: {
          'Fn::GetAtt': ['IamRoleCustomResourcesLambdaExecution', 'Arn'],
        },
        Runtime: 'nodejs24.x',
        Timeout: 180,
      },
      DependsOn: ['IamRoleCustomResourcesLambdaExecution'],
    });
    // Event Bridge Lambda Function
    expect(Resources.CustomDashresourceDasheventDashbridgeLambdaFunction).to.deep.equal({
      Type: 'AWS::Lambda::Function',
      Properties: {
        Code: {
          S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
          S3Key: 'artifact-dir-name/custom-resources.zip',
        },
        FunctionName: `${serviceName}-dev-custom-resource-event-bridge`,
        Handler: 'event-bridge/handler.handler',
        MemorySize: 1024,
        Role: {
          'Fn::GetAtt': ['IamRoleCustomResourcesLambdaExecution', 'Arn'],
        },
        Runtime: 'nodejs24.x',
        Timeout: 180,
      },
      DependsOn: ['IamRoleCustomResourcesLambdaExecution'],
    });
    // Iam Role
    const RoleProps = Resources.IamRoleCustomResourcesLambdaExecution.Properties;
    expect(RoleProps.AssumeRolePolicyDocument).to.deep.equal({
      Statement: [
        {
          Action: ['sts:AssumeRole'],
          Effect: 'Allow',
          Principal: {
            Service: ['lambda.amazonaws.com'],
          },
        },
      ],
      Version: '2012-10-17',
    });
    expect(RoleProps.Policies[0].PolicyDocument.Statement).to.have.deep.members([
      {
        Effect: 'Allow',
        Resource: 'arn:aws:lambda:*:*:function:custom-resource-func',
        Action: ['lambda:AddPermission', 'lambda:RemovePermission'],
      },
      {
        Effect: 'Allow',
        Resource: 'arn:aws:s3:::some-bucket',
        Action: ['s3:PutBucketNotification', 's3:GetBucketNotification'],
      },
      {
        Effect: 'Allow',
        Resource: '*',
        Action: [
          'cognito-idp:ListUserPools',
          'cognito-idp:DescribeUserPool',
          'cognito-idp:UpdateUserPool',
        ],
      },
      {
        Action: [
          'events:PutRule',
          'events:RemoveTargets',
          'events:PutTargets',
          'events:DeleteRule',
        ],
        Effect: 'Allow',
        Resource: 'arn:aws:events:*:*:rule/some-rule',
      },
      {
        Action: ['events:CreateEventBus', 'events:DeleteEventBus'],
        Resource: 'arn:aws:events:*:*:event-bus/some-event-bus',
        Effect: 'Allow',
      },
    ]);
  });

  it('should use custom role when deployment role is provided', async () => {
    const role = 'arn:aws:iam::999999999999:role/my-role';
    const { cfTemplate } = await runServerless({
      fixture: 'function',
      command: 'package',
      configExt: {
        provider: {
          iam: {
            deploymentRole: role,
          },
        },
        functions: {
          foo: {
            handler: 'foo.bar',
            events: [
              { s3: { bucket: 'my-bucket', existing: true } },
              { cognitoUserPool: { pool: 'my-user-pool', trigger: 'PreSignUp', existing: true } },
            ],
          },
        },
      },
    });

    const { Resources } = cfTemplate;
    expect([
      Resources.CustomDashresourceDashexistingDashs3LambdaFunction.Properties.Role, // S3
      Resources.CustomDashresourceDashexistingDashcupLambdaFunction.Properties.Role, // Cognito User Pool
    ]).to.eql([role, role]);
    expect(Resources.IamRoleCustomResourcesLambdaExecution).to.equal(undefined);
  });

  it('should setup CloudWatch Logs when logs.frameworkLambda is true', async () => {
    serverless.service.provider.logs = { frameworkLambda: true };
    await Promise.all([
      // add the custom S3 resource
      addCustomResourceToService(provider, 's3', [
        ...iamRoleStatements,
        {
          Effect: 'Allow',
          Resource: 'arn:aws:s3:::some-bucket',
          Action: ['s3:PutBucketNotification', 's3:GetBucketNotification'],
        },
      ]),
      // add the custom Cognito User Pool resource
      addCustomResourceToService(provider, 'cognitoUserPool', [
        ...iamRoleStatements,
        {
          Effect: 'Allow',
          Resource: '*',
          Action: [
            'cognito-idp:ListUserPools',
            'cognito-idp:DescribeUserPool',
            'cognito-idp:UpdateUserPool',
          ],
        },
      ]),
      // add the custom Event Bridge resource
      addCustomResourceToService(provider, 'eventBridge', [
        ...iamRoleStatements,
        {
          Effect: 'Allow',
          Resource: 'arn:aws:events:*:*:rule/some-rule',
          Action: [
            'events:PutRule',
            'events:RemoveTargets',
            'events:PutTargets',
            'events:DeleteRule',
          ],
        },
        {
          Action: ['events:CreateEventBus', 'events:DeleteEventBus'],
          Effect: 'Allow',
          Resource: 'arn:aws:events:*:*:event-bus/some-event-bus',
        },
      ]),
    ]);

    const { Resources } = serverless.service.provider.compiledCloudFormationTemplate;

    // S3 Lambda Function
    expect(Resources.CustomDashresourceDashexistingDashs3LambdaFunction.DependsOn).to.include(
      'CustomDashresourceDashexistingDashs3LogGroup'
    );
    // Cognito User Pool Lambda Function
    expect(Resources.CustomDashresourceDashexistingDashcupLambdaFunction.DependsOn).to.include(
      'CustomDashresourceDashexistingDashcupLogGroup'
    );
    // Event Bridge Lambda Function
    expect(Resources.CustomDashresourceDasheventDashbridgeLambdaFunction.DependsOn).to.include(
      'CustomDashresourceDasheventDashbridgeLogGroup'
    );
    // Iam Role
    const RoleProps = Resources.IamRoleCustomResourcesLambdaExecution.Properties;

    expect(RoleProps.Policies[0].PolicyDocument.Statement).to.include.deep.members([
      {
        Effect: 'Allow',
        Action: ['logs:CreateLogStream', 'logs:CreateLogGroup', 'logs:TagResource'],
        Resource: [
          {
            'Fn::Sub':
              'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}' +
              ':log-group:/aws/lambda/some-service-dev*:*',
          },
        ],
      },
      {
        Effect: 'Allow',
        Action: ['logs:PutLogEvents'],
        Resource: [
          {
            'Fn::Sub':
              'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}' +
              ':log-group:/aws/lambda/some-service-dev*:*:*',
          },
        ],
      },
    ]);
  });

  it('should throw when an unknown custom resource is used', () => {
    return expect(addCustomResourceToService(provider, 'unknown', [])).to.be.rejectedWith(
      'No implementation found'
    );
  });

  it("should ensure function name doesn't extend maximum length", async () => {
    serverless.service.service = 'some-unexpectedly-long-service-name';
    // add the custom S3 resource
    await addCustomResourceToService(provider, 's3', [
      ...iamRoleStatements,
      {
        Effect: 'Allow',
        Resource: 'arn:aws:s3:::some-bucket',
        Action: ['s3:PutBucketNotification', 's3:GetBucketNotification'],
      },
    ]);

    const { Resources } = serverless.service.provider.compiledCloudFormationTemplate;
    // S3 Lambda Function
    expect(
      Resources.CustomDashresourceDashexistingDashs3LambdaFunction.Properties.FunctionName.length
    ).to.be.below(65);
  });

  it('should use defined runtime', async () => {
    serverless.service.provider.runtime = 'nodejs22.x';
    await Promise.all([
      // add the custom S3 resource
      addCustomResourceToService(provider, 's3', [
        ...iamRoleStatements,
        {
          Effect: 'Allow',
          Resource: 'arn:aws:s3:::some-bucket',
          Action: ['s3:PutBucketNotification', 's3:GetBucketNotification'],
        },
      ]),
      // add the custom Cognito User Pool resource
      addCustomResourceToService(provider, 'cognitoUserPool', [
        ...iamRoleStatements,
        {
          Effect: 'Allow',
          Resource: '*',
          Action: [
            'cognito-idp:ListUserPools',
            'cognito-idp:DescribeUserPool',
            'cognito-idp:UpdateUserPool',
          ],
        },
      ]),
      // add the custom Event Bridge resource
      addCustomResourceToService(provider, 'eventBridge', [
        ...iamRoleStatements,
        {
          Effect: 'Allow',
          Resource: 'arn:aws:events:*:*:rule/some-rule',
          Action: [
            'events:PutRule',
            'events:RemoveTargets',
            'events:PutTargets',
            'events:DeleteRule',
          ],
        },
        {
          Action: ['events:CreateEventBus', 'events:DeleteEventBus'],
          Effect: 'Allow',
          Resource: 'arn:aws:events:*:*:event-bus/some-event-bus',
        },
      ]),
    ]);

    const { Resources } = serverless.service.provider.compiledCloudFormationTemplate;

    expect(
      Resources.CustomDashresourceDashexistingDashs3LambdaFunction.Properties.Runtime
    ).to.equal('nodejs22.x');
    expect(
      Resources.CustomDashresourceDashexistingDashcupLambdaFunction.Properties.Runtime
    ).to.equal('nodejs22.x');
    expect(
      Resources.CustomDashresourceDasheventDashbridgeLambdaFunction.Properties.Runtime
    ).to.equal('nodejs22.x');
  });

  it('should use service.package.deploymentBucket when provided', async () => {
    serverless.service.package.deploymentBucket = 'custom-bucket';

    await addCustomResourceToService(provider, 's3', iamRoleStatements);

    const { Resources } = serverless.service.provider.compiledCloudFormationTemplate;
    expect(
      Resources.CustomDashresourceDashexistingDashs3LambdaFunction.Properties.Code.S3Bucket
    ).to.equal('custom-bucket');
  });

  it('should set Architectures from provider.architecture', async () => {
    serverless.service.provider.architecture = 'arm64';
    await addCustomResourceToService(provider, 's3', iamRoleStatements);

    const { Resources } = serverless.service.provider.compiledCloudFormationTemplate;
    expect(
      Resources.CustomDashresourceDashexistingDashs3LambdaFunction.Properties.Architectures
    ).to.deep.equal(['arm64']);
  });

  it('should not set Architectures when provider.architecture is not defined', async () => {
    await addCustomResourceToService(provider, 's3', iamRoleStatements);

    const { Resources } = serverless.service.provider.compiledCloudFormationTemplate;
    expect(
      Resources.CustomDashresourceDashexistingDashs3LambdaFunction.Properties
    ).to.not.have.property('Architectures');
  });

  it('creates the package directory before copying the generated zip', async () => {
    serverless.serviceDir = path.join(tmpDirPath, 'nested', 'service');

    await addCustomResourceToService(provider, 's3', iamRoleStatements);

    expect(
      await pathExists(
        path.join(
          serverless.serviceDir,
          '.serverless',
          provider.naming.getCustomResourcesArtifactName()
        )
      )
    ).to.equal(true);
  });

  it('regenerates the cached zip when the artifact cache was removed externally', async () => {
    await addCustomResourceToService(provider, 's3', iamRoleStatements);

    await remove(path.resolve(os.homedir(), '.serverless', 'artifacts'));

    serverless.serviceDir = createTmpDir();
    await addCustomResourceToService(provider, 's3', iamRoleStatements);

    expect(
      await pathExists(
        path.join(
          serverless.serviceDir,
          '.serverless',
          provider.naming.getCustomResourcesArtifactName()
        )
      )
    ).to.equal(true);
  });
});

describe('test/unit/lib/plugins/aws/customResources/index.test.js', () => {
  it('correctly takes stage from cli into account when constructing apiGatewayCloudWatchRole resource', async () => {
    const { cfTemplate } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      options: { stage: 'testing' },
      configExt: {
        provider: {
          logs: {
            restApi: true,
          },
        },
      },
    });

    const properties =
      cfTemplate.Resources.CustomDashresourceDashapigwDashcwDashroleLambdaFunction.Properties;
    expect(properties.FunctionName.endsWith('testing-custom-resource-apigw-cw-role')).to.be.true;
  });

  it('falls back to nodejs24 runtime for CW custom resource if provider runtime is not nodejs ', async () => {
    const { cfTemplate } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      options: { stage: 'testing' },
      configExt: {
        provider: {
          runtime: 'python3.12',
          logs: {
            restApi: true,
          },
        },
      },
    });

    const properties =
      cfTemplate.Resources.CustomDashresourceDashapigwDashcwDashroleLambdaFunction.Properties;
    expect(properties.Runtime).to.equal('nodejs24.x');
  });

  it('falls back to nodejs24 runtime for Cognito UP custom resource if provider runtime is not nodejs ', async () => {
    const { cfTemplate } = await runServerless({
      fixture: 'cognito-user-pool',
      command: 'package',
      options: { stage: 'testing' },
      configExt: {
        provider: {
          runtime: 'python3.12',
        },
      },
    });

    const properties =
      cfTemplate.Resources.CustomDashresourceDashexistingDashcupLambdaFunction.Properties;
    expect(properties.Runtime).to.equal('nodejs24.x');
  });

  it('falls back to nodejs24 runtime for S3 custom resource if provider runtime is not nodejs ', async () => {
    const { cfTemplate } = await runServerless({
      fixture: 's3',
      command: 'package',
      options: { stage: 'testing' },
      configExt: {
        provider: {
          runtime: 'python3.12',
        },
      },
    });

    const properties =
      cfTemplate.Resources.CustomDashresourceDashexistingDashs3LambdaFunction.Properties;
    expect(properties.Runtime).to.equal('nodejs24.x');
  });

  it('correctly takes stage from config into account when constructing apiGatewayCloudWatchRole resource', async () => {
    const { cfTemplate } = await runServerless({
      fixture: 'api-gateway',
      command: 'package',
      configExt: {
        provider: {
          stage: 'testing',
          logs: {
            restApi: true,
          },
        },
      },
    });

    const properties =
      cfTemplate.Resources.CustomDashresourceDashapigwDashcwDashroleLambdaFunction.Properties;
    expect(properties.FunctionName.endsWith('testing-custom-resource-apigw-cw-role')).to.be.true;
  });
});
