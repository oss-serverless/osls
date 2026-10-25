'use strict';

const sinon = require('sinon');
const chai = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const AwsProvider = require('../../../../../../../../../lib/plugins/aws/provider');
const Serverless = require('../../../../../../../../../lib/serverless');
const runServerless = require('../../../../../../../../utils/run-serverless');

const { expect } = chai;

describe('AwsCompileS3Events', () => {
  let serverless;
  let awsCompileS3Events;
  let addCustomResourceToServiceStub;

  beforeEach(() => {
    addCustomResourceToServiceStub = sinon.stub().resolves();
    const AwsCompileS3Events = proxyquire(
      '../../../../../../../../../lib/plugins/aws/package/compile/events/s3/index',
      {
        '../../../../custom-resources': {
          addCustomResourceToService: addCustomResourceToServiceStub,
        },
      }
    );
    serverless = new Serverless({ commands: [], options: {} });
    serverless.service.provider.compiledCloudFormationTemplate = { Resources: {} };
    serverless.setProvider('aws', new AwsProvider(serverless));
    awsCompileS3Events = new AwsCompileS3Events(serverless);
    awsCompileS3Events.serverless.service.service = 'new-service';
    awsCompileS3Events.serverless.configSchemaHandler = {
      schema: {
        definitions: {
          awsS3BucketName: {
            pattern: '',
          },
        },
      },
    };
  });

  describe('#constructor()', () => {
    it('should set the provider variable to an instance of AwsProvider', () =>
      expect(awsCompileS3Events.provider).to.be.instanceof(AwsProvider));
  });

  describe('#newS3Buckets()', () => {
    it('should create corresponding resources when S3 events are given', () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: 'first-function-bucket-one',
            },
            {
              s3: {
                bucket: 'first-function-bucket-two',
                event: 's3:ObjectCreated:Put',
                rules: [{ prefix: 'subfolder/' }],
              },
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketFirstfunctionbucketone.Type
      ).to.equal('AWS::S3::Bucket');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketFirstfunctionbuckettwo.Type
      ).to.equal('AWS::S3::Bucket');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .FirstLambdaPermissionFirstfunctionbucketoneS3.Type
      ).to.equal('AWS::Lambda::Permission');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .FirstLambdaPermissionFirstfunctionbuckettwoS3.Type
      ).to.equal('AWS::Lambda::Permission');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketFirstfunctionbuckettwo.Properties.NotificationConfiguration
          .LambdaConfigurations[0].Filter
      ).to.deep.equal({
        S3Key: { Rules: [{ Name: 'prefix', Value: 'subfolder/' }] },
      });
    });

    it('should create single bucket resource when the same bucket referenced repeatedly', () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: 'first-function-bucket-one',
            },
            {
              s3: {
                bucket: 'first-function-bucket-one',
                event: 's3:ObjectCreated:Put',
                rules: [{ prefix: 'subfolder/' }],
              },
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketFirstfunctionbucketone.Type
      ).to.equal('AWS::S3::Bucket');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketFirstfunctionbucketone.Properties.NotificationConfiguration.LambdaConfigurations
          .length
      ).to.equal(2);
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .FirstLambdaPermissionFirstfunctionbucketoneS3.Type
      ).to.equal('AWS::Lambda::Permission');
    });

    it('should add the permission resource logical id to the buckets DependsOn array', () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: 'first-function-bucket-one',
            },
            {
              s3: {
                bucket: 'first-function-bucket-two',
              },
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketFirstfunctionbucketone.Type
      ).to.equal('AWS::S3::Bucket');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketFirstfunctionbuckettwo.Type
      ).to.equal('AWS::S3::Bucket');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .FirstLambdaPermissionFirstfunctionbucketoneS3.Type
      ).to.equal('AWS::Lambda::Permission');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .FirstLambdaPermissionFirstfunctionbuckettwoS3.Type
      ).to.equal('AWS::Lambda::Permission');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketFirstfunctionbucketone.DependsOn
      ).to.deep.equal(['FirstLambdaPermissionFirstfunctionbucketoneS3']);
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketFirstfunctionbuckettwo.DependsOn
      ).to.deep.equal(['FirstLambdaPermissionFirstfunctionbuckettwoS3']);
    });

    it('should not create corresponding resources when S3 events are not given', () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [],
        },
      };

      awsCompileS3Events.newS3Buckets();

      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
      ).to.deep.equal({});
    });

    it('should generate a valid bucket name from provider.s3 entry', () => {
      awsCompileS3Events.serverless.service.provider.s3 = {
        bucketone: {},
      };
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: {
                bucket: 'bucketone',
              },
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketBucketone.Properties.BucketName
      ).to.equal('bucketone');
    });

    it('should use logical id from provider s3 specification if exists', () => {
      awsCompileS3Events.serverless.service.provider.s3 = {
        bucketOne: 1,
      };
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: 'bucketone',
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketBucketone.Type
      ).to.equal('AWS::S3::Bucket');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .FirstLambdaPermissionBucketoneS3.Type
      ).to.equal('AWS::Lambda::Permission');
      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketBucketone.DependsOn
      ).to.deep.equal(['FirstLambdaPermissionBucketoneS3']);
    });

    it('should use name from provider s3 specification if exists', () => {
      awsCompileS3Events.serverless.service.provider.s3 = {
        bucketOne: {
          name: 'my-awesome-bucket',
        },
      };
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: 'bucketOne',
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketBucketOne.Properties.BucketName
      ).to.equal('my-awesome-bucket');
    });

    it('should use bucketName over name property', () => {
      awsCompileS3Events.serverless.service.provider.s3 = {
        bucketOne: {
          name: 'not-used',
          bucketName: 'my-awesome-bucket',
        },
      };
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: 'bucketOne',
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketBucketOne.Properties.BucketName
      ).to.equal('my-awesome-bucket');
    });

    it('should merge notification configuration', () => {
      awsCompileS3Events.serverless.service.provider.s3 = {
        bucketone: {
          notificationConfiguration: {
            QueueConfigurations: [1, 2, 3],
          },
        },
      };
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: {
                bucket: 'bucketone',
              },
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketBucketone.Properties.NotificationConfiguration
      ).to.deep.equal({
        LambdaConfigurations: [
          {
            Event: 's3:ObjectCreated:*',
            Function: {
              'Fn::GetAtt': ['FirstLambdaFunction', 'Arn'],
            },
          },
        ],
        QueueConfigurations: [1, 2, 3],
      });
    });

    it('preserves unsafe top-level provider bucket keys as own data without mutating prototypes', () => {
      const providerBucket = {
        notificationConfiguration: {
          QueueConfigurations: [1, 2, 3],
        },
      };
      Object.defineProperty(providerBucket, '__proto__', {
        value: { marker: 'bucket-config' },
        writable: true,
        enumerable: true,
        configurable: true,
      });

      awsCompileS3Events.serverless.service.provider.s3 = {
        bucketone: providerBucket,
      };
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: {
                bucket: 'bucketone',
              },
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      const properties =
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketBucketone.Properties;

      expect(Object.getPrototypeOf(properties)).to.equal(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(properties, '__proto__').value).to.deep.equal({
        marker: 'bucket-config',
      });
      expect({}.marker).to.equal(undefined);
    });

    it('preserves unsafe notification configuration keys as own data without mutating prototypes', () => {
      const notificationConfiguration = {
        QueueConfigurations: [1, 2, 3],
      };
      Object.defineProperty(notificationConfiguration, '__proto__', {
        value: { marker: 'notification-config' },
        writable: true,
        enumerable: true,
        configurable: true,
      });

      awsCompileS3Events.serverless.service.provider.s3 = {
        bucketone: {
          notificationConfiguration,
        },
      };
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: {
                bucket: 'bucketone',
              },
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      const notificationConfig =
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketBucketone.Properties.NotificationConfiguration;

      expect(Object.getPrototypeOf(notificationConfig)).to.equal(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(notificationConfig, '__proto__').value).to.deep.equal({
        marker: 'notification-config',
      });
      expect(notificationConfig.LambdaConfigurations).to.deep.equal([
        {
          Event: 's3:ObjectCreated:*',
          Function: {
            'Fn::GetAtt': ['FirstLambdaFunction', 'Arn'],
          },
        },
      ]);
      expect(notificationConfig.QueueConfigurations).to.deep.equal([1, 2, 3]);
      expect({}.marker).to.equal(undefined);
    });

    it('should convert camel case properties to pascal case', () => {
      awsCompileS3Events.serverless.service.provider.s3 = {
        bucketone: {
          tags: [1, 2, 3],
        },
      };
      awsCompileS3Events.serverless.service.functions = {
        first: {
          events: [
            {
              s3: {
                bucket: 'bucketone',
              },
            },
          ],
        },
      };

      awsCompileS3Events.newS3Buckets();

      expect(
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .S3BucketBucketone.Properties.Tags
      ).to.deep.equal([1, 2, 3]);
    });
  });

  describe('#existingS3Buckets()', () => {
    it('should create the necessary resources for the most minimal configuration', async () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          name: 'first',
          events: [
            {
              s3: {
                bucket: 'existing-s3-bucket',
                existing: true,
              },
            },
          ],
        },
      };

      return expect(awsCompileS3Events.existingS3Buckets()).to.be.fulfilled.then(() => {
        const { Resources } =
          awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate;

        expect(addCustomResourceToServiceStub).to.have.been.calledOnce;
        expect(addCustomResourceToServiceStub.args[0][1]).to.equal('s3');
        expect(addCustomResourceToServiceStub.args[0][2]).to.deep.equal([
          {
            Action: ['s3:PutBucketNotification', 's3:GetBucketNotification'],
            Effect: 'Allow',
            Resource: {
              'Fn::Join': [
                ':',
                [
                  'arn',
                  {
                    Ref: 'AWS::Partition',
                  },
                  's3',
                  '',
                  '',
                  'existing-s3-bucket',
                ],
              ],
            },
          },
          {
            Action: ['lambda:AddPermission', 'lambda:RemovePermission'],
            Effect: 'Allow',
            Resource: {
              'Fn::Join': [
                ':',
                [
                  'arn',
                  {
                    Ref: 'AWS::Partition',
                  },
                  'lambda',
                  {
                    Ref: 'AWS::Region',
                  },
                  {
                    Ref: 'AWS::AccountId',
                  },
                  'function',
                  '*',
                ],
              ],
            },
          },
        ]);
        expect(Resources.FirstCustomS31).to.deep.equal({
          Type: 'Custom::S3',
          Version: 1,
          DependsOn: ['FirstLambdaFunction', 'CustomDashresourceDashexistingDashs3LambdaFunction'],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashs3LambdaFunction', 'Arn'],
            },
            FunctionName: 'first',
            BucketName: 'existing-s3-bucket',
            BucketConfigs: [{ Event: 's3:ObjectCreated:*', Rules: [] }],
          },
        });
      });
    });

    it('should create the necessary resources for a service using different config parameters', async () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          name: 'second',
          events: [
            {
              s3: {
                bucket: 'existing-s3-bucket',
                event: 's3:ObjectCreated:Put',
                rules: [{ prefix: 'uploads' }, { suffix: '.jpg' }],
                existing: true,
              },
            },
          ],
        },
      };

      return expect(awsCompileS3Events.existingS3Buckets()).to.be.fulfilled.then(() => {
        const { Resources } =
          awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate;

        expect(addCustomResourceToServiceStub).to.have.been.calledOnce;
        expect(addCustomResourceToServiceStub.args[0][1]).to.equal('s3');
        expect(addCustomResourceToServiceStub.args[0][2]).to.deep.equal([
          {
            Action: ['s3:PutBucketNotification', 's3:GetBucketNotification'],
            Effect: 'Allow',
            Resource: {
              'Fn::Join': [
                ':',
                [
                  'arn',
                  {
                    Ref: 'AWS::Partition',
                  },
                  's3',
                  '',
                  '',
                  'existing-s3-bucket',
                ],
              ],
            },
          },
          {
            Action: ['lambda:AddPermission', 'lambda:RemovePermission'],
            Effect: 'Allow',
            Resource: {
              'Fn::Join': [
                ':',
                [
                  'arn',
                  {
                    Ref: 'AWS::Partition',
                  },
                  'lambda',
                  {
                    Ref: 'AWS::Region',
                  },
                  {
                    Ref: 'AWS::AccountId',
                  },
                  'function',
                  '*',
                ],
              ],
            },
          },
        ]);
        expect(Resources.FirstCustomS31).to.deep.equal({
          Type: 'Custom::S3',
          Version: 1,
          DependsOn: ['FirstLambdaFunction', 'CustomDashresourceDashexistingDashs3LambdaFunction'],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashs3LambdaFunction', 'Arn'],
            },
            FunctionName: 'second',
            BucketName: 'existing-s3-bucket',
            BucketConfigs: [
              {
                Event: 's3:ObjectCreated:Put',
                Rules: [{ Prefix: 'uploads' }, { Suffix: '.jpg' }],
              },
            ],
          },
        });
      });
    });

    it('should support `forceDeploy` setting', async () => {
      const result = await runServerless({
        fixture: 's3',
        configExt: {
          functions: {
            basic: {
              handler: 'core.existing',
              events: [
                {
                  s3: {
                    bucket: 'existing-s3-bucket',
                    forceDeploy: true,
                    existing: true,
                  },
                },
              ],
            },
          },
        },
        command: 'package',
      });

      const { Resources } = result.cfTemplate;
      const { awsNaming } = result;

      const customResource = Resources[awsNaming.getCustomResourceS3ResourceLogicalId('basic')];

      expect(typeof customResource.Properties.ForceDeploy).to.equal('number');
    });

    it('should create the necessary resources for a service using multiple event definitions', async () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          name: 'second',
          events: [
            {
              s3: {
                bucket: 'existing-s3-bucket',
                event: 's3:ObjectCreated:Put',
                rules: [{ prefix: 'uploads' }, { suffix: '.jpg' }],
                existing: true,
              },
            },
            {
              s3: {
                bucket: 'existing-s3-bucket',
                event: 's3:ObjectRemoved:Delete',
                rules: [{ prefix: 'downloads' }, { suffix: '.txt' }],
                existing: true,
              },
            },
            {
              s3: {
                bucket: 'existing-s3-bucket',
                event: 's3:ObjectRestore:Post',
                rules: [{ prefix: 'avatars' }, { suffix: '.png' }],
                existing: true,
              },
            },
          ],
        },
      };

      return expect(awsCompileS3Events.existingS3Buckets()).to.be.fulfilled.then(() => {
        const { Resources } =
          awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate;

        expect(addCustomResourceToServiceStub).to.have.been.calledOnce;
        expect(addCustomResourceToServiceStub.args[0][1]).to.equal('s3');
        expect(addCustomResourceToServiceStub.args[0][2]).to.deep.equal([
          {
            Action: ['s3:PutBucketNotification', 's3:GetBucketNotification'],
            Effect: 'Allow',
            Resource: {
              'Fn::Join': [
                ':',
                [
                  'arn',
                  {
                    Ref: 'AWS::Partition',
                  },
                  's3',
                  '',
                  '',
                  'existing-s3-bucket',
                ],
              ],
            },
          },
          {
            Action: ['lambda:AddPermission', 'lambda:RemovePermission'],
            Effect: 'Allow',
            Resource: {
              'Fn::Join': [
                ':',
                [
                  'arn',
                  {
                    Ref: 'AWS::Partition',
                  },
                  'lambda',
                  {
                    Ref: 'AWS::Region',
                  },
                  {
                    Ref: 'AWS::AccountId',
                  },
                  'function',
                  '*',
                ],
              ],
            },
          },
        ]);
        expect(Resources.FirstCustomS31).to.deep.equal({
          Type: 'Custom::S3',
          Version: 1,
          DependsOn: ['FirstLambdaFunction', 'CustomDashresourceDashexistingDashs3LambdaFunction'],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashs3LambdaFunction', 'Arn'],
            },
            FunctionName: 'second',
            BucketName: 'existing-s3-bucket',
            BucketConfigs: [
              {
                Event: 's3:ObjectCreated:Put',

                Rules: [{ Prefix: 'uploads' }, { Suffix: '.jpg' }],
              },
              {
                Event: 's3:ObjectRemoved:Delete',
                Rules: [{ Prefix: 'downloads' }, { Suffix: '.txt' }],
              },
              {
                Event: 's3:ObjectRestore:Post',

                Rules: [{ Prefix: 'avatars' }, { Suffix: '.png' }],
              },
            ],
          },
        });
      });
    });

    it('should create a valid policy for an S3 bucket using !ImportValue', async () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          name: 'first',
          events: [
            {
              s3: {
                bucket: { 'Fn::ImportValue': 'existing-s3-bucket' },

                existing: true,
              },
            },
          ],
        },
      };

      return expect(awsCompileS3Events.existingS3Buckets()).to.be.fulfilled.then(() => {
        expect(addCustomResourceToServiceStub).to.have.been.calledOnce;
        expect(addCustomResourceToServiceStub.args[0][2][0].Resource).to.deep.equal({
          'Fn::Join': [
            ':',
            [
              'arn',
              {
                Ref: 'AWS::Partition',
              },
              's3',
              '',
              '',
              { 'Fn::ImportValue': 'existing-s3-bucket' },
            ],
          ],
        });
      });
    });

    it('should create DependsOn clauses when one bucket is used in more than 1 custom resources', async () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          name: 'first',
          events: [
            {
              s3: {
                bucket: 'existing-s3-bucket',
                event: 's3:ObjectCreated:*',
                rules: [{ prefix: 'uploads' }, { suffix: '.jpg' }],
                existing: true,
              },
            },
            {
              s3: {
                bucket: 'existing-s3-bucket',
                event: 's3:ObjectCreated:*',
                rules: [{ prefix: 'uploads' }, { suffix: '.jpeg' }],
                existing: true,
              },
            },
            {
              s3: {
                bucket: 'existing-s3-bucket',
                event: 's3:ObjectCreated:*',
                rules: [{ prefix: 'uploads' }, { suffix: '.png' }],
                existing: true,
              },
            },
          ],
        },
        second: {
          name: 'second',
          events: [
            {
              s3: {
                bucket: 'existing-s3-bucket',
                event: 's3:ObjectRemoved:*',
                rules: [{ prefix: 'uploads' }, { suffix: '.jpg' }],
                existing: true,
              },
            },
            {
              s3: {
                bucket: 'existing-s3-bucket',
                event: 's3:ObjectRemoved:*',
                rules: [{ prefix: 'uploads' }, { suffix: '.jpeg' }],
                existing: true,
              },
            },
            {
              s3: {
                bucket: 'existing-s3-bucket',
                event: 's3:ObjectRemoved:*',
                rules: [{ prefix: 'uploads' }, { suffix: '.png' }],
                existing: true,
              },
            },
          ],
        },
      };

      return expect(awsCompileS3Events.existingS3Buckets()).to.be.fulfilled.then(() => {
        const { Resources } =
          awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate;

        expect(Object.keys(Resources)).to.have.length(2);
        expect(Resources.FirstCustomS31).to.deep.equal({
          Type: 'Custom::S3',
          Version: 1,
          DependsOn: ['FirstLambdaFunction', 'CustomDashresourceDashexistingDashs3LambdaFunction'],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashs3LambdaFunction', 'Arn'],
            },
            FunctionName: 'first',
            BucketName: 'existing-s3-bucket',
            BucketConfigs: [
              {
                Event: 's3:ObjectCreated:*',

                Rules: [{ Prefix: 'uploads' }, { Suffix: '.jpg' }],
              },
              {
                Event: 's3:ObjectCreated:*',
                Rules: [{ Prefix: 'uploads' }, { Suffix: '.jpeg' }],
              },
              {
                Event: 's3:ObjectCreated:*',
                Rules: [{ Prefix: 'uploads' }, { Suffix: '.png' }],
              },
            ],
          },
        });
        expect(Resources.SecondCustomS31).to.deep.equal({
          Type: 'Custom::S3',
          Version: 1,
          DependsOn: [
            'SecondLambdaFunction',
            'CustomDashresourceDashexistingDashs3LambdaFunction',
            'FirstCustomS31',
          ],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashs3LambdaFunction', 'Arn'],
            },
            FunctionName: 'second',
            BucketName: 'existing-s3-bucket',
            BucketConfigs: [
              {
                Event: 's3:ObjectRemoved:*',

                Rules: [{ Prefix: 'uploads' }, { Suffix: '.jpg' }],
              },
              {
                Event: 's3:ObjectRemoved:*',
                Rules: [{ Prefix: 'uploads' }, { Suffix: '.jpeg' }],
              },
              {
                Event: 's3:ObjectRemoved:*',
                Rules: [{ Prefix: 'uploads' }, { Suffix: '.png' }],
              },
            ],
          },
        });
      });
    });

    it('should chain custom resources across different existing buckets', async () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          name: 'first',
          targetAlias: { logicalId: 'FirstLambdaAlias', name: 'live' },
          events: [
            {
              s3: {
                bucket: 'first-existing-s3-bucket',
                existing: true,
              },
            },
          ],
        },
        second: {
          name: 'second',
          targetAlias: { logicalId: 'SecondLambdaAlias', name: 'live' },
          events: [
            {
              s3: {
                bucket: 'second-existing-s3-bucket',
                existing: true,
              },
            },
          ],
        },
      };

      await awsCompileS3Events.existingS3Buckets();

      const { Resources } =
        awsCompileS3Events.serverless.service.provider.compiledCloudFormationTemplate;

      expect(Resources.FirstCustomS31.DependsOn).to.deep.equal([
        'FirstLambdaFunction',
        'FirstLambdaAlias',
        'CustomDashresourceDashexistingDashs3LambdaFunction',
      ]);
      expect(Resources.SecondCustomS31.DependsOn).to.deep.equal([
        'SecondLambdaFunction',
        'SecondLambdaAlias',
        'CustomDashresourceDashexistingDashs3LambdaFunction',
        'FirstCustomS31',
      ]);
    });

    it('should throw if more than 1 S3 bucket is configured per function', () => {
      awsCompileS3Events.serverless.service.functions = {
        first: {
          name: 'second',
          events: [
            {
              s3: {
                bucket: 'existing-s3-bucket',
                existing: true,
              },
            },
            {
              s3: {
                bucket: 'existing-s3-bucket-2',
                existing: true,
              },
            },
          ],
        },
      };

      return expect(() => awsCompileS3Events.existingS3Buckets()).to.throw('Only one S3 Bucket');
    });
  });
});

describe('test/unit/lib/plugins/aws/package/compile/events/s3/index.test.js', () => {
  let cfResources;
  let naming;
  let serverlessInstance;

  before(async () => {
    const { cfTemplate, awsNaming, serverless } = await runServerless({
      fixture: 's3',
      configExt: {
        functions: {
          basic: {
            handler: 'core.existing',
            events: [
              {
                s3: {
                  bucket: 'foo',
                  event: 's3:ObjectCreated:*',
                  existing: true,
                },
              },
            ],
          },
          other: {
            handler: 'core.existingCreated',
            events: [
              {
                s3: {
                  bucket: { Ref: 'SomeBucket' },
                  event: 's3:ObjectCreated:*',
                  existing: true,
                },
              },
            ],
          },
          withIf: {
            handler: 'core.existingRemoved',
            events: [
              {
                s3: {
                  bucket: {
                    'Fn::If': [
                      'isFirstBucketEmtpy',
                      { Ref: 'FirstBucket' },
                      { Ref: 'SecondBucket' },
                    ],
                  },
                  event: 's3:ObjectCreated:*',
                  existing: true,
                },
              },
            ],
          },
          prefixSuffixWithCfFunction: {
            handler: 'core.custom',
            events: [
              {
                s3: {
                  bucket: 'TestBucket',
                  event: 's3:ObjectCreated:*',
                  existing: true,
                  rules: [
                    {
                      prefix: {
                        'Fn::Join': ['-', ['test', 'join']],
                      },
                    },
                    {
                      suffix: {
                        'Fn::Join': ['-', ['test', 'join']],
                      },
                    },
                  ],
                },
              },
            ],
          },
          provisionedExisting: {
            handler: 'core.provisioned',
            provisionedConcurrency: 1,
            events: [
              {
                s3: {
                  bucket: 'provisioned-bucket',
                  event: 's3:ObjectCreated:*',
                  existing: true,
                },
              },
            ],
          },
        },
      },
      command: 'package',
    });
    cfResources = cfTemplate.Resources;
    naming = awsNaming;
    serverlessInstance = serverless;
  });

  it('should generate expected resources for new S3 buckets', () => {
    const serviceName = serverlessInstance.service.service;
    const minimalBucketName = `${serviceName}-s3-minimal`;
    const extendedBucketName = `${serviceName}-s3-extended`;
    const minimalBucket = cfResources[naming.getBucketLogicalId(minimalBucketName)];
    const extendedBucket = cfResources[naming.getBucketLogicalId(extendedBucketName)];
    const customBucket = cfResources[naming.getBucketLogicalId('customBucket')];

    expect(minimalBucket).to.deep.equal({
      Type: 'AWS::S3::Bucket',
      Properties: {
        BucketName: minimalBucketName,
        NotificationConfiguration: {
          LambdaConfigurations: [
            {
              Event: 's3:ObjectCreated:*',
              Function: { 'Fn::GetAtt': [naming.getLambdaLogicalId('minimal'), 'Arn'] },
            },
          ],
        },
      },
      DependsOn: [naming.getLambdaS3PermissionLogicalId('minimal', minimalBucketName)],
    });
    expect(extendedBucket.Properties.NotificationConfiguration.LambdaConfigurations).to.deep.equal([
      {
        Event: 's3:ObjectRemoved:*',
        Function: { 'Fn::GetAtt': [naming.getLambdaLogicalId('extended'), 'Arn'] },
        Filter: {
          S3Key: {
            Rules: [
              { Name: 'prefix', Value: 'photos/' },
              { Name: 'suffix', Value: '.jpg' },
            ],
          },
        },
      },
    ]);
    expect(extendedBucket.DependsOn).to.deep.equal([
      naming.getLambdaS3PermissionLogicalId('extended', extendedBucketName),
    ]);
    expect(customBucket.Properties).to.deep.include({
      BucketName: `${serviceName}-custom-bucket-dev`,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('should generate expected custom resources for existing S3 buckets', () => {
    const serviceName = serverlessInstance.service.service;
    const existingResource = cfResources[naming.getCustomResourceS3ResourceLogicalId('existing')];
    const createdResource =
      cfResources[naming.getCustomResourceS3ResourceLogicalId('existingCreated')];
    const removedResource =
      cfResources[naming.getCustomResourceS3ResourceLogicalId('existingRemoved')];

    expect(existingResource).to.deep.equal({
      Type: 'Custom::S3',
      Version: 1,
      DependsOn: [
        naming.getLambdaLogicalId('existing'),
        naming.getCustomResourceS3HandlerFunctionLogicalId(),
      ],
      Properties: {
        ServiceToken: {
          'Fn::GetAtt': [naming.getCustomResourceS3HandlerFunctionLogicalId(), 'Arn'],
        },
        FunctionName: serverlessInstance.service.getFunction('existing').name,
        BucketName: `${serviceName}-s3-existing-simple`,
        BucketConfigs: [
          {
            Event: 's3:ObjectCreated:*',
            Rules: [{ Prefix: 'Files/' }, { Suffix: '.TXT' }],
          },
        ],
      },
    });
    expect(createdResource.Properties.BucketName).to.equal(`${serviceName}-s3-existing-complex`);
    expect(createdResource.Properties.BucketConfigs).to.deep.equal([
      {
        Event: 's3:ObjectCreated:*',
        Rules: [{ Prefix: 'photos' }, { Suffix: '.jpg' }],
      },
      {
        Event: 's3:ObjectCreated:*',
        Rules: [{ Prefix: 'photos' }, { Suffix: '.png' }],
      },
    ]);
    expect(removedResource.DependsOn).to.deep.equal([
      naming.getLambdaLogicalId('existingRemoved'),
      naming.getCustomResourceS3HandlerFunctionLogicalId(),
      naming.getCustomResourceS3ResourceLogicalId('existingCreated'),
    ]);
    expect(removedResource.Properties.BucketConfigs).to.deep.equal([
      {
        Event: 's3:ObjectRemoved:*',
        Rules: [{ Prefix: 'photos' }, { Suffix: '.jpg' }],
      },
      {
        Event: 's3:ObjectRemoved:*',
        Rules: [{ Prefix: 'photos' }, { Suffix: '.png' }],
      },
    ]);
  });

  it('should configure existing S3 durable functions through the durable alias', async () => {
    const { cfTemplate, awsNaming, serverless } = await runServerless({
      fixture: 's3',
      configExt: {
        functions: {
          durableExisting: {
            handler: 'core.existing',
            runtime: 'nodejs24.x',
            durableConfig: { executionTimeout: 900 },
            events: [
              {
                s3: {
                  bucket: 'existing-s3-bucket',
                  existing: true,
                },
              },
            ],
          },
        },
      },
      command: 'package',
    });

    const resource =
      cfTemplate.Resources[awsNaming.getCustomResourceS3ResourceLogicalId('durableExisting')];

    expect(resource.DependsOn).to.include(
      awsNaming.getLambdaDurableAliasLogicalId('durableExisting')
    );
    expect(resource.Properties.FunctionName).to.equal(
      serverless.service.getFunction('durableExisting').name
    );
    expect(resource.Properties.FunctionQualifier).to.equal('durable');
  });

  it('should create lambda permissions policy with wild card', async () => {
    const expectedResource = [
      'arn',
      {
        Ref: 'AWS::Partition',
      },
      'lambda',
      {
        Ref: 'AWS::Region',
      },
      {
        Ref: 'AWS::AccountId',
      },
      'function',
      '*',
    ];

    const lambdaPermissionsPolicies =
      cfResources.IamRoleCustomResourcesLambdaExecution.Properties.Policies[
        '0'
      ].PolicyDocument.Statement.filter((x) => x.Action[0].includes('AddPermission'));

    expect(lambdaPermissionsPolicies).to.have.length(1);

    const actualResource = lambdaPermissionsPolicies[0].Resource['Fn::Join'][1];

    expect(actualResource).to.deep.equal(expectedResource);
  });

  it('should support `bucket` provided as CF function', () => {
    expect(cfResources[naming.getCustomResourceS3ResourceLogicalId('other')]).to.deep.equal({
      Type: 'Custom::S3',
      Version: 1,
      DependsOn: [
        'OtherLambdaFunction',
        'CustomDashresourceDashexistingDashs3LambdaFunction',
        'BasicCustomS31',
      ],
      Properties: {
        ServiceToken: {
          'Fn::GetAtt': ['CustomDashresourceDashexistingDashs3LambdaFunction', 'Arn'],
        },
        FunctionName: `${serverlessInstance.service.service}-dev-other`,
        BucketName: { Ref: 'SomeBucket' },
        BucketConfigs: [{ Event: 's3:ObjectCreated:*', Rules: [] }],
      },
    });
  });

  it('should support `bucket` provided as CF If function', () => {
    expect(cfResources[naming.getCustomResourceS3ResourceLogicalId('withIf')]).to.deep.equal({
      Type: 'Custom::S3',
      Version: 1,
      DependsOn: [
        'WithIfLambdaFunction',
        'CustomDashresourceDashexistingDashs3LambdaFunction',
        'OtherCustomS31',
      ],
      Properties: {
        ServiceToken: {
          'Fn::GetAtt': ['CustomDashresourceDashexistingDashs3LambdaFunction', 'Arn'],
        },
        FunctionName: `${serverlessInstance.service.service}-dev-withIf`,
        BucketName: {
          'Fn::If': ['isFirstBucketEmtpy', { Ref: 'FirstBucket' }, { Ref: 'SecondBucket' }],
        },
        BucketConfigs: [{ Event: 's3:ObjectCreated:*', Rules: [] }],
      },
    });
  });

  it('should support `prefix` and `suffix` provided as CF function', () => {
    expect(
      cfResources[naming.getCustomResourceS3ResourceLogicalId('prefixSuffixWithCfFunction')]
    ).to.deep.equal({
      Type: 'Custom::S3',
      Version: 1,
      DependsOn: [
        'PrefixSuffixWithCfFunctionLambdaFunction',
        'CustomDashresourceDashexistingDashs3LambdaFunction',
        'WithIfCustomS31',
      ],
      Properties: {
        ServiceToken: {
          'Fn::GetAtt': ['CustomDashresourceDashexistingDashs3LambdaFunction', 'Arn'],
        },
        FunctionName: `${serverlessInstance.service.service}-dev-prefixSuffixWithCfFunction`,
        BucketName: 'TestBucket',
        BucketConfigs: [
          {
            Event: 's3:ObjectCreated:*',
            Rules: [
              {
                Prefix: {
                  'Fn::Join': ['-', ['test', 'join']],
                },
              },
              {
                Suffix: {
                  'Fn::Join': ['-', ['test', 'join']],
                },
              },
            ],
          },
        ],
      },
    });
  });

  it('should target a generated alias for existing buckets when targetAlias is set', () => {
    const resource =
      cfResources[naming.getCustomResourceS3ResourceLogicalId('provisionedExisting')];
    const aliasLogicalId =
      naming.getLambdaProvisionedConcurrencyAliasLogicalId('provisionedExisting');

    expect(resource.DependsOn).to.deep.equal([
      naming.getLambdaLogicalId('provisionedExisting'),
      aliasLogicalId,
      naming.getCustomResourceS3HandlerFunctionLogicalId(),
      naming.getCustomResourceS3ResourceLogicalId('prefixSuffixWithCfFunction'),
    ]);
    expect(resource.Properties).to.deep.include({
      FunctionName: serverlessInstance.service.getFunction('provisionedExisting').name,
      FunctionQualifier: naming.getLambdaProvisionedConcurrencyAliasName(),
      BucketName: 'provisioned-bucket',
    });
  });

  it('should target a generated alias for new buckets when targetAlias is set', async () => {
    const { cfTemplate, awsNaming } = await runServerless({
      fixture: 'function',
      configExt: {
        functions: {
          basic: {
            provisionedConcurrency: 1,
            events: [{ s3: { bucket: 'provisioned-new-bucket', event: 's3:ObjectCreated:*' } }],
          },
        },
      },
      command: 'package',
    });

    const aliasLogicalId = awsNaming.getLambdaProvisionedConcurrencyAliasLogicalId('basic');
    const bucketResource =
      cfTemplate.Resources[awsNaming.getBucketLogicalId('provisioned-new-bucket')];

    expect(bucketResource.DependsOn).to.include(aliasLogicalId);
    expect(
      bucketResource.Properties.NotificationConfiguration.LambdaConfigurations[0].Function
    ).to.deep.equal({
      'Fn::Join': [
        ':',
        [
          { 'Fn::GetAtt': [awsNaming.getLambdaLogicalId('basic'), 'Arn'] },
          awsNaming.getLambdaProvisionedConcurrencyAliasName(),
        ],
      ],
    });

    const permissionResource =
      cfTemplate.Resources[
        awsNaming.getLambdaS3PermissionLogicalId('basic', 'provisioned-new-bucket')
      ];
    expect(permissionResource.DependsOn).to.equal(aliasLogicalId);
  });

  it('should target the durable alias for new buckets on durable functions', async () => {
    const { cfTemplate, awsNaming } = await runServerless({
      fixture: 'function',
      configExt: {
        functions: {
          basic: {
            runtime: 'nodejs24.x',
            durableConfig: { executionTimeout: 900 },
            events: [{ s3: { bucket: 'durable-new-bucket', event: 's3:ObjectCreated:*' } }],
          },
        },
      },
      command: 'package',
    });

    const aliasLogicalId = awsNaming.getLambdaDurableAliasLogicalId('basic');
    const bucketResource = cfTemplate.Resources[awsNaming.getBucketLogicalId('durable-new-bucket')];

    expect(bucketResource.DependsOn).to.include(aliasLogicalId);
    expect(
      bucketResource.Properties.NotificationConfiguration.LambdaConfigurations[0].Function
    ).to.deep.equal({
      'Fn::Join': [
        ':',
        [
          { 'Fn::GetAtt': [awsNaming.getLambdaLogicalId('basic'), 'Arn'] },
          awsNaming.getLambdaDurableAliasName(),
        ],
      ],
    });

    const permissionResource =
      cfTemplate.Resources[awsNaming.getLambdaS3PermissionLogicalId('basic', 'durable-new-bucket')];
    expect(permissionResource.DependsOn).to.equal(aliasLogicalId);
  });

  it('should disallow referencing multiple buckets in context of single function with CF references', async () => {
    await expect(
      runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              events: [
                {
                  s3: {
                    bucket: { Ref: 'SomeBucket' },
                    event: 's3:ObjectCreated:*',
                    existing: true,
                  },
                },
                {
                  s3: {
                    bucket: { Ref: 'AnotherBucket' },
                    event: 's3:ObjectCreated:*',
                    existing: true,
                  },
                },
              ],
            },
          },
        },
        command: 'package',
      })
    ).to.be.eventually.rejected.and.have.property('code', 'S3_MULTIPLE_BUCKETS_PER_FUNCTION');
  });

  it('should throw when `bucket` is specified as CF function but without setting `existing: true`', async () => {
    await expect(
      runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              events: [
                {
                  s3: {
                    bucket: { Ref: 'SomeBucket' },
                    event: 's3:ObjectCreated:*',
                  },
                },
              ],
            },
          },
        },
        command: 'package',
      })
    ).to.be.eventually.rejected.and.have.property('code', 'S3_INVALID_NEW_BUCKET_FORMAT');
  });
});
