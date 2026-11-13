'use strict';

const crypto = require('crypto');
const path = require('path');
const fsp = require('fs').promises;
const chai = require('chai');
const runServerless = require('../../../../../../utils/run-serverless');

const expect = chai.expect;

describe('test/unit/lib/plugins/aws/package/compile/web-functions.test.js', () => {
  const kmsKeyArn = 'arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab';
  const roleArn = 'arn:aws:iam::123456789012:role/web';

  describe('Web function properties', () => {
    let cfResources;
    let cfOutputs;
    let naming;
    let service;
    let basicArtifactHash;

    before(async () => {
      const { awsNaming, cfTemplate, serverless } = await runServerless({
        fixture: 'web-function',
        command: 'package',
        configExt: {
          webFunctions: {
            configured: {
              entryPoint: 'src/server.js',
              name: 'configured-web-function',
              description: 'Configured web function',
              runtime: 'nodejs24.x',
              timeout: 120,
              maxConcurrencyPerEnvironment: 16,
              environment: { TABLE_NAME: { Ref: 'Table' } },
              kmsKeyArn,
              tags: { team: 'web' },
              logs: { applicationLogLevel: 'DEBUG', systemLogLevel: 'WARN' },
              endpoint: { authorizer: 'aws_iam', maxEnvironments: 50, rateLimit: 2000 },
            },
            disabled: { endpoint: { rateLimit: 0 } },
            multiRegion: {
              endpoint: {
                name: 'global',
                type: 'MultiRegion',
                regions: ['us-east-2', 'us-west-2'],
              },
            },
            perRegion: { endpoint: { type: 'PerRegion', regions: ['us-east-1', 'us-west-2'] } },
            indexEntryPoint: { entryPoint: 'index.js' },
            relativeEntryPoint: { entryPoint: './src/server.js' },
            emptyEndpoint: { endpoint: { type: null, regions: null } },
            roleArn: { role: roleArn },
            roleLogicalId: { role: 'WebRole' },
            roleGetAtt: { role: { 'Fn::GetAtt': ['WebRole', 'Arn'] } },
            roleImport: { role: { 'Fn::ImportValue': 'WebRoleArn' } },
          },
          resources: {
            Resources: {
              Table: {
                Type: 'AWS::DynamoDB::Table',
                Properties: {
                  BillingMode: 'PAY_PER_REQUEST',
                  AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
                  KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
                },
              },
              WebRole: {
                Type: 'AWS::IAM::Role',
                Properties: {
                  AssumeRolePolicyDocument: {
                    Version: '2012-10-17',
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
            },
          },
        },
      });
      cfResources = cfTemplate.Resources;
      cfOutputs = cfTemplate.Outputs;
      naming = awsNaming;
      service = serverless.service;
      basicArtifactHash = crypto
        .createHash('sha256')
        .update(
          await fsp.readFile(path.join(serverless.serviceDir, '.serverless', 'basic.web.zip'))
        )
        .digest('hex');
    });

    it('should create a web function, a revision and an endpoint with defaults', () => {
      expect(cfResources[naming.getWebFunctionLogicalId('basic')]).to.deep.equal({
        Type: 'AWS::Lambda::WebFunction',
        Properties: { FunctionName: `${service.service}-dev-basic` },
      });
      expect(cfResources[naming.getWebFunctionRevisionLogicalId('basic')]).to.deep.equal({
        Type: 'AWS::Lambda::WebFunctionRevision',
        DependsOn: [
          'BasicWebFunctionLogGroup',
          'BasicWebFunctionLocalLogGroup',
          'ServerlessDeploymentBucketPolicy',
        ],
        Properties: {
          FunctionName: { Ref: 'BasicWebFunction' },
          BuildConfig: {
            CodeConfig: {
              S3Object: {
                Bucket: { Ref: 'ServerlessDeploymentBucket' },
                Key: `serverless/${service.service}/dev/web-functions/basic-${basicArtifactHash}.zip`,
              },
            },
            RuntimeConfig: { Runtime: 'nodejs24.x' },
          },
          ServiceConfig: {
            ExecutionRoleArn: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
          },
        },
      });
      expect(cfResources[naming.getWebFunctionEndpointLogicalId('basic')]).to.deep.equal({
        Type: 'AWS::Lambda::WebFunctionEndpoint',
        Properties: {
          FunctionName: { Ref: 'BasicWebFunction' },
          EndpointName: 'main',
          EndpointType: 'HomeRegion',
          AuthType: 'ApplicationManaged',
          RevisionWeights: [
            {
              RevisionId: { 'Fn::GetAtt': ['BasicWebFunctionRevision', 'RevisionId'] },
              Weight: 100,
            },
          ],
          ScalingConfig: {},
          ThrottleConfig: {},
        },
      });
    });

    it('should create an output with the URL of the endpoint', () => {
      expect(cfOutputs[naming.getWebFunctionUrlOutputLogicalId('basic')]).to.deep.equal({
        Description: 'Lambda Web Function URL',
        Value: {
          'Fn::Join': [
            '',
            ['https://', { 'Fn::GetAtt': ['BasicWebFunctionEndpoint', 'DomainName'] }],
          ],
        },
        Export: { Name: `sls-${service.service}-dev-BasicWebFunctionUrl` },
      });
    });

    it('should support `webFunctions[].name`', () => {
      expect(
        cfResources[naming.getWebFunctionLogicalId('configured')].Properties.FunctionName
      ).to.equal('configured-web-function');
    });

    it('should support `webFunctions[].tags`', () => {
      expect(
        cfResources[naming.getWebFunctionLogicalId('configured')].Properties.Tags
      ).to.deep.equal([{ Key: 'team', Value: 'web' }]);
    });

    it('should support the revision properties', () => {
      const { Properties } = cfResources[naming.getWebFunctionRevisionLogicalId('configured')];

      expect(Properties.Description).to.equal('Configured web function');
      expect(Properties.KmsKeyArn).to.equal(kmsKeyArn);
      expect(Properties.BuildConfig.RuntimeConfig).to.deep.equal({ Runtime: 'nodejs24.x' });
      expect(Properties.ServiceConfig).to.deep.equal({
        ExecutionRoleArn: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
        TimeoutSeconds: 120,
        MaxConcurrencyPerEnvironment: 16,
        EnvironmentVariables: {
          TABLE_NAME: { Ref: 'Table' },
          AWS_LAMBDA_NODEJS_ENTRYPOINT: 'src/server.js',
        },
        TelemetryConfig: {
          LoggingConfig: { ApplicationLogLevel: 'DEBUG', SystemLogLevel: 'WARN' },
        },
      });
    });

    it('should not set the entry point variable for `index.js`', () => {
      expect(
        cfResources[naming.getWebFunctionRevisionLogicalId('indexEntryPoint')].Properties
          .ServiceConfig
      ).to.not.have.property('EnvironmentVariables');
    });

    it('should support a `webFunctions[].entryPoint` that starts with `./`', () => {
      expect(
        cfResources[naming.getWebFunctionRevisionLogicalId('relativeEntryPoint')].Properties
          .ServiceConfig.EnvironmentVariables
      ).to.deep.equal({ AWS_LAMBDA_NODEJS_ENTRYPOINT: 'src/server.js' });
    });

    it('should support `webFunctions[].endpoint`', () => {
      const { Properties } = cfResources[naming.getWebFunctionEndpointLogicalId('configured')];

      expect(Properties.AuthType).to.equal('IamAuth');
      expect(Properties.ScalingConfig).to.deep.equal({ MaxEnvironments: 50 });
      expect(Properties.ThrottleConfig).to.deep.equal({ RateLimit: 2000 });
    });

    it('should support `webFunctions[].endpoint.type`, `regions` and `name`', () => {
      expect(
        cfResources[naming.getWebFunctionEndpointLogicalId('multiRegion')].Properties
      ).to.deep.include({
        EndpointName: 'global',
        EndpointType: 'MultiRegion',
        Regions: ['us-east-2', 'us-west-2'],
      });
      expect(
        cfResources[naming.getWebFunctionEndpointLogicalId('perRegion')].Properties
      ).to.deep.include({
        EndpointName: 'main',
        EndpointType: 'PerRegion',
        Regions: ['us-east-1', 'us-west-2'],
      });
    });

    it('should support `webFunctions[].endpoint.type` and `regions` without a value', () => {
      const { Properties } = cfResources[naming.getWebFunctionEndpointLogicalId('emptyEndpoint')];

      expect(Properties.EndpointType).to.equal('HomeRegion');
      expect(Properties).to.not.have.property('Regions');
    });

    it('should support a `webFunctions[].endpoint.rateLimit` of 0', () => {
      expect(
        cfResources[naming.getWebFunctionEndpointLogicalId('disabled')].Properties.ThrottleConfig
      ).to.deep.equal({ RateLimit: 0 });
    });

    it('should support `webFunctions[].role` set to an ARN', () => {
      expect(
        cfResources[naming.getWebFunctionRevisionLogicalId('roleArn')].Properties.ServiceConfig
          .ExecutionRoleArn
      ).to.equal(roleArn);
    });

    for (const webFunctionName of ['roleLogicalId', 'roleGetAtt']) {
      it(`should support \`webFunctions[].role\` set to a role of the stack (${webFunctionName})`, () => {
        expect(
          cfResources[naming.getWebFunctionRevisionLogicalId(webFunctionName)].Properties
            .ServiceConfig.ExecutionRoleArn
        ).to.deep.equal({ 'Fn::GetAtt': ['WebRole', 'Arn'] });
      });
    }

    it('should support `webFunctions[].role` set to `Fn::ImportValue`', () => {
      expect(
        cfResources[naming.getWebFunctionRevisionLogicalId('roleImport')].Properties.ServiceConfig
          .ExecutionRoleArn
      ).to.deep.equal({ 'Fn::ImportValue': 'WebRoleArn' });
    });

    it('should let Lambda read the code of every web function from the deployment bucket', () => {
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
              '/*',
            ],
          ],
        },
        Condition: {
          ArnLike: {
            'aws:SourceArn': {
              'Fn::Sub':
                'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:web-function/*/revision/*',
            },
          },
        },
      });
    });

    it('should not add the statement to the template that creates the stack', () => {
      expect(
        service.provider.coreCloudFormationTemplate.Resources[
          naming.getDeploymentBucketPolicyLogicalId()
        ].Properties.PolicyDocument.Statement
      ).to.have.lengthOf(1);
    });
  });

  describe('Provider properties', () => {
    let cfResources;
    let naming;

    before(async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'web-function',
        command: 'package',
        configExt: {
          provider: {
            runtime: 'python3.14',
            timeout: 6,
            kmsKeyArn,
            environment: { STAGE: 'dev', SHARED: 'provider' },
            tags: { owner: 'provider', shared: 'provider' },
            logs: { lambda: { applicationLogLevel: 'DEBUG', logFormat: 'JSON' } },
            iam: { role: roleArn },
          },
          webFunctions: {
            basic: {
              environment: { SHARED: 'webFunction' },
              tags: { shared: 'webFunction' },
            },
          },
        },
      });
      cfResources = cfTemplate.Resources;
      naming = awsNaming;
    });

    it('should support `provider.environment`', () => {
      expect(
        cfResources[naming.getWebFunctionRevisionLogicalId('basic')].Properties.ServiceConfig
          .EnvironmentVariables
      ).to.deep.equal({ STAGE: 'dev', SHARED: 'webFunction' });
    });

    it('should support `provider.tags`', () => {
      expect(cfResources[naming.getWebFunctionLogicalId('basic')].Properties.Tags).to.deep.equal([
        { Key: 'owner', Value: 'provider' },
        { Key: 'shared', Value: 'webFunction' },
      ]);
    });

    it('should support `provider.iam.role`', () => {
      expect(
        cfResources[naming.getWebFunctionRevisionLogicalId('basic')].Properties.ServiceConfig
          .ExecutionRoleArn
      ).to.equal(roleArn);
    });

    it('should not apply the function settings of the provider', () => {
      const { Properties } = cfResources[naming.getWebFunctionRevisionLogicalId('basic')];

      expect(Properties.BuildConfig.RuntimeConfig.Runtime).to.equal('nodejs24.x');
      expect(Properties).to.not.have.property('KmsKeyArn');
      expect(Properties.ServiceConfig).to.not.have.property('TimeoutSeconds');
      expect(Properties.ServiceConfig).to.not.have.property('TelemetryConfig');
    });
  });

  describe('Deployment bucket', () => {
    it('should deploy to an existing bucket without configuring it', async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'web-function',
        command: 'package',
        configExt: { provider: { deploymentBucket: 'existing-bucket' } },
      });
      const revision = cfTemplate.Resources[awsNaming.getWebFunctionRevisionLogicalId('basic')];

      expect(revision.Properties.BuildConfig.CodeConfig.S3Object.Bucket).to.equal(
        'existing-bucket'
      );
      expect(revision.DependsOn).to.deep.equal([
        'BasicWebFunctionLogGroup',
        'BasicWebFunctionLocalLogGroup',
      ]);
      expect(cfTemplate.Resources).to.not.have.property(
        awsNaming.getDeploymentBucketPolicyLogicalId()
      );
    });

    it('should not change the deployment bucket policy of a service without web functions', async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        command: 'package',
      });

      expect(
        cfTemplate.Resources[awsNaming.getDeploymentBucketPolicyLogicalId()].Properties
          .PolicyDocument.Statement
      ).to.have.lengthOf(1);
    });

    it('should require `provider.deploymentBucket.versioning`', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: { provider: { deploymentBucket: { versioning: false } } },
        })
      )
        .to.eventually.be.rejectedWith('provider:\n  deploymentBucket:\n    versioning: true')
        .and.have.property('code', 'WEB_FUNCTIONS_DEPLOYMENT_BUCKET_VERSIONING_REQUIRED');
    });

    it('should reject `provider.deploymentBucket.skipPolicySetup`', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: { provider: { deploymentBucket: { skipPolicySetup: true } } },
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'WEB_FUNCTIONS_DEPLOYMENT_BUCKET_POLICY_REQUIRED'
      );
    });
  });

  describe('Validation', () => {
    for (const [description, webFunction, message] of [
      ['function properties', { handler: 'index.handler' }, "unrecognized property 'handler'"],
      ['`vpc`', { vpc: { securityGroupIds: ['sg-1'], subnetIds: ['subnet-1'] } }, "'vpc'"],
      ['an unsupported `runtime`', { runtime: 'nodejs22.x' }, 'webFunctions.basic.runtime'],
      ['an empty `entryPoint`', { entryPoint: '' }, 'webFunctions.basic.entryPoint'],
      ['a `timeout` below 3 seconds', { timeout: 1 }, 'webFunctions.basic.timeout'],
      ['a negative `endpoint.rateLimit`', { endpoint: { rateLimit: -1 } }, 'rateLimit'],
      ['an unsupported `endpoint.authorizer`', { endpoint: { authorizer: 'none' } }, 'authorizer'],
      [
        'an unsupported `endpoint` property',
        { endpoint: { auth: 'aws_iam' } },
        "unrecognized property 'auth'",
      ],
      ['an unsupported `endpoint.type`', { endpoint: { type: 'Global' } }, 'endpoint.type'],
      [
        '`endpoint.regions` that are not names of regions',
        { endpoint: { type: 'PerRegion', regions: ['US-WEST-2'] } },
        'endpoint.regions',
      ],
      [
        'repeated `endpoint.regions`',
        { endpoint: { type: 'PerRegion', regions: ['us-west-2', 'us-west-2'] } },
        'endpoint.regions',
      ],
      ['an invalid `endpoint.name`', { endpoint: { name: '-main' } }, 'endpoint.name'],
      ['a lower case log level', { logs: { applicationLogLevel: 'debug' } }, 'applicationLogLevel'],
    ]) {
      it(`should reject ${description}`, async () => {
        await expect(
          runServerless({
            fixture: 'web-function',
            command: 'print',
            configExt: { webFunctions: { basic: webFunction } },
          })
        )
          .to.eventually.be.rejectedWith(message)
          .and.have.property('code', 'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION');
      });
    }

    for (const [description, entryPoint, message, configValidationMode] of [
      ['an `entryPoint` that is not a string', { Ref: 'EntryPoint' }, 'it is not a string', 'warn'],
      ['an absolute `entryPoint`', '/index.js', 'it is an absolute path'],
      [
        'an `entryPoint` outside of the package',
        'src/../../index.js',
        'it contains a "." or ".." segment',
      ],
      ['an `entryPoint` with backslashes', 'src\\server.js', 'it contains a backslash'],
    ]) {
      it(`should reject ${description}`, async () => {
        await expect(
          runServerless({
            fixture: 'web-function',
            command: 'package',
            configExt: { configValidationMode, webFunctions: { basic: { entryPoint } } },
          })
        )
          .to.eventually.be.rejectedWith(message)
          .and.have.property('code', 'WEB_FUNCTION_INVALID_ENTRY_POINT');
      });
    }

    it('should reject a `kmsKeyArn` that is the ARN of an alias', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: {
            webFunctions: {
              basic: { kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:alias/web' },
            },
          },
        })
      )
        .to.eventually.be.rejectedWith('which is not the ARN of a key')
        .and.have.property('code', 'WEB_FUNCTION_INVALID_KMS_KEY_ARN');
    });

    it('should reject web functions with the same logical ID', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'print',
          configExt: { webFunctions: { Basic: {} } },
        })
      )
        .to.eventually.be.rejectedWith(
          'Web functions "basic" and "Basic" both get the "BasicWebFunction" logical ID'
        )
        .and.have.property('code', 'WEB_FUNCTION_LOGICAL_ID_ALREADY_USED');
    });

    it('should reject a web function with the key of a function', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'print',
          configExt: { functions: { basic: { handler: 'index.handler' } } },
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'WEB_FUNCTION_KEY_ALREADY_USED_BY_FUNCTION'
      );
    });

    for (const [functionName, logGroupLogicalId] of [
      ['basicWebFunction', 'BasicWebFunctionLogGroup'],
      ['basicWebFunctionLocal', 'BasicWebFunctionLocalLogGroup'],
    ]) {
      it(`should reject a web function with the log group logical ID of a function (${functionName})`, async () => {
        await expect(
          runServerless({
            fixture: 'web-function',
            command: 'print',
            configExt: { functions: { [functionName]: { handler: 'index.handler' } } },
          })
        )
          .to.eventually.be.rejectedWith(
            `Web function "basic" and function "${functionName}" both get a log group with the "${logGroupLogicalId}" logical ID`
          )
          .and.have.property('code', 'WEB_FUNCTION_LOGICAL_ID_ALREADY_USED_BY_FUNCTION');
      });
    }

    it('should accept a web function with the log group logical ID of a function without logs', async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'web-function',
        command: 'package',
        configExt: {
          functions: { basicWebFunctionLocal: { handler: 'index.handler', disableLogs: true } },
        },
      });

      expect(cfTemplate.Resources.BasicWebFunctionLocalLogGroup.Properties.LogGroupName).to.match(
        /^\/aws\/lambda\/web\/.+-dev-basic\.local$/
      );
    });

    it('should reject web functions with the same name', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: {
            webFunctions: { basic: { name: 'shared-name' }, other: { name: 'shared-name' } },
          },
        })
      )
        .to.eventually.be.rejectedWith('Web functions "basic" and "other"')
        .and.have.property('code', 'WEB_FUNCTION_NAME_ALREADY_USED');
    });

    it('should accept a web function with the name of a function', async () => {
      const { cfTemplate, awsNaming } = await runServerless({
        fixture: 'web-function',
        command: 'package',
        configExt: {
          functions: { other: { handler: 'index.handler', name: 'shared-name' } },
          webFunctions: { basic: { name: 'shared-name' } },
        },
      });

      expect(
        cfTemplate.Resources[awsNaming.getWebFunctionLogicalId('basic')].Properties.FunctionName
      ).to.equal('shared-name');
    });

    for (const [description, name] of [
      ['with unsupported characters', 'web.function'],
      ['that starts with a hyphen', '-web-function'],
      ['longer than 64 characters', 'w'.repeat(65)],
    ]) {
      it(`should reject a \`name\` ${description}`, async () => {
        await expect(
          runServerless({
            fixture: 'web-function',
            command: 'package',
            configExt: { webFunctions: { basic: { name } } },
          })
        )
          .to.eventually.be.rejectedWith('Web function "basic"')
          .and.have.property('code', 'WEB_FUNCTION_INVALID_NAME');
      });
    }

    it('should reject a default name longer than 64 characters', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: { webFunctions: { ['w'.repeat(64)]: {} } },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'WEB_FUNCTION_INVALID_NAME');
    });

    it('should reject environment variables reserved by Lambda', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: { provider: { environment: { AWS_LAMBDA_HTTP_ENDPOINT: '0.0.0.0:8080' } } },
        })
      )
        .to.eventually.be.rejectedWith('"AWS_LAMBDA_HTTP_ENDPOINT"')
        .and.have.property('code', 'WEB_FUNCTION_RESERVED_ENVIRONMENT_VARIABLE');
    });

    for (const [description, environment] of [
      ['names that start with an underscore', { _HANDLER: 'index' }],
      ['empty values', { EMPTY: '' }],
    ]) {
      it(`should reject environment variables with ${description}`, async () => {
        await expect(
          runServerless({
            fixture: 'web-function',
            command: 'package',
            configExt: { webFunctions: { basic: { environment } } },
          })
        ).to.eventually.be.rejected.and.have.property(
          'code',
          'WEB_FUNCTION_INVALID_ENVIRONMENT_VARIABLE'
        );
      });
    }

    it('should reject environment variables with values longer than 4096 characters', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: { webFunctions: { basic: { environment: { LONG: 'v'.repeat(4097) } } } },
        })
      )
        .to.eventually.be.rejectedWith('a value of 4097 characters')
        .and.have.property('code', 'WEB_FUNCTION_INVALID_ENVIRONMENT_VARIABLE');
    });

    it('should reject environment variables that take more than 32 KB together', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: {
            provider: { environment: { FIRST: 'v'.repeat(4096), SECOND: 'v'.repeat(4096) } },
            webFunctions: {
              basic: {
                environment: Object.fromEntries(
                  Array.from({ length: 6 }, (_, index) => [`VARIABLE_${index}`, 'v'.repeat(4096)])
                ),
              },
            },
          },
        })
      )
        .to.eventually.be.rejectedWith('take 32839 bytes')
        .and.have.property('code', 'WEB_FUNCTION_ENVIRONMENT_TOO_LARGE');
    });

    it('should reject the environment variable that `entryPoint` sets', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: {
            webFunctions: {
              basic: { environment: { AWS_LAMBDA_NODEJS_ENTRYPOINT: 'src/server.js' } },
            },
          },
        })
      )
        .to.eventually.be.rejectedWith('Set "entryPoint" on the web function instead')
        .and.have.property('code', 'WEB_FUNCTION_ENTRY_POINT_ENVIRONMENT_VARIABLE_DEFINED');
    });

    it('should reject `endpoint.regions` on a `HomeRegion` endpoint', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: { webFunctions: { basic: { endpoint: { regions: ['us-west-2'] } } } },
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'WEB_FUNCTION_ENDPOINT_REGIONS_NOT_ALLOWED'
      );
    });

    it('should reject `endpoint.regions` when `endpoint.type` has no value', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: {
            webFunctions: { basic: { endpoint: { type: null, regions: ['us-west-2'] } } },
          },
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'WEB_FUNCTION_ENDPOINT_REGIONS_NOT_ALLOWED'
      );
    });

    for (const [description, endpoint, configValidationMode] of [
      ['without `endpoint.regions`', { type: 'MultiRegion' }],
      ['with `endpoint.regions` without a value', { type: 'MultiRegion', regions: null }],
      [
        'with `endpoint.regions` that is not a list',
        { type: 'MultiRegion', regions: { Ref: 'Regions' } },
        'warn',
      ],
      ['with the region of the service only', { type: 'PerRegion', regions: ['us-east-1'] }],
    ]) {
      it(`should reject a multi-Region endpoint ${description}`, async () => {
        await expect(
          runServerless({
            fixture: 'web-function',
            command: 'package',
            configExt: { configValidationMode, webFunctions: { basic: { endpoint } } },
          })
        )
          .to.eventually.be.rejectedWith('other than "us-east-1"')
          .and.have.property('code', 'WEB_FUNCTION_ENDPOINT_REGIONS_REQUIRED');
      });
    }

    it('should reject express mode with rollback disabled', async () => {
      await expect(
        runServerless({
          fixture: 'web-function',
          command: 'package',
          configExt: { provider: { deploymentMode: 'express', disableRollback: true } },
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'WEB_FUNCTIONS_EXPRESS_MODE_WITHOUT_ROLLBACK_UNSUPPORTED'
      );
    });

    it('should accept express mode with rollback enabled', async () => {
      const { cfTemplate, awsNaming } = await runServerless({
        fixture: 'web-function',
        command: 'package',
        configExt: { provider: { deploymentMode: 'express' } },
      });

      expect(cfTemplate.Resources).to.have.property(
        awsNaming.getWebFunctionRevisionLogicalId('basic')
      );
    });
  });
});
