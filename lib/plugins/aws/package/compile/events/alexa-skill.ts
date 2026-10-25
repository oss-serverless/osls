'use strict';

const resolveLambdaTarget = require('../../../utils/resolve-lambda-target');

class AwsCompileAlexaSkillEvents {
  constructor(serverless) {
    this.serverless = serverless;
    this.provider = this.serverless.getProvider('aws');

    this.serverless.configSchemaHandler.defineFunctionEvent('aws', 'alexaSkill', {
      anyOf: [
        { $ref: '#/definitions/awsAlexaEventToken' },
        {
          type: 'object',
          properties: {
            appId: { $ref: '#/definitions/awsAlexaEventToken' },
            enabled: { type: 'boolean' },
          },
          required: ['appId'],
          additionalProperties: false,
        },
      ],
    });

    this.hooks = {
      'package:compileEvents': async () => this.compileAlexaSkillEvents(),
    };
  }

  compileAlexaSkillEvents() {
    this.serverless.service.getAllFunctions().forEach((functionName) => {
      const functionObj = this.serverless.service.getFunction(functionName);
      let alexaSkillNumberInFunction = 0;

      functionObj.events.forEach((event) => {
        if (event.alexaSkill) {
          let enabled = true;
          let appId;
          if (typeof event.alexaSkill === 'string') {
            appId = event.alexaSkill;
          } else {
            appId = event.alexaSkill.appId;
            // Parameter `enabled` is optional, hence the explicit non-equal check for false.
            enabled = event.alexaSkill.enabled !== false;
          }
          alexaSkillNumberInFunction++;

          const permissionTemplate = {
            Type: 'AWS::Lambda::Permission',
            DependsOn: functionObj.targetAlias && functionObj.targetAlias.logicalId,
            Properties: {
              FunctionName: resolveLambdaTarget(functionName, functionObj),
              Action: enabled ? 'lambda:InvokeFunction' : 'lambda:DisableInvokeFunction',
              Principal: 'alexa-appkit.amazon.com',
            },
          };

          if (appId) {
            permissionTemplate.Properties.EventSourceToken = appId.replace(/\\n|\\r/g, '');
          }

          const lambdaPermissionLogicalId =
            this.provider.naming.getLambdaAlexaSkillPermissionLogicalId(
              functionName,
              alexaSkillNumberInFunction
            );

          const permissionCloudForamtionResource = {
            [lambdaPermissionLogicalId]: permissionTemplate,
          };

          Object.assign(
            this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
            permissionCloudForamtionResource
          );
        }
      });
    });
  }
}

module.exports = AwsCompileAlexaSkillEvents;
