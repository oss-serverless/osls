'use strict';

const { addCustomResourceToService } = require('../../../custom-resources');
const ServerlessError = require('../../../../../serverless-error');
const resolveLambdaTarget = require('../../../utils/resolve-lambda-target');
const mergePlainObjects = require('../../../../../utils/merge-plain-objects');
const { createRegistry, hasOwn } = require('../../../../../utils/safe-object');

const customSenderSources = ['CustomSMSSender', 'CustomEmailSender'];
const validTriggerSources = [
  'PreSignUp',
  'PostConfirmation',
  'PreAuthentication',
  'PostAuthentication',
  'PreTokenGeneration',
  'CustomMessage',
  'DefineAuthChallenge',
  'CreateAuthChallenge',
  'VerifyAuthChallengeResponse',
  'UserMigration',
].concat(customSenderSources);

const customSenderValidVersions = ['V1_0'];
const preTokenGenerationValidVersions = ['V1_0', 'V2_0', 'V3_0'];

class AwsCompileCognitoUserPoolEvents {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'package:compileEvents': async () => {
        await this.newCognitoUserPools();
        return this.existingCognitoUserPools();
      },
      'after:package:finalize': async () => this.mergeWithCustomResources(),
    };

    this.serverless.configSchemaHandler.defineFunctionEvent('aws', 'cognitoUserPool', {
      type: 'object',
      properties: {
        pool: { type: 'string', maxLength: 128, pattern: '^[\\w\\s+=,.@-]+$' },
        trigger: { enum: validTriggerSources },
        existing: { type: 'boolean' },
        forceDeploy: { type: 'boolean' },
        kmsKeyId: { $ref: '#/definitions/awsKmsArn' },
      },
      required: ['pool', 'trigger'],
      additionalProperties: false,
    });
  }

  newCognitoUserPools() {
    const { service } = this.serverless;
    service.getAllFunctions().forEach((functionName) => {
      const functionObj = service.getFunction(functionName);
      if (functionObj.events) {
        functionObj.events.forEach((event) => {
          if (event.cognitoUserPool) {
            // return immediately if it's an existing Cognito User Pool event since we treat them differently
            if (event.cognitoUserPool.existing) return null;

            const result = this.findUserPoolsAndFunctions();
            const cognitoUserPoolTriggerFunctions = result.cognitoUserPoolTriggerFunctions;
            const userPools = result.userPools;

            // Generate CloudFormation templates for Cognito User Pool changes
            userPools.forEach((poolName) => {
              const currentPoolTriggerFunctions = cognitoUserPoolTriggerFunctions.filter(
                (triggerFn) => triggerFn.poolName === poolName
              );
              const userPoolCFResource = this.generateTemplateForPool(
                poolName,
                currentPoolTriggerFunctions
              );

              Object.assign(
                this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
                userPoolCFResource
              );
            });

            // Generate CloudFormation templates for IAM permissions to allow Cognito to trigger Lambda
            cognitoUserPoolTriggerFunctions.forEach((cognitoUserPoolTriggerFunction) => {
              const userPoolLogicalId = this.provider.naming.getCognitoUserPoolLogicalId(
                cognitoUserPoolTriggerFunction.poolName
              );

              const triggerFunctionObj = service.getFunction(
                cognitoUserPoolTriggerFunction.functionName
              );

              const permissionTemplate = {
                Type: 'AWS::Lambda::Permission',
                DependsOn:
                  triggerFunctionObj.targetAlias && triggerFunctionObj.targetAlias.logicalId,
                Properties: {
                  FunctionName: resolveLambdaTarget(
                    cognitoUserPoolTriggerFunction.functionName,
                    triggerFunctionObj
                  ),
                  Action: 'lambda:InvokeFunction',
                  Principal: 'cognito-idp.amazonaws.com',
                  SourceArn: {
                    'Fn::GetAtt': [userPoolLogicalId, 'Arn'],
                  },
                },
              };
              const lambdaPermissionLogicalId =
                this.provider.naming.getLambdaCognitoUserPoolPermissionLogicalId(
                  cognitoUserPoolTriggerFunction.functionName,
                  cognitoUserPoolTriggerFunction.poolName,
                  cognitoUserPoolTriggerFunction.triggerSource
                );
              const permissionCFResource = {
                [lambdaPermissionLogicalId]: permissionTemplate,
              };
              Object.assign(
                this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
                permissionCFResource
              );
            });
          }
          return null;
        });
      }
      return null;
    });
  }

  existingCognitoUserPools() {
    const { service } = this.serverless;
    const { provider } = service;
    const { compiledCloudFormationTemplate } = provider;
    const { Resources } = compiledCloudFormationTemplate;
    const iamRoleStatements = [];
    let usesExistingCognitoUserPool = false;

    // used to keep track of the custom resources created for each Cognito User Pool
    const poolResources = createRegistry();
    const poolKmsIdMap = new Map();

    service.getAllFunctions().forEach((functionName) => {
      let numEventsForFunc = 0;
      let currentPoolName = null;
      const functionObj = service.getFunction(functionName);
      const FunctionName = functionObj.name;
      const functionQualifier = functionObj.targetAlias && functionObj.targetAlias.name;
      const targetAliasLogicalId = functionObj.targetAlias && functionObj.targetAlias.logicalId;

      if (functionObj.events) {
        functionObj.events.forEach((event) => {
          if (event.cognitoUserPool && event.cognitoUserPool.existing) {
            numEventsForFunc++;
            const { pool, trigger, forceDeploy, kmsKeyId, lambdaVersion } = event.cognitoUserPool;
            usesExistingCognitoUserPool = true;

            this.validateLambdaVersion(trigger, lambdaVersion);

            if (!currentPoolName) {
              currentPoolName = pool;
            }
            if (pool !== currentPoolName) {
              const errorMessage = [
                'Only one Cognito User Pool can be configured per function.',
                ` In "${FunctionName}" you're attempting to configure "${currentPoolName}" and "${pool}" at the same time.`,
              ].join('');
              throw new ServerlessError(errorMessage, 'COGNITO_MULTIPLE_USER_POOLS_PER_FUNCTION');
            }

            const eventFunctionLogicalId = this.provider.naming.getLambdaLogicalId(functionName);
            const customResourceFunctionLogicalId =
              this.provider.naming.getCustomResourceCognitoUserPoolHandlerFunctionLogicalId();
            const customPoolResourceLogicalId =
              this.provider.naming.getCustomResourceCognitoUserPoolResourceLogicalId(functionName);

            // store how often the custom Cognito User Pool resource is used
            if (hasOwn(poolResources, pool)) {
              poolResources[pool] = Array.from(
                new Set([...poolResources[pool], customPoolResourceLogicalId])
              );
            } else {
              poolResources[pool] = [customPoolResourceLogicalId];
            }

            let customCognitoUserPoolResource;
            const forceDeployProperty = forceDeploy ? Date.now() : undefined;

            let userPoolConfig = {
              Trigger: trigger,
            };
            if (customSenderSources.includes(trigger)) {
              userPoolConfig = {
                ...userPoolConfig,
                ...{
                  LambdaVersion: lambdaVersion || customSenderValidVersions[0],
                },
              };

              this.checkKmsArn(kmsKeyId, poolKmsIdMap, pool);
              userPoolConfig.KMSKeyID = kmsKeyId;
            } else if (trigger === 'PreTokenGeneration' && lambdaVersion) {
              userPoolConfig.LambdaVersion = lambdaVersion;
            }

            if (numEventsForFunc === 1) {
              if (customSenderSources.includes(trigger) && kmsKeyId) {
                iamRoleStatements.push({
                  Effect: 'Allow',
                  Resource: kmsKeyId,
                  Action: ['kms:CreateGrant'],
                });
              }
              customCognitoUserPoolResource = {
                [customPoolResourceLogicalId]: {
                  Type: 'Custom::CognitoUserPool',
                  Version: 1.0,
                  DependsOn: [
                    eventFunctionLogicalId,
                    targetAliasLogicalId,
                    customResourceFunctionLogicalId,
                  ].filter(Boolean),
                  Properties: {
                    ServiceToken: {
                      'Fn::GetAtt': [customResourceFunctionLogicalId, 'Arn'],
                    },
                    FunctionName,
                    ...(functionQualifier && { FunctionQualifier: functionQualifier }),
                    UserPoolName: pool,
                    UserPoolConfigs: [userPoolConfig],
                    ForceDeploy: forceDeployProperty,
                  },
                },
              };

              iamRoleStatements.push({
                Effect: 'Allow',
                Resource: '*',
                Action: [
                  'cognito-idp:ListUserPools',
                  'cognito-idp:DescribeUserPool',
                  'cognito-idp:UpdateUserPool',
                ],
              });
            } else {
              Resources[customPoolResourceLogicalId].Properties.UserPoolConfigs.push(
                userPoolConfig
              );
            }

            if (customCognitoUserPoolResource) {
              Object.assign(Resources, customCognitoUserPoolResource);
            }
          }
        });
      }
    });

    if (usesExistingCognitoUserPool) {
      iamRoleStatements.push({
        Effect: 'Allow',
        Resource: {
          'Fn::Sub': 'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:*',
        },
        Action: ['lambda:AddPermission'],
        Condition: {
          StringEquals: {
            'lambda:Principal': 'cognito-idp.amazonaws.com',
          },
        },
      });
      iamRoleStatements.push({
        Effect: 'Allow',
        Resource: {
          'Fn::Sub': 'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:*',
        },
        Action: ['lambda:RemovePermission'],
      });
      iamRoleStatements.push({
        Effect: 'Allow',
        Resource: {
          'Fn::Sub': 'arn:${AWS::Partition}:iam::*:role/*',
        },
        Action: ['iam:PassRole'],
      });
    }

    const allCustomResourceLogicalIds = Array.from(new Set(Object.values(poolResources).flat()));

    allCustomResourceLogicalIds.forEach((currResourceLogicalId, idx) => {
      if (idx > 0) {
        Resources[currResourceLogicalId].DependsOn.push(allCustomResourceLogicalIds[idx - 1]);
      }
    });

    if (iamRoleStatements.length) {
      return addCustomResourceToService(this.provider, 'cognitoUserPool', iamRoleStatements);
    }

    return null;
  }

  checkKmsArn(kmsKeyId, poolKmsIdMap, currentPoolName) {
    // KMSKeyId is only used (and is required) with Custom Sender Sources
    if (!kmsKeyId) {
      throw new ServerlessError(
        `KMS Key must be set when using a Custom Sender Source Trigger (CustomSMSSender and/or CustomEmailSender). Affected Cognito User Pool: "${currentPoolName}".`,
        'COGNITO_KMS_KEY_NOT_SET'
      );
    }

    const previousKmsId = poolKmsIdMap.get(currentPoolName);
    if (
      previousKmsId !== undefined &&
      previousKmsId !== kmsKeyId &&
      JSON.stringify(previousKmsId) !== JSON.stringify(kmsKeyId)
    ) {
      throw new ServerlessError(
        `Only one KMS Key for can be configured per Cognito User Pool. Affected Cognito User Pool: "${currentPoolName}".`,
        'COGNITO_KMS_KEY_ID_NOT_SAME_FOR_SINGLE_USER_POOL'
      );
    }
    poolKmsIdMap.set(currentPoolName, kmsKeyId);
  }

  validateLambdaVersion(trigger, lambdaVersion) {
    if (customSenderSources.includes(trigger)) {
      if (lambdaVersion && !customSenderValidVersions.includes(lambdaVersion)) {
        throw new ServerlessError(
          `Invalid lambdaVersion "${lambdaVersion}" for trigger "${trigger}". Custom sender triggers only support: ${customSenderValidVersions.join(
            ', '
          )}`,
          'COGNITO_INVALID_LAMBDA_VERSION'
        );
      }
    } else if (trigger === 'PreTokenGeneration') {
      if (lambdaVersion && !preTokenGenerationValidVersions.includes(lambdaVersion)) {
        throw new ServerlessError(
          `Invalid lambdaVersion "${lambdaVersion}" for trigger "${trigger}". PreTokenGeneration supports: ${preTokenGenerationValidVersions.join(
            ', '
          )}`,
          'COGNITO_INVALID_LAMBDA_VERSION'
        );
      }
    } else if (lambdaVersion) {
      throw new ServerlessError(
        `lambdaVersion is not supported for trigger "${trigger}". It's only supported for: CustomSMSSender, CustomEmailSender, and PreTokenGeneration`,
        'COGNITO_LAMBDA_VERSION_NOT_SUPPORTED'
      );
    }
  }

  findUserPoolsAndFunctions() {
    const userPools = [];
    const cognitoUserPoolTriggerFunctions = [];

    // Iterate through all functions declared in `serverless.yml`
    this.serverless.service.getAllFunctions().forEach((functionName) => {
      const functionObj = this.serverless.service.getFunction(functionName);

      if (functionObj.events) {
        functionObj.events.forEach((event) => {
          if (event.cognitoUserPool) {
            if (event.cognitoUserPool.existing) return;

            this.validateLambdaVersion(
              event.cognitoUserPool.trigger,
              event.cognitoUserPool.lambdaVersion
            );

            // Save trigger functions so we can use them to generate
            // IAM permissions later
            cognitoUserPoolTriggerFunctions.push({
              functionName,
              poolName: event.cognitoUserPool.pool,
              triggerSource: event.cognitoUserPool.trigger,
              kmsKeyId: event.cognitoUserPool.kmsKeyId,
              lambdaVersion: event.cognitoUserPool.lambdaVersion,
            });

            // Save user pools so we can use them to generate
            // CloudFormation resources later
            userPools.push(event.cognitoUserPool.pool);
          }
        });
      }
    });

    return { cognitoUserPoolTriggerFunctions, userPools };
  }

  generateTemplateForPool(poolName, currentPoolTriggerFunctions) {
    const poolKmsIdMap = new Map();
    const lambdaConfig = currentPoolTriggerFunctions.reduce((result, value) => {
      const functionObj = this.serverless.service.getFunction(value.functionName);

      let triggerObject;
      if (customSenderSources.includes(value.triggerSource)) {
        triggerObject = {
          [value.triggerSource]: {
            LambdaArn: resolveLambdaTarget(value.functionName, functionObj),
            LambdaVersion: value.lambdaVersion || customSenderValidVersions[0],
          },
        };
        this.checkKmsArn(value.kmsKeyId, poolKmsIdMap, poolName);
        triggerObject.KMSKeyID = value.kmsKeyId;
      } else if (value.triggerSource === 'PreTokenGeneration' && value.lambdaVersion) {
        triggerObject = {
          PreTokenGenerationConfig: {
            LambdaArn: resolveLambdaTarget(value.functionName, functionObj),
            LambdaVersion: value.lambdaVersion,
          },
        };
      } else {
        triggerObject = {
          [value.triggerSource]: resolveLambdaTarget(value.functionName, functionObj),
        };
      }

      // Return a new object to avoid lint errors
      return Object.assign({}, result, triggerObject);
    }, {});

    const userPoolLogicalId = this.provider.naming.getCognitoUserPoolLogicalId(poolName);

    // Attach `DependsOn` for any relevant Lambdas
    const DependsOn = currentPoolTriggerFunctions.map((value) => {
      const functionObj = this.serverless.service.getFunction(value.functionName);
      return (
        (functionObj.targetAlias && functionObj.targetAlias.logicalId) ||
        this.provider.naming.getLambdaLogicalId(value.functionName)
      );
    });

    return {
      [userPoolLogicalId]: {
        Type: 'AWS::Cognito::UserPool',
        Properties: {
          UserPoolName: poolName,
          LambdaConfig: lambdaConfig,
        },
        DependsOn,
      },
    };
  }

  mergeWithCustomResources() {
    const result = this.findUserPoolsAndFunctions();
    const cognitoUserPoolTriggerFunctions = result.cognitoUserPoolTriggerFunctions;
    const userPools = result.userPools;

    userPools.forEach((poolName) => {
      const currentPoolTriggerFunctions = cognitoUserPoolTriggerFunctions.filter(
        (triggerFn) => triggerFn.poolName === poolName
      );
      const userPoolLogicalId = this.provider.naming.getCognitoUserPoolLogicalId(poolName);

      // If overrides exist in `Resources`, merge them in
      const customResources =
        this.serverless.service.resources &&
        (this.serverless.service.resources.Resources || this.serverless.service.resources);

      if (customResources && customResources[userPoolLogicalId]) {
        const customUserPool = customResources[userPoolLogicalId];
        const generatedUserPool = this.generateTemplateForPool(
          poolName,
          currentPoolTriggerFunctions
        )[userPoolLogicalId];

        // Merge `DependsOn` clauses
        const customUserPoolDependsOn = customUserPool.DependsOn || [];
        const DependsOn = generatedUserPool.DependsOn.concat(customUserPoolDependsOn);

        // Merge default and custom resources, and `DependsOn` clause
        const mergedTemplate = mergePlainObjects({}, generatedUserPool, customUserPool);
        mergedTemplate.DependsOn = DependsOn;

        // Merge resource back into `Resources`
        this.serverless.service.provider.compiledCloudFormationTemplate.Resources[
          userPoolLogicalId
        ] = mergedTemplate;
      }
    });
  }
}

module.exports = AwsCompileCognitoUserPoolEvents;
