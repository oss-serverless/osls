'use strict';

const ServerlessError = require('../../../../../../serverless-error');
const { makeAndHashRuleName, makeEventBusTargetId, makeRuleName } = require('./utils');
const resolveLambdaTarget = require('../../../../utils/resolve-lambda-target');
const isObject = require('type/object/is');

class AwsCompileEventBridgeEvents {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'package:compileEvents': async () => this.compileEventBridgeEvents(),
    };

    this.serverless.configSchemaHandler.defineFunctionEvent('aws', 'eventBridge', {
      type: 'object',
      properties: {
        eventBus: {
          anyOf: [
            { type: 'string', minLength: 1 },
            { $ref: '#/definitions/awsArnString' },
            { $ref: '#/definitions/awsCfImport' },
            { $ref: '#/definitions/awsCfRef' },
            // GetAtt should only reference "Name" property of EventBus
            {
              type: 'object',
              properties: {
                'Fn::GetAtt': {
                  type: 'array',
                  minItems: 2,
                  maxItems: 2,
                  items: [
                    { type: 'string', minLength: 1 },
                    { type: 'string', enum: ['Name'] },
                  ],
                },
              },
              required: ['Fn::GetAtt'],
              additionalProperties: false,
            },
          ],
        },
        schedule: { pattern: '^(?:cron|rate)\\(.+\\)$', type: 'string' },
        name: { type: 'string', pattern: '[a-zA-Z0-9-_.]+', minLength: 1, maxLength: 64 },
        description: { type: 'string', maxLength: 512 },
        enabled: { type: 'boolean' },
        pattern: {
          type: 'object',
          properties: {
            'version': {},
            'id': {},
            'detail-type': {},
            'source': {},
            'account': {},
            'time': {},
            'region': {},
            'resources': {},
            'detail': {},
            '$or': { type: 'array' },
          },
          additionalProperties: false,
        },
        input: { type: 'object' },
        inputPath: { type: 'string', minLength: 1, maxLength: 256 },
        inputTransformer: {
          type: 'object',
          properties: {
            inputPathsMap: {
              type: 'object',
              additionalProperties: { type: 'string', minLength: 1 },
            },
            inputTemplate: { type: 'string', minLength: 1, maxLength: 8192 },
          },
          required: ['inputTemplate'],
          additionalProperties: false,
        },
        retryPolicy: {
          type: 'object',
          properties: {
            maximumEventAge: {
              type: 'integer',
              minimum: 60,
              maximum: 86400,
            },
            maximumRetryAttempts: {
              type: 'integer',
              minimum: 0,
              maximum: 185,
            },
          },
        },
        deadLetterQueueArn: { $ref: '#/definitions/awsArn' },
      },
      anyOf: [{ required: ['pattern'] }, { required: ['schedule'] }],
    });
  }

  compileEventBridgeEvents() {
    const { service } = this.serverless;
    const { provider } = service;
    const { compiledCloudFormationTemplate } = provider;

    service.getAllFunctions().forEach((functionName) => {
      const functionObj = service.getFunction(functionName);
      const FunctionName = functionObj.name;

      if (functionObj.events) {
        functionObj.events.forEach((event, idx) => {
          if (event.eventBridge) {
            idx++;
            const Description = event.eventBridge.description;
            const EventBus = event.eventBridge.eventBus;
            const Schedule = event.eventBridge.schedule;
            const Pattern = event.eventBridge.pattern;
            const Input = event.eventBridge.input;
            const InputPath = event.eventBridge.inputPath;
            let RuleName = event.eventBridge.name;
            let InputTransformer = event.eventBridge.inputTransformer;
            let RetryPolicy = event.eventBridge.retryPolicy;
            let DeadLetterConfig;

            if (!RuleName) {
              RuleName = makeAndHashRuleName({
                functionName: FunctionName,
                index: idx,
              });
            }

            let State = 'ENABLED';
            if (event.eventBridge.enabled === false) {
              State = 'DISABLED';
            }

            if ([Input, InputPath, InputTransformer].filter(Boolean).length > 1) {
              throw new ServerlessError(
                [
                  'You can only set one of input, inputPath, or inputTransformer ',
                  'properties for eventBridge events.',
                ].join(''),
                'EVENTBRIDGE_MULTIPLE_INPUT_PROPERTIES'
              );
            }

            if (InputTransformer) {
              InputTransformer = Object.fromEntries(
                Object.entries(InputTransformer).map(([key, value]) => [
                  key[0].toLocaleUpperCase() + key.slice(1),
                  value,
                ])
              );
            }

            if (RetryPolicy) {
              RetryPolicy = {
                MaximumEventAgeInSeconds: RetryPolicy.maximumEventAge,
                MaximumRetryAttempts: RetryPolicy.maximumRetryAttempts,
              };
            }

            if (event.eventBridge.deadLetterQueueArn) {
              DeadLetterConfig = {
                Arn: event.eventBridge.deadLetterQueueArn,
              };
            }

            const eventBusName = EventBus;
            this.compileWithCloudFormation({
              eventBusName,
              Description,
              EventBus,
              compiledCloudFormationTemplate,
              functionName,
              RuleName,
              State,
              Input,
              InputPath,
              InputTransformer,
              Pattern,
              Schedule,
              FunctionName,
              idx,
              RetryPolicy,
              DeadLetterConfig,
            });
          }
        });
      }
    });

    return null;
  }

  compileWithCloudFormation({
    eventBusName: _eventBusName,
    Description,
    EventBus,
    compiledCloudFormationTemplate,
    functionName,
    RuleName,
    State,
    Input,
    InputPath,
    InputTransformer,
    Pattern,
    Schedule,
    FunctionName,
    RetryPolicy,
    DeadLetterConfig,
    idx,
  }) {
    let eventBusResource;
    let eventBusExists = false;
    let eventBusName = _eventBusName;

    // It suggests that the object already exists and is being imported
    if (isObject(eventBusName)) {
      eventBusExists = true;
    }

    // Does the resource already exist? ARN string - assume it is valid - CF will validate ultimately
    if (typeof eventBusName === 'string' && eventBusName.startsWith('arn')) {
      eventBusExists = true;
      eventBusName = EventBus.slice(EventBus.indexOf('/') + 1);
    }

    const shouldCreateEventBus = !eventBusExists && eventBusName && eventBusName !== 'default';
    if (shouldCreateEventBus) {
      // Create EventBus Resource
      eventBusResource = {
        Type: 'AWS::Events::EventBus',
        Properties: {
          Name: eventBusName,
        },
      };

      compiledCloudFormationTemplate.Resources[
        this.provider.naming.getEventBridgeEventBusLogicalId(eventBusName)
      ] = eventBusResource;
    }

    const functionObj = this.serverless.service.getFunction(functionName);
    const targetBase = {
      Arn: resolveLambdaTarget(functionName, functionObj),
      Id: makeEventBusTargetId(RuleName),
    };

    const target = this.configureTarget({
      target: targetBase,
      Input,
      InputPath,
      InputTransformer,
      RetryPolicy,
      DeadLetterConfig,
    });

    // Create a rule
    const eventRuleResource = {
      Type: 'AWS::Events::Rule',
      DependsOn: functionObj.targetAlias && functionObj.targetAlias.logicalId,
      Properties: {
        Description,
        // default event bus is used when EventBusName is not set
        EventBusName: eventBusName === 'default' ? undefined : eventBusName,
        EventPattern: Pattern,
        Name: RuleName,
        ScheduleExpression: Schedule,
        State,
        Targets: [target],
      },
    };
    // If this stack is creating the event bus the rule must depend on it to ensure stack can be removed
    if (shouldCreateEventBus) {
      const dependsOn = [
        eventRuleResource.DependsOn,
        this.provider.naming.getEventBridgeEventBusLogicalId(eventBusName),
      ].filter(Boolean);
      eventRuleResource.DependsOn = dependsOn.length === 1 ? dependsOn[0] : dependsOn;
    }

    const ruleNameLogicalIdStub = makeRuleName({
      functionName: FunctionName,
      index: idx,
    });

    compiledCloudFormationTemplate.Resources[
      this.provider.naming.getEventBridgeRuleLogicalId(ruleNameLogicalIdStub)
    ] = eventRuleResource;

    const ruleNameArnPath =
      eventBusName && eventBusName !== 'default' ? [eventBusName, RuleName] : [RuleName];
    const lambdaPermissionResource = {
      Type: 'AWS::Lambda::Permission',
      DependsOn: functionObj.targetAlias && functionObj.targetAlias.logicalId,
      Properties: {
        Action: 'lambda:InvokeFunction',
        FunctionName: resolveLambdaTarget(functionName, functionObj),
        Principal: 'events.amazonaws.com',
        SourceArn: {
          'Fn::Join': [
            ':',
            [
              'arn',
              { Ref: 'AWS::Partition' },
              'events',
              { Ref: 'AWS::Region' },
              { Ref: 'AWS::AccountId' },
              {
                'Fn::Join': ['/', ['rule', ...ruleNameArnPath]],
              },
            ],
          ],
        },
      },
    };

    compiledCloudFormationTemplate.Resources[
      this.provider.naming.getEventBridgeLambdaPermissionLogicalId(functionName, idx)
    ] = lambdaPermissionResource;
  }

  configureTarget({ target, Input, InputPath, InputTransformer, RetryPolicy, DeadLetterConfig }) {
    if (RetryPolicy) {
      target = Object.assign(target, {
        RetryPolicy,
      });
    }

    if (DeadLetterConfig) {
      target = Object.assign(target, {
        DeadLetterConfig,
      });
    }

    if (Input) {
      target = Object.assign(target, {
        Input: JSON.stringify(Input),
      });
      return target;
    }
    if (InputPath) {
      target = Object.assign(target, {
        InputPath,
      });
      return target;
    }
    if (InputTransformer) {
      target = Object.assign(target, {
        InputTransformer,
      });
      return target;
    }

    return target;
  }
}

module.exports = AwsCompileEventBridgeEvents;
