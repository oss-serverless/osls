'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const chai = require('chai');
const JSZip = require('jszip');
const runServerless = require('../../../../../../utils/run-serverless');
const setupProgrammaticFixture = require('../../../../../../utils/setup-programmatic-fixture');

const expect = chai.expect;

const getFileSha256 = (filePath) =>
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

describe('test/unit/lib/plugins/aws/package/compile/web-apps.test.js', () => {
  describe('Minimal configuration', () => {
    let cfResources;
    let cfOutputs;
    let naming;
    let serviceConfig;
    let serviceDir;

    before(async () => {
      const { awsNaming, cfTemplate, fixtureData } = await runServerless({
        fixture: 'web-app',
        command: 'package',
      });
      cfResources = cfTemplate.Resources;
      cfOutputs = cfTemplate.Outputs;
      naming = awsNaming;
      ({ serviceConfig, servicePath: serviceDir } = fixtureData);
    });

    it('should create the web function', () => {
      expect(cfResources[naming.getWebFunctionLogicalId('api')]).to.deep.equal({
        Type: 'AWS::Lambda::WebFunction',
        Properties: { FunctionName: `${serviceConfig.service}-dev-api` },
      });
    });

    it('should create the revision with only the required properties', () => {
      const artifactHash = getFileSha256(
        path.join(serviceDir, '.serverless', naming.getWebAppArtifactName('api'))
      );

      expect(cfResources[naming.getWebFunctionRevisionLogicalId('api')]).to.deep.equal({
        Type: 'AWS::Lambda::WebFunctionRevision',
        DependsOn: [
          'ApiWebFunctionLogGroup',
          'ApiWebFunctionLocalLogGroup',
          'ServerlessDeploymentBucketPolicy',
        ],
        Properties: {
          FunctionName: { Ref: 'ApiWebFunction' },
          BuildConfig: {
            CodeConfig: {
              S3Object: {
                Bucket: { Ref: 'ServerlessDeploymentBucket' },
                Key: `serverless/${serviceConfig.service}/dev/web-apps/api-${artifactHash}.zip`,
              },
            },
            RuntimeConfig: { Runtime: 'nodejs24.x' },
          },
          ServiceConfig: {
            ExecutionRoleArn: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
            EnvironmentVariables: { AWS_LAMBDA_NODEJS_ENTRYPOINT: '__osls_web_app_start.mjs' },
          },
        },
      });
    });

    it('should create the endpoint routing all traffic to the revision', () => {
      expect(cfResources[naming.getWebFunctionEndpointLogicalId('api')]).to.deep.equal({
        Type: 'AWS::Lambda::WebFunctionEndpoint',
        Properties: {
          FunctionName: { Ref: 'ApiWebFunction' },
          EndpointName: 'main',
          EndpointType: 'HomeRegion',
          AuthType: 'ApplicationManaged',
          RevisionWeights: [
            { RevisionId: { 'Fn::GetAtt': ['ApiWebFunctionRevision', 'RevisionId'] }, Weight: 100 },
          ],
          ScalingConfig: {},
          ThrottleConfig: {},
        },
      });
    });

    it('should output the URL', () => {
      expect(cfOutputs[naming.getWebFunctionUrlOutputLogicalId('api')]).to.deep.equal({
        Description: 'Lambda Web Function URL',
        Value: {
          'Fn::Join': [
            '',
            ['https://', { 'Fn::GetAtt': ['ApiWebFunctionEndpoint', 'DomainName'] }],
          ],
        },
        Export: { Name: `sls-${serviceConfig.service}-dev-ApiWebFunctionUrl` },
      });
    });

    it('should let AWS Lambda read the code from the deployment bucket', () => {
      const { Statement } =
        cfResources[naming.getDeploymentBucketPolicyLogicalId()].Properties.PolicyDocument;

      expect(Statement).to.have.lengthOf(2);
      expect(Statement[1]).to.deep.equal({
        Effect: 'Allow',
        Principal: { Service: 'lambda.amazonaws.com' },
        Action: ['s3:GetObject', 's3:GetObjectVersion'],
        Resource: {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':s3:::',
              { Ref: 'ServerlessDeploymentBucket' },
              `/serverless/${serviceConfig.service}/dev/web-apps/*`,
            ],
          ],
        },
        Condition: {
          ArnLike: {
            'aws:SourceArn': [
              {
                'Fn::Sub': `arn:\${AWS::Partition}:lambda:\${AWS::Region}:\${AWS::AccountId}:web-function/${serviceConfig.service}-dev-api/revision/*`,
              },
            ],
          },
        },
      });
    });
  });

  describe('Full configuration', () => {
    const kmsKeyArn = 'arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab';
    const providerKmsKeyArn =
      'arn:aws:kms:us-east-1:123456789012:key/abcd1234-12ab-34cd-56ef-1234567890ab';
    const roleArn = 'arn:aws:iam::123456789012:role/web-app-role';
    let cfResources;
    let naming;

    before(async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'web-app',
        command: 'package',
        configExt: {
          provider: {
            runtime: 'nodejs22.x',
            timeout: 10,
            environment: {
              SHARED: 'provider',
              OVERRIDDEN: 'provider',
              PORT: '8080',
              HOSTNAME: 'localhost',
              AWS_LAMBDA_NODEJS_ENTRYPOINT: 'index.js',
            },
            kmsKeyArn: providerKmsKeyArn,
            logs: { lambda: { applicationLogLevel: 'WARN', systemLogLevel: 'DEBUG' } },
            tags: { team: 'web', stage: 'provider' },
          },
          webApps: {
            api: {
              entry: './src/server.js',
              runtime: 'nodejs26.x',
              name: 'custom-web-app',
              description: 'Storefront',
              timeout: 60,
              maxConcurrency: 32,
              environment: { OVERRIDDEN: 'web app', TABLE_NAME: { Ref: 'OrdersTable' } },
              logs: { applicationLogLevel: 'debug' },
              role: roleArn,
              kmsKeyArn,
              tags: { stage: 'web app' },
              url: { authorizer: 'aws_iam', maxEnvironments: 50, rateLimit: 0 },
            },
            inheriting: { entry: 'src/server.js', build: false },
            multiRegion: {
              entry: 'src/server.js',
              url: { type: 'MultiRegion', regions: ['us-east-1', 'us-west-2'], name: 'global' },
            },
            withRoleLogicalId: { entry: 'src/server.js', role: 'CustomRole' },
            withRoleGetAtt: {
              entry: 'src/server.js',
              role: { 'Fn::GetAtt': ['CustomRole', 'Arn'] },
              url: true,
            },
          },
          functions: {
            api: { handler: 'src/server.handler', name: 'custom-web-app' },
          },
          resources: {
            Resources: {
              CustomRole: {
                Type: 'AWS::IAM::Role',
                Properties: {
                  AssumeRolePolicyDocument: {
                    Statement: [
                      {
                        Effect: 'Allow',
                        Principal: { Service: 'lambda.amazonaws.com' },
                        Action: 'sts:AssumeRole',
                      },
                    ],
                  },
                },
              },
              OrdersTable: { Type: 'AWS::SNS::Topic' },
            },
          },
        },
      });
      cfResources = cfTemplate.Resources;
      naming = awsNaming;
    });

    it('should support `name` and merge `tags` over `provider.tags`', () => {
      expect(cfResources[naming.getWebFunctionLogicalId('api')].Properties).to.deep.equal({
        FunctionName: 'custom-web-app',
        Tags: [
          { Key: 'team', Value: 'web' },
          { Key: 'stage', Value: 'web app' },
        ],
      });
    });

    it('should support the revision settings', () => {
      const { Properties } = cfResources[naming.getWebFunctionRevisionLogicalId('api')];

      expect(Properties.Description).to.equal('Storefront');
      expect(Properties.KmsKeyArn).to.equal(kmsKeyArn);
      expect(Properties.BuildConfig.RuntimeConfig).to.deep.equal({ Runtime: 'nodejs26.x' });
      expect(Properties.ServiceConfig).to.deep.equal({
        ExecutionRoleArn: roleArn,
        TimeoutSeconds: 60,
        MaxConcurrencyPerEnvironment: 32,
        EnvironmentVariables: {
          SHARED: 'provider',
          OVERRIDDEN: 'web app',
          TABLE_NAME: { Ref: 'OrdersTable' },
          AWS_LAMBDA_NODEJS_ENTRYPOINT: '__osls_web_app_start.mjs',
        },
        TelemetryConfig: {
          LoggingConfig: { ApplicationLogLevel: 'DEBUG', SystemLogLevel: 'DEBUG' },
        },
      });
    });

    it('should support the `url` settings', () => {
      const { Properties } = cfResources[naming.getWebFunctionEndpointLogicalId('api')];

      expect(Properties.AuthType).to.equal('IamAuth');
      expect(Properties.ScalingConfig).to.deep.equal({ MaxEnvironments: 50 });
      expect(Properties.ThrottleConfig).to.deep.equal({ RateLimit: 0 });
    });

    it('should support `url.type`, `url.regions` and `url.name`', () => {
      const { Properties } = cfResources[naming.getWebFunctionEndpointLogicalId('multiRegion')];

      expect(Properties).to.include({ EndpointName: 'global', EndpointType: 'MultiRegion' });
      expect(Properties.Regions).to.deep.equal(['us-east-1', 'us-west-2']);
      expect(
        cfResources[naming.getWebFunctionEndpointLogicalId('api')].Properties
      ).to.not.have.property('Regions');
    });

    it('should support a function with the key and the name of a web app', () => {
      expect(cfResources[naming.getLambdaLogicalId('api')].Properties.FunctionName).to.equal(
        'custom-web-app'
      );
      expect(cfResources).to.have.property(naming.getLogGroupLogicalId('api'));
      expect(cfResources).to.have.property(naming.getWebFunctionLogGroupLogicalId('api'));
    });

    it('should inherit the provider settings that apply to web apps', () => {
      const { Properties } = cfResources[naming.getWebFunctionRevisionLogicalId('inheriting')];

      expect(Properties.KmsKeyArn).to.equal(providerKmsKeyArn);
      expect(Properties.BuildConfig.RuntimeConfig).to.deep.equal({ Runtime: 'nodejs24.x' });
      expect(Properties.ServiceConfig).to.deep.equal({
        ExecutionRoleArn: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
        TimeoutSeconds: 10,
        EnvironmentVariables: {
          SHARED: 'provider',
          OVERRIDDEN: 'provider',
          AWS_LAMBDA_NODEJS_ENTRYPOINT: '__osls_web_app_start.mjs',
        },
        TelemetryConfig: {
          LoggingConfig: { ApplicationLogLevel: 'WARN', SystemLogLevel: 'DEBUG' },
        },
      });
      expect(
        cfResources[naming.getWebFunctionLogicalId('inheriting')].Properties.Tags
      ).to.deep.equal([
        { Key: 'team', Value: 'web' },
        { Key: 'stage', Value: 'provider' },
      ]);
    });

    it('should not grant the default role access to the KMS key of a web app', () => {
      const { Statement } =
        cfResources.IamRoleLambdaExecution.Properties.Policies[0].PolicyDocument;

      expect(JSON.stringify(Statement)).to.not.include(kmsKeyArn);
    });

    it('should support `role` set to a logical ID', () => {
      const revision = cfResources[naming.getWebFunctionRevisionLogicalId('withRoleLogicalId')];

      expect(revision.Properties.ServiceConfig.ExecutionRoleArn).to.deep.equal({
        'Fn::GetAtt': ['CustomRole', 'Arn'],
      });
      expect(revision.DependsOn).to.include('CustomRole');
    });

    it('should support `role` set to `Fn::GetAtt`', () => {
      const revision = cfResources[naming.getWebFunctionRevisionLogicalId('withRoleGetAtt')];

      expect(revision.Properties.ServiceConfig.ExecutionRoleArn).to.deep.equal({
        'Fn::GetAtt': ['CustomRole', 'Arn'],
      });
      expect(revision.DependsOn).to.include('CustomRole');
    });

    it('should list every web app in the deployment bucket policy', () => {
      const { Statement } =
        cfResources[naming.getDeploymentBucketPolicyLogicalId()].Properties.PolicyDocument;

      expect(Statement[1].Condition.ArnLike['aws:SourceArn']).to.have.lengthOf(5);
      expect(Statement[1].Condition.ArnLike['aws:SourceArn'][0]).to.deep.equal({
        'Fn::Sub':
          'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:web-function/custom-web-app/revision/*',
      });
    });
  });

  describe('Prebuilt artifact in a deployment bucket of the user', () => {
    let cfResources;
    let naming;
    let serviceDir;

    before(async () => {
      const zip = new JSZip();
      zip.file('dist/server.js', "require('http').createServer().listen(3000);");
      const { servicePath } = await setupProgrammaticFixture('web-app', {
        configExt: {
          provider: {
            runtime: 'nodejs26.x',
            deploymentBucket: { name: 'my-deployment-bucket', versioning: false },
            environment: { PORT: '8080' },
          },
          webApps: { api: { entry: 'dist/server.js', package: { artifact: 'prebuilt.zip' } } },
        },
        files: [{ to: 'prebuilt.zip', contents: await zip.generateAsync({ type: 'nodebuffer' }) }],
      });
      serviceDir = servicePath;
      const { awsNaming, cfTemplate } = await runServerless({
        cwd: serviceDir,
        command: 'package',
      });
      cfResources = cfTemplate.Resources;
      naming = awsNaming;
    });

    it('should reference the artifact by the hash of its content', () => {
      const { S3Object } =
        cfResources[naming.getWebFunctionRevisionLogicalId('api')].Properties.BuildConfig
          .CodeConfig;

      expect(S3Object.Bucket).to.equal('my-deployment-bucket');
      expect(S3Object.Key).to.match(
        new RegExp(`/web-apps/api-${getFileSha256(path.join(serviceDir, 'prebuilt.zip'))}\\.zip$`)
      );
    });

    it('should point AWS Lambda at `entry` and leave the provider environment as it is', () => {
      const { ServiceConfig } =
        cfResources[naming.getWebFunctionRevisionLogicalId('api')].Properties;

      expect(ServiceConfig.EnvironmentVariables).to.deep.equal({
        PORT: '8080',
        AWS_LAMBDA_NODEJS_ENTRYPOINT: 'dist/server.js',
      });
    });

    it('should inherit `provider.runtime` when it supports web apps', () => {
      const { RuntimeConfig } =
        cfResources[naming.getWebFunctionRevisionLogicalId('api')].Properties.BuildConfig;

      expect(RuntimeConfig).to.deep.equal({ Runtime: 'nodejs26.x' });
    });

    it('should not depend on a deployment bucket policy', () => {
      expect(cfResources[naming.getWebFunctionRevisionLogicalId('api')].DependsOn).to.deep.equal([
        'ApiWebFunctionLogGroup',
        'ApiWebFunctionLocalLogGroup',
      ]);
      expect(cfResources).to.not.have.property(naming.getDeploymentBucketPolicyLogicalId());
    });
  });

  describe('Validation', () => {
    const longValue = 'x'.repeat(4096);

    for (const [description, configExt, code] of [
      [
        'a deployment bucket without versioning',
        { provider: { deploymentBucket: { versioning: false } } },
        'WEB_APP_DEPLOYMENT_BUCKET_VERSIONING_REQUIRED',
      ],
      [
        '`provider.deploymentBucket.skipPolicySetup`',
        { provider: { deploymentBucket: { skipPolicySetup: true } } },
        'WEB_APP_DEPLOYMENT_BUCKET_POLICY_REQUIRED',
      ],
      [
        '`provider.deploymentMode: express` with `provider.disableRollback`',
        { provider: { deploymentMode: 'express', disableRollback: true } },
        'WEB_APP_EXPRESS_MODE_WITHOUT_ROLLBACK',
      ],
      ['`build: esbuild`', { webApps: { api: { build: 'esbuild' } } }, 'WEB_APP_BUILD_UNSUPPORTED'],
      [
        '`dev`',
        { webApps: { api: { dev: { command: 'npm run dev' } } } },
        'WEB_APP_DEV_UNSUPPORTED',
      ],
      [
        '`iam`',
        { webApps: { api: { iam: { role: { statements: [] } } } } },
        'WEB_APP_IAM_UNSUPPORTED',
      ],
      [
        '`vpc`',
        { webApps: { api: { vpc: { subnetIds: ['subnet-1'], securityGroupIds: ['sg-1'] } } } },
        'WEB_APP_VPC_UNSUPPORTED',
      ],
      [
        'a missing `entry`',
        { configValidationMode: 'off', webApps: { api: { entry: null } } },
        'WEB_APP_ENTRY_MISSING',
      ],
      [
        'an absolute `entry`',
        { webApps: { api: { entry: '/src/server.js' } } },
        'WEB_APP_INVALID_ENTRY',
      ],
      [
        'an `entry` outside of the service directory',
        { webApps: { api: { entry: 'src/../../server.js' } } },
        'WEB_APP_INVALID_ENTRY',
      ],
      [
        'a TypeScript `entry`',
        { webApps: { api: { entry: 'src/server.ts' } } },
        'WEB_APP_TYPESCRIPT_ENTRY_UNSUPPORTED',
      ],
      [
        '`package.artifact` in S3',
        { webApps: { api: { package: { artifact: 's3://some-bucket/api.zip' } } } },
        'WEB_APP_S3_ARTIFACT_UNSUPPORTED',
      ],
      ['`url: false`', { webApps: { api: { url: false } } }, 'WEB_APP_URL_REQUIRED'],
      [
        'a `name` with characters AWS Lambda does not accept',
        { webApps: { api: { name: 'web-app-' } } },
        'WEB_APP_INVALID_NAME',
      ],
      [
        'a `name` longer than 64 characters',
        { webApps: { api: { name: 'a'.repeat(65) } } },
        'WEB_APP_INVALID_NAME',
      ],
      [
        'a `name` shared with another web app',
        {
          webApps: {
            api: { name: 'shared-name' },
            other: { entry: 'src/server.js', name: 'shared-name' },
          },
        },
        'WEB_APP_NAME_CONFLICT',
      ],
      [
        'a function whose log group gets the logical ID of a log group of the web app',
        { functions: { apiWebFunctionLocal: { handler: 'src/server.handler' } } },
        'WEB_APP_FUNCTION_LOGICAL_ID_CONFLICT',
      ],
      [
        '`url.regions` without a multi-Region `url.type`',
        { webApps: { api: { url: { regions: ['us-west-2'] } } } },
        'WEB_APP_URL_REGIONS_NOT_ALLOWED',
      ],
      [
        'a multi-Region `url.type` without `url.regions`',
        { webApps: { api: { url: { type: 'MultiRegion' } } } },
        'WEB_APP_URL_REGIONS_REQUIRED',
      ],
      [
        '`url.regions` that only lists the Region of the service',
        { webApps: { api: { url: { type: 'PerRegion', regions: ['us-east-1'] } } } },
        'WEB_APP_URL_REGIONS_REQUIRED',
      ],
      [
        'a `url.name` with characters AWS Lambda does not accept',
        { webApps: { api: { url: { name: '_main' } } } },
        'WEB_APP_INVALID_URL_NAME',
      ],
      [
        'an inherited `provider.timeout` below the minimum of web apps',
        { provider: { timeout: 2 } },
        'WEB_APP_INVALID_TIMEOUT',
      ],
      [
        'an environment variable osls sets',
        { webApps: { api: { environment: { PORT: '3000' } } } },
        'WEB_APP_RESERVED_ENVIRONMENT_VARIABLE',
      ],
      [
        'an environment variable AWS Lambda reserves',
        { provider: { environment: { AWS_LAMBDA_HTTP_ENDPOINT: '0.0.0.0:3000' } } },
        'WEB_APP_RESERVED_ENVIRONMENT_VARIABLE',
      ],
      [
        'an environment variable name AWS Lambda does not accept',
        { provider: { environment: { _HANDLER: 'index.handler' } } },
        'WEB_APP_INVALID_ENVIRONMENT_VARIABLE',
      ],
      [
        'an empty environment variable',
        { provider: { environment: { EMPTY: '' } } },
        'WEB_APP_INVALID_ENVIRONMENT_VARIABLE',
      ],
      [
        'an environment variable value above 4096 characters',
        { webApps: { api: { environment: { LONG: `${longValue}x` } } } },
        'WEB_APP_INVALID_ENVIRONMENT_VARIABLE',
      ],
      [
        'environment variables above 32 KB',
        {
          webApps: {
            api: {
              environment: Object.fromEntries(
                Array.from({ length: 8 }, (_, index) => [`LONG_${index}`, longValue])
              ),
            },
          },
        },
        'WEB_APP_ENVIRONMENT_TOO_LARGE',
      ],
    ]) {
      it(`should reject ${description}`, async () => {
        await expect(
          runServerless({ fixture: 'web-app', command: 'package', configExt })
        ).to.eventually.be.rejected.and.have.property('code', code);
      });
    }
  });
});
