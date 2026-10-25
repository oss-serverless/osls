import validate from './lib/validate.ts';
import compileApi from './lib/api.ts';
import compileIntegrations from './lib/integrations.ts';
import compileRouteResponses from './lib/route-responses.ts';
import compilePermissions from './lib/permissions.ts';
import compileRoutes from './lib/routes.ts';
import compileDeployment from './lib/deployment.ts';
import compileStage from './lib/stage.ts';
import compileAuthorizers from './lib/authorizers.ts';

class AwsCompileWebsockets {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    Object.assign(
      this,
      validate,
      compileApi,
      compileIntegrations,
      compileRouteResponses,
      compileAuthorizers,
      compilePermissions,
      compileRoutes,
      compileDeployment,
      compileStage
    );

    this.hooks = {
      'package:compileEvents': async () => {
        this.validated = this.validate();

        if (this.validated.events.length === 0) {
          return;
        }

        await this.compileApi();
        await this.compileIntegrations();
        await this.compileRouteResponses();
        await this.compileAuthorizers();
        await this.compilePermissions();
        await this.compileRoutes();
        await this.compileStage();
        return this.compileDeployment();
      },
    };

    this.serverless.configSchemaHandler.defineFunctionEvent('aws', 'websocket', {
      anyOf: [
        { type: 'string' },
        {
          type: 'object',
          properties: {
            route: { type: 'string' },
            routeResponseSelectionExpression: {
              const: '$default',
            },
            authorizer: {
              anyOf: [
                { $ref: '#/definitions/awsArnString' },
                { $ref: '#/definitions/functionName' },
                {
                  type: 'object',
                  properties: {
                    name: { $ref: '#/definitions/functionName' },
                    arn: { $ref: '#/definitions/awsArn' },
                    identitySource: { type: 'array', items: { type: 'string' } },
                  },
                  anyOf: [{ required: ['name'] }, { required: ['arn'] }],
                  additionalProperties: false,
                },
              ],
            },
          },
          required: ['route'],
          additionalProperties: false,
        },
      ],
    });
  }
}

export default AwsCompileWebsockets;
