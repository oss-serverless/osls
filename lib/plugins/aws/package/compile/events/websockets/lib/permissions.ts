'use strict';

const resolveLambdaTarget = require('../../../../../utils/resolve-lambda-target');
const isObject = require('type/object/is');

module.exports = {
  compilePermissions() {
    this.validated.events.forEach((event) => {
      const websocketApiId = this.provider.getApiGatewayWebsocketApiId();
      const lambdaLogicalId = this.provider.naming.getLambdaLogicalId(event.functionName);
      const functionObj = this.serverless.service.getFunction(event.functionName);
      const aliasDependsOn = functionObj.targetAlias && functionObj.targetAlias.logicalId;

      const websocketsPermissionLogicalId =
        this.provider.naming.getLambdaWebsocketsPermissionLogicalId(event.functionName);

      this.serverless.service.provider.compiledCloudFormationTemplate.Resources[
        websocketsPermissionLogicalId
      ] = {
        Type: 'AWS::Lambda::Permission',
        DependsOn: [websocketApiId.Ref, aliasDependsOn || lambdaLogicalId].filter(Boolean),
        Properties: {
          FunctionName: resolveLambdaTarget(event.functionName, functionObj),
          Action: 'lambda:InvokeFunction',
          Principal: 'apigateway.amazonaws.com',
        },
      };

      if (event.authorizer) {
        const websocketsAuthorizerPermissionLogicalId =
          this.provider.naming.getLambdaWebsocketsPermissionLogicalId(event.authorizer.name);

        const authorizerPermissionTemplate = {
          [websocketsAuthorizerPermissionLogicalId]: {
            Type: 'AWS::Lambda::Permission',
            DependsOn: websocketApiId.Ref ? [websocketApiId.Ref] : [],
            Properties: {
              Action: 'lambda:InvokeFunction',
              Principal: 'apigateway.amazonaws.com',
            },
          },
        };

        if (isObject(event.authorizer.permission) || event.authorizer.permission.includes(':')) {
          authorizerPermissionTemplate[
            websocketsAuthorizerPermissionLogicalId
          ].Properties.FunctionName = event.authorizer.permission;
        } else {
          const permissionFunctionObj = this.serverless.service.getFunction(event.authorizer.name);
          const permissionAliasDependsOn =
            permissionFunctionObj.targetAlias && permissionFunctionObj.targetAlias.logicalId;

          authorizerPermissionTemplate[
            websocketsAuthorizerPermissionLogicalId
          ].Properties.FunctionName = resolveLambdaTarget(
            event.authorizer.name,
            permissionFunctionObj
          );

          authorizerPermissionTemplate[websocketsAuthorizerPermissionLogicalId].DependsOn.push(
            event.authorizer.permission
          );

          if (permissionAliasDependsOn) {
            authorizerPermissionTemplate[websocketsAuthorizerPermissionLogicalId].DependsOn.push(
              permissionAliasDependsOn
            );
          }
        }

        Object.assign(
          this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
          authorizerPermissionTemplate
        );
      }
    });
  },
};
