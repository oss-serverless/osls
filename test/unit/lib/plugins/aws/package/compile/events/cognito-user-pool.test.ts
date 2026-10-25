'use strict';

const sinon = require('sinon');
const chai = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const AwsProvider = require('../../../../../../../../lib/plugins/aws/provider');
const Serverless = require('../../../../../../../../lib/serverless');
const runServerless = require('../../../../../../../utils/run-serverless');

const { expect } = chai;

const serverlessConfigurationExtension = {
  functions: {
    singleCustomSenderSourceKmsStringARN: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'SingleCustomSenderSourceKmsStringARN',
            trigger: 'CustomSMSSender',
            kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
          },
        },
      ],
    },
    singleCustomSenderSourceKmsRefARN: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'SingleCustomSenderSourceKmsRefARN',
            trigger: 'CustomSMSSender',
            kmsKeyId: {
              'Fn::GetAtt': ['kmsKey', 'Arn'],
            },
          },
        },
      ],
    },
    multipleCustomSenderSourceForSinglePool: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'MultipleCustomSenderSourceForSinglePool',
            trigger: 'CustomSMSSender',
            kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
          },
        },
        {
          cognitoUserPool: {
            pool: 'MultipleCustomSenderSourceForSinglePool',
            trigger: 'CustomEmailSender',
            kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
          },
        },
      ],
    },
    singleCustomSenderSourceForMultiplePools1: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'SingleCustomSenderSourceForMultiplePools1',
            trigger: 'CustomSMSSender',
            kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
          },
        },
      ],
    },
    singleCustomSenderSourceForMultiplePools2: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'SingleCustomSenderSourceForMultiplePools2',
            trigger: 'CustomSMSSender',
            kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
          },
        },
      ],
    },
    singleCustomSenderSourceKmsStringARNExisting: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'SingleCustomSenderSourceKmsStringARNExisting',
            trigger: 'CustomSMSSender',
            kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
            existing: true,
          },
        },
      ],
    },
    singleCustomSenderSourceKmsRefARNExisting: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'SingleCustomSenderSourceKmsRefARNExisting',
            trigger: 'CustomSMSSender',
            kmsKeyId: {
              'Fn::GetAtt': ['kmsKey', 'Arn'],
            },
            existing: true,
          },
        },
      ],
    },
    multipleCustomSenderSourceForSinglePoolExisting: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'MultipleCustomSenderSourceForSinglePoolExisting',
            trigger: 'CustomSMSSender',
            kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
            existing: true,
          },
        },
        {
          cognitoUserPool: {
            pool: 'MultipleCustomSenderSourceForSinglePoolExisting',
            trigger: 'CustomEmailSender',
            kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
            existing: true,
          },
        },
      ],
    },
    singleCustomSenderSourceForMultiplePoolsExisting1: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'SingleCustomSenderSourceForMultiplePoolsExisting1',
            trigger: 'CustomSMSSender',
            kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
            existing: true,
          },
        },
      ],
    },
    singleCustomSenderSourceForMultiplePoolsExisting2: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'SingleCustomSenderSourceForMultiplePoolsExisting2',
            trigger: 'CustomSMSSender',
            kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
            existing: true,
          },
        },
      ],
    },
  },
};

const preTokenGenerationConfigurationExtension = {
  configValidationMode: 'off',
  functions: {
    preTokenGenerationV2: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'PreTokenGenerationV2Pool',
            trigger: 'PreTokenGeneration',
            lambdaVersion: 'V2_0',
          },
        },
      ],
    },
    preTokenGenerationV3: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'PreTokenGenerationV3Pool',
            trigger: 'PreTokenGeneration',
            lambdaVersion: 'V3_0',
          },
        },
      ],
    },
    preTokenGenerationV2Existing: {
      handler: 'index.js',
      events: [
        {
          cognitoUserPool: {
            pool: 'PreTokenGenerationV2PoolExisting',
            trigger: 'PreTokenGeneration',
            lambdaVersion: 'V2_0',
            existing: true,
          },
        },
      ],
    },
  },
};

const customUserPoolDependency = 'CustomCognitoUserPoolDependency';

const scopedCognitoLambdaResource = () => ({
  'Fn::Sub': 'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:*',
});

const scopedCognitoAddPermissionStatement = () => ({
  Action: ['lambda:AddPermission'],
  Condition: {
    StringEquals: {
      'lambda:Principal': 'cognito-idp.amazonaws.com',
    },
  },
  Effect: 'Allow',
  Resource: scopedCognitoLambdaResource(),
});

const scopedCognitoRemovePermissionStatement = () => ({
  Action: ['lambda:RemovePermission'],
  Effect: 'Allow',
  Resource: scopedCognitoLambdaResource(),
});

describe('AwsCompileCognitoUserPoolEvents', () => {
  let serverless;
  let awsCompileCognitoUserPoolEvents;
  let addCustomResourceToServiceStub;

  beforeEach(() => {
    addCustomResourceToServiceStub = sinon.stub().resolves();
    const AwsCompileCognitoUserPoolEvents = proxyquire(
      '../../../../../../../../lib/plugins/aws/package/compile/events/cognito-user-pool',
      {
        '../../../custom-resources': {
          addCustomResourceToService: addCustomResourceToServiceStub,
        },
      }
    );
    serverless = new Serverless({ commands: [], options: {} });
    serverless.service.provider.compiledCloudFormationTemplate = { Resources: {} };
    serverless.setProvider('aws', new AwsProvider(serverless));
    awsCompileCognitoUserPoolEvents = new AwsCompileCognitoUserPoolEvents(serverless);
    awsCompileCognitoUserPoolEvents.serverless.service.service = 'new-service';
  });

  describe('#constructor()', () => {
    it('should set the provider variable to an instance of AwsProvider', () =>
      expect(awsCompileCognitoUserPoolEvents.provider).to.be.instanceof(AwsProvider));
  });

  describe('#newCognitoUserPools()', () => {
    it('should create resources when CUP events are given as separate functions', () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cognitoUserPool: {
                pool: 'MyUserPool1',
                trigger: 'PreSignUp',
              },
            },
          ],
        },
        second: {
          events: [
            {
              cognitoUserPool: {
                pool: 'MyUserPool2',
                trigger: 'PostConfirmation',
              },
            },
          ],
        },
      };

      awsCompileCognitoUserPoolEvents.newCognitoUserPools();

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool1.Type
      ).to.equal('AWS::Cognito::UserPool');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool1.DependsOn
      ).to.have.lengthOf(1);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool2.Type
      ).to.equal('AWS::Cognito::UserPool');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool2.DependsOn
      ).to.have.lengthOf(1);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.FirstLambdaPermissionCognitoUserPoolMyUserPool1TriggerSourcePreSignUp.Type
      ).to.equal('AWS::Lambda::Permission');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.SecondLambdaPermissionCognitoUserPoolMyUserPool2TriggerSourcePostConfirmation
          .Type
      ).to.equal('AWS::Lambda::Permission');
    });

    it('should create resources when CUP events are given with the same function', () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cognitoUserPool: {
                pool: 'MyUserPool1',
                trigger: 'PreSignUp',
              },
            },
            {
              cognitoUserPool: {
                pool: 'MyUserPool2',
                trigger: 'PostConfirmation',
              },
            },
          ],
        },
      };

      awsCompileCognitoUserPoolEvents.newCognitoUserPools();

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool1.Type
      ).to.equal('AWS::Cognito::UserPool');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool1.DependsOn
      ).to.have.lengthOf(1);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool2.Type
      ).to.equal('AWS::Cognito::UserPool');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool2.DependsOn
      ).to.have.lengthOf(1);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.FirstLambdaPermissionCognitoUserPoolMyUserPool1TriggerSourcePreSignUp.Type
      ).to.equal('AWS::Lambda::Permission');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.FirstLambdaPermissionCognitoUserPoolMyUserPool2TriggerSourcePostConfirmation
          .Type
      ).to.equal('AWS::Lambda::Permission');
    });

    it('should create resources when CUP events are given with diff funcs and single event', () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cognitoUserPool: {
                pool: 'MyUserPool1',
                trigger: 'PreSignUp',
              },
            },
          ],
        },
        second: {
          events: [
            {
              cognitoUserPool: {
                pool: 'MyUserPool2',
                trigger: 'PreSignUp',
              },
            },
          ],
        },
      };

      awsCompileCognitoUserPoolEvents.newCognitoUserPools();

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool1.Type
      ).to.equal('AWS::Cognito::UserPool');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool1.DependsOn
      ).to.have.lengthOf(1);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool1.Properties.LambdaConfig.PreSignUp['Fn::GetAtt'][0]
      ).to.equal(
        serverless.service.serverless.getProvider('aws').naming.getLambdaLogicalId('first')
      );

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool2.Type
      ).to.equal('AWS::Cognito::UserPool');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool2.DependsOn
      ).to.have.lengthOf(1);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool2.Properties.LambdaConfig.PreSignUp['Fn::GetAtt'][0]
      ).to.equal(
        serverless.service.serverless.getProvider('aws').naming.getLambdaLogicalId('second')
      );

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.FirstLambdaPermissionCognitoUserPoolMyUserPool1TriggerSourcePreSignUp.Type
      ).to.equal('AWS::Lambda::Permission');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.SecondLambdaPermissionCognitoUserPoolMyUserPool2TriggerSourcePreSignUp.Type
      ).to.equal('AWS::Lambda::Permission');
    });

    it('should create single user pool resource when the same pool referenced repeatedly', () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cognitoUserPool: {
                pool: 'MyUserPool',
                trigger: 'PreSignUp',
              },
            },
          ],
        },
        second: {
          events: [
            {
              cognitoUserPool: {
                pool: 'MyUserPool',
                trigger: 'PostConfirmation',
              },
            },
          ],
        },
      };

      awsCompileCognitoUserPoolEvents.newCognitoUserPools();

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool.Type
      ).to.equal('AWS::Cognito::UserPool');
      expect(
        Object.keys(
          awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
            .Resources.CognitoUserPoolMyUserPool.Properties.LambdaConfig
        )
      ).to.have.lengthOf(2);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool.DependsOn
      ).to.have.lengthOf(2);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.FirstLambdaPermissionCognitoUserPoolMyUserPoolTriggerSourcePreSignUp.Type
      ).to.equal('AWS::Lambda::Permission');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.SecondLambdaPermissionCognitoUserPoolMyUserPoolTriggerSourcePostConfirmation
          .Type
      ).to.equal('AWS::Lambda::Permission');
    });

    it('should not create resources when CUP events are not given', () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          events: [],
        },
      };

      awsCompileCognitoUserPoolEvents.newCognitoUserPools();

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources
      ).to.deep.equal({});
    });
  });

  describe('#existingCognitoUserPools()', () => {
    it('should create the necessary resources for the most minimal configuration', async () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          name: 'first',
          events: [
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'CustomMessage',
                existing: true,
              },
            },
          ],
        },
      };

      return expect(
        awsCompileCognitoUserPoolEvents.existingCognitoUserPools()
      ).to.be.fulfilled.then(() => {
        const { Resources } =
          awsCompileCognitoUserPoolEvents.serverless.service.provider
            .compiledCloudFormationTemplate;

        expect(addCustomResourceToServiceStub).to.have.been.calledOnce;
        expect(addCustomResourceToServiceStub.args[0][1]).to.equal('cognitoUserPool');
        expect(addCustomResourceToServiceStub.args[0][2]).to.deep.equal([
          {
            Action: [
              'cognito-idp:ListUserPools',
              'cognito-idp:DescribeUserPool',
              'cognito-idp:UpdateUserPool',
            ],
            Effect: 'Allow',
            Resource: '*',
          },
          scopedCognitoAddPermissionStatement(),
          scopedCognitoRemovePermissionStatement(),
          {
            Effect: 'Allow',
            Resource: {
              'Fn::Sub': 'arn:${AWS::Partition}:iam::*:role/*',
            },
            Action: ['iam:PassRole'],
          },
        ]);
        expect(addCustomResourceToServiceStub.args[0][2][1].Resource).to.not.equal(
          addCustomResourceToServiceStub.args[0][2][2].Resource
        );
        expect(Resources.FirstCustomCognitoUserPool1).to.deep.equal({
          Type: 'Custom::CognitoUserPool',
          Version: 1,
          DependsOn: ['FirstLambdaFunction', 'CustomDashresourceDashexistingDashcupLambdaFunction'],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashcupLambdaFunction', 'Arn'],
            },
            FunctionName: 'first',
            UserPoolName: 'existing-cognito-user-pool',
            UserPoolConfigs: [
              {
                Trigger: 'CustomMessage',
              },
            ],
            ForceDeploy: undefined,
          },
        });
      });
    });

    it('should preserve KMS grants for existing custom sender triggers', async () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          name: 'first',
          events: [
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'CustomSMSSender',
                existing: true,
                kmsKeyId:
                  'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
              },
            },
          ],
        },
      };

      await awsCompileCognitoUserPoolEvents.existingCognitoUserPools();

      expect(addCustomResourceToServiceStub).to.have.been.calledOnce;
      expect(addCustomResourceToServiceStub.args[0][2]).to.deep.equal([
        {
          Effect: 'Allow',
          Resource: 'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
          Action: ['kms:CreateGrant'],
        },
        {
          Action: [
            'cognito-idp:ListUserPools',
            'cognito-idp:DescribeUserPool',
            'cognito-idp:UpdateUserPool',
          ],
          Effect: 'Allow',
          Resource: '*',
        },
        scopedCognitoAddPermissionStatement(),
        scopedCognitoRemovePermissionStatement(),
        {
          Effect: 'Allow',
          Resource: {
            'Fn::Sub': 'arn:${AWS::Partition}:iam::*:role/*',
          },
          Action: ['iam:PassRole'],
        },
      ]);
    });

    it('should preserve pool names named like __proto__ when tracking existing pools', async () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          name: 'first',
          events: [
            {
              cognitoUserPool: {
                pool: '__proto__',
                trigger: 'CustomMessage',
                existing: true,
              },
            },
          ],
        },
      };

      await awsCompileCognitoUserPoolEvents.existingCognitoUserPools();

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.FirstCustomCognitoUserPool1.Properties.UserPoolName
      ).to.equal('__proto__');
    });

    it('should support `forceDeploy` setting', async () => {
      const result = await runServerless({
        fixture: 'cognito-user-pool',
        configExt: {
          functions: {
            existingSimple: {
              events: [
                {
                  cognitoUserPool: {
                    forceDeploy: true,
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

      const customResource =
        Resources[awsNaming.getCustomResourceCognitoUserPoolResourceLogicalId('existingSimple')];

      expect(typeof customResource.Properties.ForceDeploy).to.equal('number');
    });

    it('should create the necessary resources for a service using multiple event definitions', async () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          name: 'first',
          events: [
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'CustomMessage',
                existing: true,
              },
            },
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'PreSignUp',
                existing: true,
              },
            },
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'DefineAuthChallenge',
                existing: true,
              },
            },
          ],
        },
      };

      return expect(
        awsCompileCognitoUserPoolEvents.existingCognitoUserPools()
      ).to.be.fulfilled.then(() => {
        const { Resources } =
          awsCompileCognitoUserPoolEvents.serverless.service.provider
            .compiledCloudFormationTemplate;

        expect(addCustomResourceToServiceStub).to.have.been.calledOnce;
        expect(addCustomResourceToServiceStub.args[0][1]).to.equal('cognitoUserPool');
        expect(addCustomResourceToServiceStub.args[0][2]).to.deep.equal([
          {
            Action: [
              'cognito-idp:ListUserPools',
              'cognito-idp:DescribeUserPool',
              'cognito-idp:UpdateUserPool',
            ],
            Effect: 'Allow',
            Resource: '*',
          },
          scopedCognitoAddPermissionStatement(),
          scopedCognitoRemovePermissionStatement(),
          {
            Effect: 'Allow',
            Resource: {
              'Fn::Sub': 'arn:${AWS::Partition}:iam::*:role/*',
            },
            Action: ['iam:PassRole'],
          },
        ]);
        expect(Resources.FirstCustomCognitoUserPool1).to.deep.equal({
          Type: 'Custom::CognitoUserPool',
          Version: 1,
          DependsOn: ['FirstLambdaFunction', 'CustomDashresourceDashexistingDashcupLambdaFunction'],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashcupLambdaFunction', 'Arn'],
            },
            FunctionName: 'first',
            UserPoolName: 'existing-cognito-user-pool',
            UserPoolConfigs: [
              {
                Trigger: 'CustomMessage',
              },
              {
                Trigger: 'PreSignUp',
              },
              {
                Trigger: 'DefineAuthChallenge',
              },
            ],
            ForceDeploy: undefined,
          },
        });
      });
    });

    it('should create DependsOn clauses when one cognito user pool is used in more than 1 custom resources', async () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          name: 'first',
          events: [
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'CustomMessage',
                existing: true,
              },
            },
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'PreSignUp',
                existing: true,
              },
            },
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'DefineAuthChallenge',
                existing: true,
              },
            },
          ],
        },
        second: {
          name: 'second',
          events: [
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'PostConfirmation',
                existing: true,
              },
            },
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'PreAuthentication',
                existing: true,
              },
            },
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'PostAuthentication',
                existing: true,
              },
            },
          ],
        },
      };

      return expect(
        awsCompileCognitoUserPoolEvents.existingCognitoUserPools()
      ).to.be.fulfilled.then(() => {
        const { Resources } =
          awsCompileCognitoUserPoolEvents.serverless.service.provider
            .compiledCloudFormationTemplate;

        expect(addCustomResourceToServiceStub).to.have.been.calledOnce;
        expect(addCustomResourceToServiceStub.args[0][1]).to.equal('cognitoUserPool');
        expect(addCustomResourceToServiceStub.args[0][2]).to.deep.equal([
          {
            Action: [
              'cognito-idp:ListUserPools',
              'cognito-idp:DescribeUserPool',
              'cognito-idp:UpdateUserPool',
            ],
            Effect: 'Allow',
            Resource: '*',
          },
          {
            Action: [
              'cognito-idp:ListUserPools',
              'cognito-idp:DescribeUserPool',
              'cognito-idp:UpdateUserPool',
            ],
            Effect: 'Allow',
            Resource: '*',
          },
          scopedCognitoAddPermissionStatement(),
          scopedCognitoRemovePermissionStatement(),
          {
            Effect: 'Allow',
            Resource: {
              'Fn::Sub': 'arn:${AWS::Partition}:iam::*:role/*',
            },
            Action: ['iam:PassRole'],
          },
        ]);
        expect(Object.keys(Resources)).to.have.length(2);
        expect(Resources.FirstCustomCognitoUserPool1).to.deep.equal({
          Type: 'Custom::CognitoUserPool',
          Version: 1,
          DependsOn: ['FirstLambdaFunction', 'CustomDashresourceDashexistingDashcupLambdaFunction'],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashcupLambdaFunction', 'Arn'],
            },
            FunctionName: 'first',
            UserPoolName: 'existing-cognito-user-pool',
            UserPoolConfigs: [
              {
                Trigger: 'CustomMessage',
              },
              {
                Trigger: 'PreSignUp',
              },
              {
                Trigger: 'DefineAuthChallenge',
              },
            ],
            ForceDeploy: undefined,
          },
        });
        expect(Resources.SecondCustomCognitoUserPool1).to.deep.equal({
          Type: 'Custom::CognitoUserPool',
          Version: 1,
          DependsOn: [
            'SecondLambdaFunction',
            'CustomDashresourceDashexistingDashcupLambdaFunction',
            'FirstCustomCognitoUserPool1',
          ],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashcupLambdaFunction', 'Arn'],
            },
            FunctionName: 'second',
            UserPoolName: 'existing-cognito-user-pool',
            UserPoolConfigs: [
              {
                Trigger: 'PostConfirmation',
              },
              {
                Trigger: 'PreAuthentication',
              },
              {
                Trigger: 'PostAuthentication',
              },
            ],
            ForceDeploy: undefined,
          },
        });
      });
    });

    it('should chain custom resources across different existing user pools', async () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          name: 'first',
          targetAlias: { logicalId: 'FirstLambdaAlias', name: 'live' },
          events: [
            {
              cognitoUserPool: {
                pool: 'first-existing-user-pool',
                trigger: 'CustomMessage',
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
              cognitoUserPool: {
                pool: 'second-existing-user-pool',
                trigger: 'PostConfirmation',
                existing: true,
              },
            },
          ],
        },
      };

      await awsCompileCognitoUserPoolEvents.existingCognitoUserPools();

      const { Resources } =
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate;

      expect(Resources.FirstCustomCognitoUserPool1.DependsOn).to.deep.equal([
        'FirstLambdaFunction',
        'FirstLambdaAlias',
        'CustomDashresourceDashexistingDashcupLambdaFunction',
      ]);
      expect(Resources.SecondCustomCognitoUserPool1.DependsOn).to.deep.equal([
        'SecondLambdaFunction',
        'SecondLambdaAlias',
        'CustomDashresourceDashexistingDashcupLambdaFunction',
        'FirstCustomCognitoUserPool1',
      ]);
    });

    it('should throw if more than 1 Cognito User Pool is configured per function', () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          name: 'first',
          events: [
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool',
                trigger: 'CustomMessage',
                existing: true,
              },
            },
            {
              cognitoUserPool: {
                pool: 'existing-cognito-user-pool-2',
                trigger: 'PreSignUp',
                existing: true,
              },
            },
          ],
        },
      };

      return expect(() => awsCompileCognitoUserPoolEvents.existingCognitoUserPools()).to.throw(
        'Only one Cognito User Pool'
      );
    });
  });

  describe('#mergeWithCustomResources()', () => {
    it('does not merge if no custom resource is found in Resources', () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cognitoUserPool: {
                pool: 'MyUserPool',
                trigger: 'PreSignUp',
              },
            },
          ],
        },
      };
      awsCompileCognitoUserPoolEvents.serverless.service.resources = {};

      awsCompileCognitoUserPoolEvents.newCognitoUserPools();
      awsCompileCognitoUserPoolEvents.mergeWithCustomResources();

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool.Type
      ).to.equal('AWS::Cognito::UserPool');
      expect(
        Object.keys(
          awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
            .Resources.CognitoUserPoolMyUserPool.Properties
        )
      ).to.have.lengthOf(2);
      expect(
        Object.keys(
          awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
            .Resources.CognitoUserPoolMyUserPool.Properties.LambdaConfig
        )
      ).to.have.lengthOf(1);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.FirstLambdaPermissionCognitoUserPoolMyUserPoolTriggerSourcePreSignUp.Type
      ).to.equal('AWS::Lambda::Permission');
    });

    it('should merge custom resources found in Resources', () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cognitoUserPool: {
                pool: 'MyUserPool',
                trigger: 'PreSignUp',
              },
            },
          ],
        },
      };
      awsCompileCognitoUserPoolEvents.serverless.service.resources = {
        CognitoUserPoolMyUserPool: {
          Type: 'AWS::Cognito::UserPool',
          Properties: {
            UserPoolName: 'ProdMyUserPool',
            MfaConfiguration: 'OFF',
            EmailVerificationSubject: 'Your verification code',
            EmailVerificationMessage: 'Your verification code is {####}.',
            SmsVerificationMessage: 'Your verification code is {####}.',
          },
        },
      };

      awsCompileCognitoUserPoolEvents.newCognitoUserPools();
      awsCompileCognitoUserPoolEvents.mergeWithCustomResources();

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool.Type
      ).to.equal('AWS::Cognito::UserPool');
      expect(
        Object.keys(
          awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
            .Resources.CognitoUserPoolMyUserPool.Properties
        )
      ).to.have.lengthOf(6);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool.DependsOn
      ).to.have.lengthOf(1);
      expect(
        Object.keys(
          awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
            .Resources.CognitoUserPoolMyUserPool.Properties.LambdaConfig
        )
      ).to.have.lengthOf(1);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.FirstLambdaPermissionCognitoUserPoolMyUserPoolTriggerSourcePreSignUp.Type
      ).to.equal('AWS::Lambda::Permission');
    });

    it('should merge `DependsOn` clauses correctly if being overridden from Resources', () => {
      awsCompileCognitoUserPoolEvents.serverless.service.functions = {
        first: {
          events: [
            {
              cognitoUserPool: {
                pool: 'MyUserPool',
                trigger: 'PreSignUp',
              },
            },
          ],
        },
      };
      awsCompileCognitoUserPoolEvents.serverless.service.resources = {
        CognitoUserPoolMyUserPool: {
          DependsOn: ['Something', 'SomethingElse', ['Nothing', 'NothingAtAll']],
          Type: 'AWS::Cognito::UserPool',
          Properties: {
            UserPoolName: 'ProdMyUserPool',
            MfaConfiguration: 'OFF',
            EmailVerificationSubject: 'Your verification code',
            EmailVerificationMessage: 'Your verification code is {####}.',
            SmsVerificationMessage: 'Your verification code is {####}.',
          },
        },
      };

      awsCompileCognitoUserPoolEvents.newCognitoUserPools();
      awsCompileCognitoUserPoolEvents.mergeWithCustomResources();

      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool.Type
      ).to.equal('AWS::Cognito::UserPool');
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.CognitoUserPoolMyUserPool.DependsOn
      ).to.have.lengthOf(4);
      expect(
        Object.keys(
          awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
            .Resources.CognitoUserPoolMyUserPool.Properties
        )
      ).to.have.lengthOf(6);
      expect(
        Object.keys(
          awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
            .Resources.CognitoUserPoolMyUserPool.Properties.LambdaConfig
        )
      ).to.have.lengthOf(1);
      expect(
        awsCompileCognitoUserPoolEvents.serverless.service.provider.compiledCloudFormationTemplate
          .Resources.FirstLambdaPermissionCognitoUserPoolMyUserPoolTriggerSourcePreSignUp.Type
      ).to.equal('AWS::Lambda::Permission');
    });
  });
});

describe('lib/plugins/aws/package/compile/events/cognito-user-pool.test.js', () => {
  let cfResources;
  let naming;
  let serverlessInstance;

  before(async () => {
    const { awsNaming, cfTemplate, serverless } = await runServerless({
      fixture: 'cognito-user-pool',
      configExt: {
        ...serverlessConfigurationExtension,
        functions: {
          ...serverlessConfigurationExtension.functions,
          provisionedExisting: {
            handler: 'index.js',
            provisionedConcurrency: 1,
            events: [
              {
                cognitoUserPool: {
                  pool: 'ProvisionedExistingPool',
                  trigger: 'PreSignUp',
                  existing: true,
                },
              },
            ],
          },
        },
        resources: {
          Resources: {
            CognitoUserPoolCUPCustomEmailSender: {
              DependsOn: [customUserPoolDependency],
            },
          },
        },
      },
      command: 'package',
    });

    ({ Resources: cfResources } = cfTemplate);
    naming = awsNaming;
    serverlessInstance = serverless;
  });

  describe('Fixture final templates', () => {
    it('should generate expected resources for new Cognito user pools', () => {
      const serviceName = serverlessInstance.service.service;
      const poolName = `${serviceName} CUP Basic`;
      const poolResource = cfResources[naming.getCognitoUserPoolLogicalId(poolName)];
      const permissionResource =
        cfResources[
          naming.getLambdaCognitoUserPoolPermissionLogicalId('basic', poolName, 'PreSignUp')
        ];

      expect(poolResource).to.deep.equal({
        Type: 'AWS::Cognito::UserPool',
        Properties: {
          UserPoolName: poolName,
          LambdaConfig: {
            PreSignUp: { 'Fn::GetAtt': [naming.getLambdaLogicalId('basic'), 'Arn'] },
          },
        },
        DependsOn: [naming.getLambdaLogicalId('basic')],
      });
      expect(permissionResource).to.deep.equal({
        Type: 'AWS::Lambda::Permission',
        DependsOn: undefined,
        Properties: {
          FunctionName: { 'Fn::GetAtt': [naming.getLambdaLogicalId('basic'), 'Arn'] },
          Action: 'lambda:InvokeFunction',
          Principal: 'cognito-idp.amazonaws.com',
          SourceArn: { 'Fn::GetAtt': [naming.getCognitoUserPoolLogicalId(poolName), 'Arn'] },
        },
      });
    });

    it('should target a generated alias for new pools when targetAlias is set', async () => {
      const { cfTemplate, awsNaming } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              provisionedConcurrency: 1,
              events: [{ cognitoUserPool: { pool: 'NewPool', trigger: 'PreSignUp' } }],
            },
          },
        },
        command: 'package',
      });

      const aliasLogicalId = awsNaming.getLambdaProvisionedConcurrencyAliasLogicalId('basic');
      const poolResource = cfTemplate.Resources[awsNaming.getCognitoUserPoolLogicalId('NewPool')];

      expect(poolResource.DependsOn).to.include(aliasLogicalId);
      expect(poolResource.Properties.LambdaConfig.PreSignUp).to.deep.equal({
        'Fn::Join': [
          ':',
          [
            { 'Fn::GetAtt': [awsNaming.getLambdaLogicalId('basic'), 'Arn'] },
            awsNaming.getLambdaProvisionedConcurrencyAliasName(),
          ],
        ],
      });
    });

    it('should target the durable alias for new pools on durable functions', async () => {
      const { cfTemplate, awsNaming } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              durableConfig: { executionTimeout: 900 },
              events: [{ cognitoUserPool: { pool: 'DurableNewPool', trigger: 'PreSignUp' } }],
            },
          },
        },
        command: 'package',
      });

      const aliasLogicalId = awsNaming.getLambdaDurableAliasLogicalId('basic');
      const poolResource =
        cfTemplate.Resources[awsNaming.getCognitoUserPoolLogicalId('DurableNewPool')];

      expect(poolResource.DependsOn).to.include(aliasLogicalId);
      expect(poolResource.Properties.LambdaConfig.PreSignUp).to.deep.equal({
        'Fn::Join': [
          ':',
          [
            { 'Fn::GetAtt': [awsNaming.getLambdaLogicalId('basic'), 'Arn'] },
            awsNaming.getLambdaDurableAliasName(),
          ],
        ],
      });
    });

    it('should merge generated Cognito user pool resources with custom resources', () => {
      const serviceName = serverlessInstance.service.service;
      const poolResource = cfResources[naming.getCognitoUserPoolLogicalId('CUP CustomEmailSender')];

      expect(poolResource.Type).to.equal('AWS::Cognito::UserPool');
      expect(poolResource.Properties).to.deep.include({
        UserPoolName: `${serviceName} CUP CustomEmailSender`,
        UsernameAttributes: ['email'],
        AutoVerifiedAttributes: ['email'],
        EmailVerificationMessage: 'email message: {####}',
        EmailVerificationSubject: 'email subject: {####}',
      });
      expect(poolResource.Properties.LambdaConfig).to.deep.equal({
        KMSKeyID: { 'Fn::GetAtt': ['kmsKey', 'Arn'] },
        CustomEmailSender: {
          LambdaArn: { 'Fn::GetAtt': [naming.getLambdaLogicalId('customEmailSender'), 'Arn'] },
          LambdaVersion: 'V1_0',
        },
      });
      expect(poolResource.DependsOn).to.deep.equal([
        naming.getLambdaLogicalId('customEmailSender'),
        customUserPoolDependency,
      ]);
    });

    it('should generate expected custom resources for existing Cognito user pools', () => {
      const serviceName = serverlessInstance.service.service;
      const simpleResource =
        cfResources[naming.getCustomResourceCognitoUserPoolResourceLogicalId('existingSimple')];
      const multiResource =
        cfResources[naming.getCustomResourceCognitoUserPoolResourceLogicalId('existingMulti')];
      const customSenderResource =
        cfResources[
          naming.getCustomResourceCognitoUserPoolResourceLogicalId('existingCustomEmailSender')
        ];
      const provisionedResource =
        cfResources[
          naming.getCustomResourceCognitoUserPoolResourceLogicalId('provisionedExisting')
        ];

      expect(simpleResource).to.deep.equal({
        Type: 'Custom::CognitoUserPool',
        Version: 1,
        DependsOn: [
          naming.getLambdaLogicalId('existingSimple'),
          naming.getCustomResourceCognitoUserPoolHandlerFunctionLogicalId(),
        ],
        Properties: {
          ServiceToken: {
            'Fn::GetAtt': [
              naming.getCustomResourceCognitoUserPoolHandlerFunctionLogicalId(),
              'Arn',
            ],
          },
          FunctionName: serverlessInstance.service.getFunction('existingSimple').name,
          UserPoolName: `${serviceName} CUP Existing Simple`,
          UserPoolConfigs: [{ Trigger: 'PreSignUp' }],
          ForceDeploy: undefined,
        },
      });
      expect(multiResource.Properties).to.deep.include({
        FunctionName: serverlessInstance.service.getFunction('existingMulti').name,
        UserPoolName: `${serviceName} CUP Existing Multi`,
        UserPoolConfigs: [{ Trigger: 'PreSignUp' }, { Trigger: 'PreAuthentication' }],
        ForceDeploy: undefined,
      });
      expect(customSenderResource.Properties.UserPoolConfigs).to.deep.equal([
        {
          Trigger: 'CustomEmailSender',
          KMSKeyID: { 'Fn::GetAtt': ['kmsKey', 'Arn'] },
          LambdaVersion: 'V1_0',
        },
      ]);
      expect(provisionedResource.DependsOn).to.deep.equal([
        naming.getLambdaLogicalId('provisionedExisting'),
        naming.getLambdaProvisionedConcurrencyAliasLogicalId('provisionedExisting'),
        naming.getCustomResourceCognitoUserPoolHandlerFunctionLogicalId(),
        naming.getCustomResourceCognitoUserPoolResourceLogicalId(
          'singleCustomSenderSourceForMultiplePoolsExisting2'
        ),
      ]);
      expect(provisionedResource.Properties).to.deep.include({
        FunctionName: serverlessInstance.service.getFunction('provisionedExisting').name,
        FunctionQualifier: naming.getLambdaProvisionedConcurrencyAliasName(),
        UserPoolName: 'ProvisionedExistingPool',
      });
    });

    it('should configure existing Cognito durable functions through the durable alias', async () => {
      const { cfTemplate, awsNaming, serverless } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            durableExisting: {
              handler: 'index.handler',
              runtime: 'nodejs24.x',
              durableConfig: { executionTimeout: 900 },
              events: [
                {
                  cognitoUserPool: {
                    pool: 'ExistingPool',
                    trigger: 'PreSignUp',
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
        cfTemplate.Resources[
          awsNaming.getCustomResourceCognitoUserPoolResourceLogicalId('durableExisting')
        ];

      expect(resource.DependsOn).to.include(
        awsNaming.getLambdaDurableAliasLogicalId('durableExisting')
      );
      expect(resource.Properties.FunctionName).to.equal(
        serverless.service.getFunction('durableExisting').name
      );
      expect(resource.Properties.FunctionQualifier).to.equal('durable');
    });
  });

  describe('Custom Sender Sources', () => {
    describe('Schema Issues', () => {
      it('should throw if more than 1 KMS Key is configured per new Cognito User Pool', async () => {
        return await expect(
          runServerless({
            fixture: 'function',
            configExt: {
              functions: {
                basic: {
                  events: [
                    {
                      cognitoUserPool: {
                        pool: 'MyUserPool1',
                        trigger: 'CustomSMSSender',
                        kmsKeyId:
                          'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
                      },
                    },
                    {
                      cognitoUserPool: {
                        pool: 'MyUserPool1',
                        trigger: 'CustomEmailSender',
                        kmsKeyId:
                          'arn:aws:kms:eu-west-1:111111111111:key/22222222-9abc-def0-1234-56789abcdef1',
                      },
                    },
                  ],
                },
              },
            },
            command: 'package',
          })
        ).to.eventually.be.rejectedWith('Only one KMS Key');
      });

      it('should throw if more than 1 KMS Key is configured per existing Cognito User Pool', async () => {
        return await expect(
          runServerless({
            fixture: 'function',
            configExt: {
              functions: {
                basic: {
                  events: [
                    {
                      cognitoUserPool: {
                        pool: 'MyUserPool1',
                        trigger: 'CustomSMSSender',
                        kmsKeyId:
                          'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
                        existing: true,
                      },
                    },
                    {
                      cognitoUserPool: {
                        pool: 'MyUserPool1',
                        trigger: 'CustomEmailSender',
                        kmsKeyId:
                          'arn:aws:kms:eu-west-1:111111111111:key/22222222-9abc-def0-1234-56789abcdef1',
                        existing: true,
                      },
                    },
                  ],
                },
              },
            },
            command: 'package',
          })
        ).to.eventually.be.rejectedWith('Only one KMS Key');
      });

      it('should throw if no KMS Key is configured for a new Cognito User Pool', () => {
        return expect(
          runServerless({
            fixture: 'function',
            configExt: {
              functions: {
                first: {
                  handler: 'index.js',
                  events: [
                    {
                      cognitoUserPool: {
                        pool: 'MyUserPool1',
                        trigger: 'CustomSMSSender',
                      },
                    },
                  ],
                },
              },
            },
            command: 'package',
          })
        ).to.eventually.be.rejectedWith('KMS Key must be set');
      });

      it('should throw if no KMS Key is configured for an existing Cognito User Pool', () => {
        return expect(
          runServerless({
            fixture: 'function',
            configExt: {
              functions: {
                first: {
                  handler: 'index.js',
                  events: [
                    {
                      cognitoUserPool: {
                        pool: 'MyUserPool1',
                        trigger: 'CustomSMSSender',
                        existing: true,
                      },
                    },
                  ],
                },
              },
            },
            command: 'package',
          })
        ).to.eventually.be.rejectedWith('KMS Key must be set');
      });
    });

    describe('New Pools', () => {
      it('should create resources when a KMS Key is configured as a string', () => {
        expect(cfResources.CognitoUserPoolSingleCustomSenderSourceKmsStringARN.Type).to.equal(
          'AWS::Cognito::UserPool'
        );
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceKmsStringARN.DependsOn
        ).to.have.lengthOf(1);
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceKmsStringARN.Properties.LambdaConfig
            .KMSKeyID
        ).to.equal('arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1');
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceKmsStringARN.Properties.LambdaConfig
            .CustomSMSSender.LambdaArn
        ).to.deep.equal({
          'Fn::GetAtt': ['SingleCustomSenderSourceKmsStringARNLambdaFunction', 'Arn'],
        });
        expect(
          cfResources
            .SingleCustomSenderSourceKmsStringARNLambdaPermissionCognitoUserPoolSingleCustomSenderSourceKmsStringARNTriggerSourceCustomSMSSender
            .Type
        ).to.equal('AWS::Lambda::Permission');
      });

      it('should create resources when a KMS Key is configured as ARN Reference', () => {
        expect(cfResources.CognitoUserPoolSingleCustomSenderSourceKmsRefARN.Type).to.equal(
          'AWS::Cognito::UserPool'
        );
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceKmsRefARN.DependsOn
        ).to.have.lengthOf(1);
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceKmsRefARN.Properties.LambdaConfig
            .KMSKeyID
        ).to.deep.equal({
          'Fn::GetAtt': ['kmsKey', 'Arn'],
        });
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceKmsRefARN.Properties.LambdaConfig
            .CustomSMSSender.LambdaArn
        ).to.deep.equal({
          'Fn::GetAtt': ['SingleCustomSenderSourceKmsRefARNLambdaFunction', 'Arn'],
        });
        expect(
          cfResources
            .SingleCustomSenderSourceKmsRefARNLambdaPermissionCognitoUserPoolSingleCustomSenderSourceKmsRefARNTriggerSourceCustomSMSSender
            .Type
        ).to.equal('AWS::Lambda::Permission');
      });

      it('should create resources when CUP events that specify multiple custom sender sources are given', () => {
        expect(cfResources.CognitoUserPoolMultipleCustomSenderSourceForSinglePool.Type).to.equal(
          'AWS::Cognito::UserPool'
        );
        expect(
          cfResources.CognitoUserPoolMultipleCustomSenderSourceForSinglePool.DependsOn
        ).to.have.lengthOf(2);
        expect(
          cfResources.CognitoUserPoolMultipleCustomSenderSourceForSinglePool.Properties.LambdaConfig
            .KMSKeyID
        ).to.equal('arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1');
        expect(
          cfResources.CognitoUserPoolMultipleCustomSenderSourceForSinglePool.Properties.LambdaConfig
            .CustomSMSSender.LambdaArn
        ).to.deep.equal({
          'Fn::GetAtt': ['MultipleCustomSenderSourceForSinglePoolLambdaFunction', 'Arn'],
        });
        expect(
          cfResources.CognitoUserPoolMultipleCustomSenderSourceForSinglePool.Properties.LambdaConfig
            .CustomEmailSender.LambdaArn
        ).to.deep.equal({
          'Fn::GetAtt': ['MultipleCustomSenderSourceForSinglePoolLambdaFunction', 'Arn'],
        });
        expect(
          cfResources
            .MultipleCustomSenderSourceForSinglePoolLambdaPermissionCognitoUserPoolMultipleCustomSenderSourceForSinglePoolTriggerSourceCustomSMSSender
            .Type
        ).to.equal('AWS::Lambda::Permission');
        expect(
          cfResources
            .MultipleCustomSenderSourceForSinglePoolLambdaPermissionCognitoUserPoolMultipleCustomSenderSourceForSinglePoolTriggerSourceCustomEmailSender
            .Type
        ).to.equal('AWS::Lambda::Permission');
      });

      it('should create resources when a single KMS Key is configured per new Cognito User Pool', () => {
        expect(cfResources.CognitoUserPoolSingleCustomSenderSourceForMultiplePools1.Type).to.equal(
          'AWS::Cognito::UserPool'
        );
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceForMultiplePools1.DependsOn
        ).to.have.lengthOf(1);
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceForMultiplePools1.Properties
            .LambdaConfig.KMSKeyID
        ).to.equal('arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1');
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceForMultiplePools1.Properties
            .LambdaConfig.CustomSMSSender.LambdaArn
        ).to.deep.equal({
          'Fn::GetAtt': ['SingleCustomSenderSourceForMultiplePools1LambdaFunction', 'Arn'],
        });
        expect(
          cfResources
            .SingleCustomSenderSourceForMultiplePools1LambdaPermissionCognitoUserPoolSingleCustomSenderSourceForMultiplePools1TriggerSourceCustomSMSSender
            .Type
        ).to.equal('AWS::Lambda::Permission');
        expect(cfResources.CognitoUserPoolSingleCustomSenderSourceForMultiplePools2.Type).to.equal(
          'AWS::Cognito::UserPool'
        );
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceForMultiplePools2.Properties
            .LambdaConfig.KMSKeyID
        ).to.equal('arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1');
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceForMultiplePools2.DependsOn
        ).to.have.lengthOf(1);
        expect(
          cfResources.CognitoUserPoolSingleCustomSenderSourceForMultiplePools2.Properties
            .LambdaConfig.CustomSMSSender.LambdaArn
        ).to.deep.equal({
          'Fn::GetAtt': ['SingleCustomSenderSourceForMultiplePools2LambdaFunction', 'Arn'],
        });
        expect(
          cfResources
            .SingleCustomSenderSourceForMultiplePools2LambdaPermissionCognitoUserPoolSingleCustomSenderSourceForMultiplePools2TriggerSourceCustomSMSSender
            .Type
        ).to.equal('AWS::Lambda::Permission');
      });
    });

    describe('Existing Pools', () => {
      it('should create resources when a KMS Key is configured as a string', () => {
        const functionName =
          cfResources.SingleCustomSenderSourceKmsStringARNExistingLambdaFunction.Properties
            .FunctionName;
        expect(
          cfResources.SingleCustomSenderSourceKmsStringARNExistingCustomCognitoUserPool1
        ).to.deep.equal({
          Type: 'Custom::CognitoUserPool',
          Version: 1,
          DependsOn: [
            'SingleCustomSenderSourceKmsStringARNExistingLambdaFunction',
            'CustomDashresourceDashexistingDashcupLambdaFunction',
            'ExistingCustomEmailSenderCustomCognitoUserPool1',
          ],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashcupLambdaFunction', 'Arn'],
            },
            FunctionName: functionName,
            UserPoolName: 'SingleCustomSenderSourceKmsStringARNExisting',
            UserPoolConfigs: [
              {
                Trigger: 'CustomSMSSender',
                KMSKeyID:
                  'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
                LambdaVersion: 'V1_0',
              },
            ],
            ForceDeploy: undefined,
          },
        });
      });

      it('should create resources when a KMS Key is configured as ARN Reference', () => {
        const functionName =
          cfResources.SingleCustomSenderSourceKmsRefARNExistingLambdaFunction.Properties
            .FunctionName;
        expect(
          cfResources.SingleCustomSenderSourceKmsRefARNExistingCustomCognitoUserPool1
        ).to.deep.equal({
          Type: 'Custom::CognitoUserPool',
          Version: 1,
          DependsOn: [
            'SingleCustomSenderSourceKmsRefARNExistingLambdaFunction',
            'CustomDashresourceDashexistingDashcupLambdaFunction',
            'SingleCustomSenderSourceKmsStringARNExistingCustomCognitoUserPool1',
          ],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashcupLambdaFunction', 'Arn'],
            },
            FunctionName: functionName,
            UserPoolName: 'SingleCustomSenderSourceKmsRefARNExisting',
            UserPoolConfigs: [
              {
                Trigger: 'CustomSMSSender',
                KMSKeyID: {
                  'Fn::GetAtt': ['kmsKey', 'Arn'],
                },
                LambdaVersion: 'V1_0',
              },
            ],
            ForceDeploy: undefined,
          },
        });
      });

      it('should create resources when CUP events that specify multiple custom sender sources are given', () => {
        const functionName =
          cfResources.MultipleCustomSenderSourceForSinglePoolExistingLambdaFunction.Properties
            .FunctionName;
        expect(
          cfResources.MultipleCustomSenderSourceForSinglePoolExistingCustomCognitoUserPool1
        ).to.deep.equal({
          Type: 'Custom::CognitoUserPool',
          Version: 1,
          DependsOn: [
            'MultipleCustomSenderSourceForSinglePoolExistingLambdaFunction',
            'CustomDashresourceDashexistingDashcupLambdaFunction',
            'SingleCustomSenderSourceKmsRefARNExistingCustomCognitoUserPool1',
          ],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashcupLambdaFunction', 'Arn'],
            },
            FunctionName: functionName,
            UserPoolName: 'MultipleCustomSenderSourceForSinglePoolExisting',
            UserPoolConfigs: [
              {
                Trigger: 'CustomSMSSender',
                KMSKeyID:
                  'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
                LambdaVersion: 'V1_0',
              },
              {
                Trigger: 'CustomEmailSender',
                KMSKeyID:
                  'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
                LambdaVersion: 'V1_0',
              },
            ],
            ForceDeploy: undefined,
          },
        });
      });

      it('should create resources when a single KMS Key is configured per new Cognito User Pool', () => {
        const functionName1 =
          cfResources.SingleCustomSenderSourceForMultiplePoolsExisting1LambdaFunction.Properties
            .FunctionName;
        expect(
          cfResources.SingleCustomSenderSourceForMultiplePoolsExisting1CustomCognitoUserPool1
        ).to.deep.equal({
          Type: 'Custom::CognitoUserPool',
          Version: 1,
          DependsOn: [
            'SingleCustomSenderSourceForMultiplePoolsExisting1LambdaFunction',
            'CustomDashresourceDashexistingDashcupLambdaFunction',
            'MultipleCustomSenderSourceForSinglePoolExistingCustomCognitoUserPool1',
          ],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashcupLambdaFunction', 'Arn'],
            },
            FunctionName: functionName1,
            UserPoolName: 'SingleCustomSenderSourceForMultiplePoolsExisting1',
            UserPoolConfigs: [
              {
                Trigger: 'CustomSMSSender',
                KMSKeyID:
                  'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
                LambdaVersion: 'V1_0',
              },
            ],
            ForceDeploy: undefined,
          },
        });

        const functionName2 =
          cfResources.SingleCustomSenderSourceForMultiplePoolsExisting2LambdaFunction.Properties
            .FunctionName;
        expect(
          cfResources.SingleCustomSenderSourceForMultiplePoolsExisting2CustomCognitoUserPool1
        ).to.deep.equal({
          Type: 'Custom::CognitoUserPool',
          Version: 1,
          DependsOn: [
            'SingleCustomSenderSourceForMultiplePoolsExisting2LambdaFunction',
            'CustomDashresourceDashexistingDashcupLambdaFunction',
            'SingleCustomSenderSourceForMultiplePoolsExisting1CustomCognitoUserPool1',
          ],
          Properties: {
            ServiceToken: {
              'Fn::GetAtt': ['CustomDashresourceDashexistingDashcupLambdaFunction', 'Arn'],
            },
            FunctionName: functionName2,
            UserPoolName: 'SingleCustomSenderSourceForMultiplePoolsExisting2',
            UserPoolConfigs: [
              {
                Trigger: 'CustomSMSSender',
                KMSKeyID:
                  'arn:aws:kms:eu-west-1:111111111111:key/11111111-9abc-def0-1234-56789abcdef1',
                LambdaVersion: 'V1_0',
              },
            ],
            ForceDeploy: undefined,
          },
        });
      });
    });
  });

  describe('PreTokenGeneration Lambda Versions', () => {
    describe('New Pools', () => {
      it('should create PreTokenGenerationConfig for V2_0', async () => {
        const { cfTemplate } = await runServerless({
          fixture: 'cognito-user-pool',
          configExt: preTokenGenerationConfigurationExtension,
          command: 'package',
        });

        const userPoolResource = cfTemplate.Resources.CognitoUserPoolPreTokenGenerationV2Pool;
        expect(userPoolResource.Properties.LambdaConfig).to.have.property(
          'PreTokenGenerationConfig'
        );
        expect(
          userPoolResource.Properties.LambdaConfig.PreTokenGenerationConfig.LambdaVersion
        ).to.equal('V2_0');
        expect(userPoolResource.Properties.LambdaConfig).to.not.have.property('PreTokenGeneration');
      });

      it('should create PreTokenGenerationConfig for V3_0', async () => {
        const { cfTemplate } = await runServerless({
          fixture: 'cognito-user-pool',
          configExt: preTokenGenerationConfigurationExtension,
          command: 'package',
        });

        const userPoolResource = cfTemplate.Resources.CognitoUserPoolPreTokenGenerationV3Pool;
        expect(userPoolResource.Properties.LambdaConfig).to.have.property(
          'PreTokenGenerationConfig'
        );
        expect(
          userPoolResource.Properties.LambdaConfig.PreTokenGenerationConfig.LambdaVersion
        ).to.equal('V3_0');
        expect(userPoolResource.Properties.LambdaConfig).to.not.have.property('PreTokenGeneration');
      });
    });

    describe('Existing Pools', () => {
      it('should create correct UserPoolConfigs for V2_0', async () => {
        const { cfTemplate } = await runServerless({
          fixture: 'cognito-user-pool',
          configExt: preTokenGenerationConfigurationExtension,
          command: 'package',
        });

        const customResources = Object.values(cfTemplate.Resources).filter(
          (resource) => resource.Type === 'Custom::CognitoUserPool'
        );
        const v2Resource = customResources.find(
          (resource) => resource.Properties.UserPoolName === 'PreTokenGenerationV2PoolExisting'
        );

        expect(v2Resource.Properties.UserPoolConfigs[0]).to.deep.include({
          Trigger: 'PreTokenGeneration',
          LambdaVersion: 'V2_0',
        });
      });
    });
  });
});
