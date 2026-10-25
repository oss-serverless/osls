import memoize from 'memoizee';
import validate from './lib/validate.ts';
import compileRestApi from './lib/rest-api.ts';
import compileRequestValidators from './lib/request-validator.ts';
import compileApiKeys from './lib/api-keys.ts';
import compileUsagePlan from './lib/usage-plan.ts';
import compileUsagePlanKeys from './lib/usage-plan-keys.ts';
import compileResources from './lib/resources.ts';
import compileCors from './lib/cors.ts';
import compileMethods from './lib/method/index.ts';
import compileAuthorizers from './lib/authorizers.ts';
import compileDeployment from './lib/deployment.ts';
import compilePermissions from './lib/permissions.ts';
import compileStage from './lib/stage.ts';
import getMethodAuthorization from './lib/method/authorization.ts';
import getMethodIntegration from './lib/method/integration.ts';
import getMethodResponses from './lib/method/responses.ts';

function caseInsensitive(str) {
  return { type: 'string', regexp: new RegExp(`^${str}$`, 'i').toString() };
}

const contentHandlingSchema = { enum: ['CONVERT_TO_BINARY', 'CONVERT_TO_TEXT'] };

const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS', 'HEAD', 'DELETE', 'ANY'];
const methodPattern = new RegExp(`^(?:\\*|${allowedMethods.join('|')})$`, 'i');
const methodPathPattern = new RegExp(`^(?:\\*|(${allowedMethods.join('|')}) (\\/\\S*))$`, 'i');

const requestParametersSchema = {
  type: 'object',
  additionalProperties: {
    anyOf: [
      { type: 'boolean' },
      {
        type: 'object',
        properties: {
          required: { type: 'boolean' },
          mappedValue: { $ref: '#/definitions/awsCfInstruction' },
        },
        additionalProperties: false,
      },
    ],
  },
};

const authorizerSchema = {
  anyOf: [
    { type: 'string' },
    {
      type: 'object',
      properties: {
        arn: { $ref: '#/definitions/awsArn' },
        authorizerId: { $ref: '#/definitions/awsCfInstruction' },
        claims: { type: 'array', items: { type: 'string' } },
        identitySource: { type: 'string' },
        identityValidationExpression: { type: 'string' },
        managedExternally: { type: 'boolean' },
        name: { type: 'string' },
        resultTtlInSeconds: { type: 'integer', minimum: 0, maximum: 3600 },
        scopes: {
          type: 'array',
          items: {
            anyOf: [{ type: 'string' }, { $ref: '#/definitions/awsCfInstruction' }],
          },
        },
        type: {
          anyOf: ['token', 'cognito_user_pools', 'request', 'aws_iam', 'custom'].map(
            caseInsensitive
          ),
        },
      },
      required: [],
      additionalProperties: false,
    },
  ],
};

const corsSchema = {
  anyOf: [
    { type: 'boolean' },
    {
      type: 'object',
      properties: {
        allowCredentials: { type: 'boolean' },
        cacheControl: { type: 'string' },
        headers: { type: 'array', items: { type: 'string' } },
        maxAge: { type: 'integer', minimum: 1 },
        methods: { type: 'array', items: { enum: allowedMethods } },
        origin: { type: 'string' },
        origins: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      additionalProperties: false,
    },
  ],
};

const requestSchema = {
  type: 'object',
  properties: {
    contentHandling: contentHandlingSchema,
    method: { type: 'string', regexp: methodPattern.toString() },
    parameters: {
      type: 'object',
      properties: {
        querystrings: requestParametersSchema,
        headers: requestParametersSchema,
        paths: requestParametersSchema,
      },
      additionalProperties: false,
    },
    passThrough: { enum: ['NEVER', 'WHEN_NO_MATCH', 'WHEN_NO_TEMPLATES'] },
    schemas: {
      type: 'object',
      additionalProperties: { anyOf: [{ type: 'object' }, { type: 'string' }] },
    },
    template: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    uri: { $ref: '#/definitions/awsCfInstruction' },
  },
  additionalProperties: false,
};

const responseSchema = {
  type: 'object',
  properties: {
    contentHandling: contentHandlingSchema,
    headers: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    template: { type: 'string' },
    transferMode: {
      anyOf: ['BUFFERED', 'STREAM'].map(caseInsensitive),
    },
    statusCodes: {
      type: 'object',
      propertyNames: {
        type: 'string',
        pattern: '^\\d{3}$',
      },
      additionalProperties: {
        type: 'object',
        properties: {
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          pattern: { type: 'string' },
          template: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
            ],
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

class AwsCompileApigEvents {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    this.serverless.configSchemaHandler.defineFunctionEvent('aws', 'http', {
      anyOf: [
        { type: 'string', regexp: methodPathPattern.toString() },
        {
          type: 'object',
          properties: {
            async: { type: 'boolean' },
            authorizer: authorizerSchema,
            connectionId: { $ref: '#/definitions/awsCfInstruction' },
            connectionType: { anyOf: ['vpc-link', 'VPC_LINK'].map(caseInsensitive) },
            cors: corsSchema,
            integration: {
              anyOf: [
                'LAMBDA_PROXY',
                'LAMBDA-PROXY',
                'LAMBDA',
                'AWS',
                'AWS_PROXY',
                'AWS-PROXY',
                'HTTP',
                'HTTP_PROXY',
                'HTTP-PROXY',
                'MOCK',
              ].map(caseInsensitive),
            },
            method: { type: 'string', regexp: methodPattern.toString() },
            operationId: { type: 'string' },
            path: { type: 'string', regexp: /^(?:\*|\/?\S*)$/.toString() },
            private: { type: 'boolean' },
            request: requestSchema,
            response: responseSchema,
            timeoutInMillis: { type: 'integer', minimum: 50 },
          },
          required: ['path', 'method'],
          additionalProperties: false,
        },
      ],
    });

    // used for the generated method logical ids (GET, PATCH, PUT, DELETE, OPTIONS, ...)
    this.apiGatewayMethodLogicalIds = [];

    Object.assign(
      this,
      validate,
      compileRestApi,
      compileApiKeys,
      compileUsagePlan,
      compileUsagePlanKeys,
      compileResources,
      compileCors,
      compileMethods,
      compileRequestValidators,
      compileAuthorizers,
      compileDeployment,
      compilePermissions,
      compileStage,
      getMethodAuthorization,
      getMethodIntegration,
      getMethodResponses
    );

    this.createRequestValidator = memoize(this.createRequestValidator.bind(this));

    this.hooks = {
      'package:compileEvents': async () => {
        this.validated = this.validate();

        if (this.validated.events.length === 0) {
          return;
        }

        await this.compileRestApi();
        await this.compileResources();
        await this.compileCors();
        await this.compileMethods();
        await this.compileRequestValidators();
        await this.compileAuthorizers();
        await this.compileDeployment();
        await this.compileApiKeys();
        await this.compileUsagePlan();
        await this.compileUsagePlanKeys();
        await this.compilePermissions();
        await this.compileStage();
      },

      // TODO should be removed once AWS fixes the CloudFormation problems using a separate Stage
      'after:deploy:deploy': async () => {
        const getServiceState = (await import('../../../../lib/get-service-state.ts')).default
          .getServiceState;

        const state = getServiceState.call(this);
        const updateStage = (await import('./lib/hack/update-stage.ts')).default.updateStage;

        this.state = state;
        return updateStage.call(this);
      },

      // TODO should be removed once AWS fixes the removal via CloudFormation
      'before:remove:remove': async () => {
        const globalValidate = (await import('../../../../lib/validate.ts')).default.validate;
        const disassociateUsagePlan = (await import('./lib/hack/disassociate-usage-plan.ts'))
          .default.disassociateUsagePlan;

        await globalValidate.call(this);
        return disassociateUsagePlan.call(this);
      },
    };
  }
}

export default AwsCompileApigEvents;
