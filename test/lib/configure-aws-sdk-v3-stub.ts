'use strict';

const { finished } = require('node:stream/promises');
const ensurePlainObject = require('type/plain-object/ensure');
const { hasOwn } = require('../../lib/utils/safe-object');

const serviceDefinitions = {
  APIGateway: {
    packageName: '@aws-sdk/client-api-gateway',
    clientName: 'APIGatewayClient',
    commands: {
      getApiKey: 'GetApiKeyCommand',
      getRestApis: 'GetRestApisCommand',
      getDeployments: 'GetDeploymentsCommand',
      getStage: 'GetStageCommand',
      createStage: 'CreateStageCommand',
      updateStage: 'UpdateStageCommand',
      tagResource: 'TagResourceCommand',
      untagResource: 'UntagResourceCommand',
      getUsagePlans: 'GetUsagePlansCommand',
      updateUsagePlan: 'UpdateUsagePlanCommand',
    },
  },
  ApiGatewayV2: {
    packageName: '@aws-sdk/client-apigatewayv2',
    clientName: 'ApiGatewayV2Client',
    commands: {
      getApi: 'GetApiCommand',
    },
  },
  CloudFormation: {
    packageName: '@aws-sdk/client-cloudformation',
    clientName: 'CloudFormationClient',
    commands: {
      describeStacks: 'DescribeStacksCommand',
      describeStackResources: 'DescribeStackResourcesCommand',
      listStackResources: 'ListStackResourcesCommand',
      describeStackResource: 'DescribeStackResourceCommand',
      validateTemplate: 'ValidateTemplateCommand',
      listExports: 'ListExportsCommand',
      createStack: 'CreateStackCommand',
      updateStack: 'UpdateStackCommand',
      deleteStack: 'DeleteStackCommand',
      createChangeSet: 'CreateChangeSetCommand',
      describeChangeSet: 'DescribeChangeSetCommand',
      executeChangeSet: 'ExecuteChangeSetCommand',
      deleteChangeSet: 'DeleteChangeSetCommand',
      getTemplate: 'GetTemplateCommand',
      setStackPolicy: 'SetStackPolicyCommand',
      updateTerminationProtection: 'UpdateTerminationProtectionCommand',
      describeStackEvents: 'DescribeStackEventsCommand',
    },
  },
  CloudWatch: {
    packageName: '@aws-sdk/client-cloudwatch',
    clientName: 'CloudWatchClient',
    commands: {
      getMetricStatistics: 'GetMetricStatisticsCommand',
    },
  },
  CloudWatchLogs: {
    packageName: '@aws-sdk/client-cloudwatch-logs',
    clientName: 'CloudWatchLogsClient',
    commands: {
      describeLogStreams: 'DescribeLogStreamsCommand',
      filterLogEvents: 'FilterLogEventsCommand',
      describeSubscriptionFilters: 'DescribeSubscriptionFiltersCommand',
      deleteSubscriptionFilter: 'DeleteSubscriptionFilterCommand',
      deleteLogGroup: 'DeleteLogGroupCommand',
    },
  },
  ECR: {
    packageName: '@aws-sdk/client-ecr',
    clientName: 'ECRClient',
    commands: {
      describeRepositories: 'DescribeRepositoriesCommand',
      getAuthorizationToken: 'GetAuthorizationTokenCommand',
      createRepository: 'CreateRepositoryCommand',
      putLifecyclePolicy: 'PutLifecyclePolicyCommand',
      describeImages: 'DescribeImagesCommand',
      deleteRepository: 'DeleteRepositoryCommand',
    },
  },
  IAM: {
    packageName: '@aws-sdk/client-iam',
    clientName: 'IAMClient',
    commands: {
      getRole: 'GetRoleCommand',
    },
  },
  Lambda: {
    packageName: '@aws-sdk/client-lambda',
    clientName: 'LambdaClient',
    commands: {
      getFunction: 'GetFunctionCommand',
      listVersionsByFunction: 'ListVersionsByFunctionCommand',
      invoke: 'InvokeCommand',
      getLayerVersion: 'GetLayerVersionCommand',
      updateFunctionCode: 'UpdateFunctionCodeCommand',
      updateFunctionConfiguration: 'UpdateFunctionConfigurationCommand',
    },
  },
  S3: {
    packageName: '@aws-sdk/client-s3',
    clientName: 'S3Client',
    commands: {
      getObject: 'GetObjectCommand',
      listObjectsV2: 'ListObjectsV2Command',
      listObjectVersions: 'ListObjectVersionsCommand',
      deleteObjects: 'DeleteObjectsCommand',
      headObject: 'HeadObjectCommand',
      headBucket: 'HeadBucketCommand',
    },
    paginators: {
      listObjectsV2: {
        name: 'paginateListObjectsV2',
        inputToken: 'ContinuationToken',
        outputToken: 'NextContinuationToken',
      },
    },
    extraMethods: ['upload'],
  },
  SSM: {
    packageName: '@aws-sdk/client-ssm',
    clientName: 'SSMClient',
    commands: {
      getParameter: 'GetParameterCommand',
    },
  },
  STS: {
    packageName: '@aws-sdk/client-sts',
    clientName: 'STSClient',
    commands: {
      getCallerIdentity: 'GetCallerIdentityCommand',
    },
  },
};

function getMethodByCommandName(definition, commandName) {
  for (const [method, candidateCommandName] of Object.entries(definition.commands)) {
    if (candidateCommandName === commandName) return method;
  }
  return null;
}

function createNamedClass(name, constructor) {
  Object.defineProperty(constructor, 'name', { value: name });
  return constructor;
}

async function resolveStubValue({
  state,
  service,
  method,
  value,
  input,
  context,
  passContextToCallbacks,
}) {
  const callKey = `${service}.${method}`;
  const callIndex = state.callCounts.get(callKey) || 0;
  state.callCounts.set(callKey, callIndex + 1);

  if (Array.isArray(value)) {
    value = value[Math.min(callIndex, value.length - 1)];
  }

  if (typeof value !== 'function') return value;
  return passContextToCallbacks ? value(input, context) : value(input);
}

function isReadableUploadBody(body) {
  return body && typeof body.on === 'function' && typeof body.resume === 'function';
}

async function drainUploadBody(body) {
  if (!isReadableUploadBody(body)) return;
  if (body.destroyed && body.errored) throw body.errored;

  const bodyFinishedPromise = finished(body, {
    readable: true,
    writable: false,
    cleanup: true,
  });
  body.resume();
  await bodyFinishedPromise;
}

function getMethodStub(stubMap, service, method) {
  const serviceConfig = stubMap[service];
  if (!serviceConfig || !hasOwn(serviceConfig, method)) {
    throw new Error(`Missing AWS SDK v3 stub configuration for ${service}.${method}`);
  }
  return serviceConfig[method];
}

function supportsMethod(definition, method) {
  return (
    definition.commands[method] ||
    (definition.paginators || {})[method] ||
    (definition.extraMethods || []).includes(method)
  );
}

function createLibStorageModuleStub({ stubMap, state, passContextToCallbacks }) {
  return {
    Upload: createNamedClass(
      'Upload',
      class {
        constructor(options) {
          this.options = options;
          this.client = options.client;
          this.params = options.params;
        }

        on() {
          return this;
        }

        async done() {
          const context = {
            service: 'S3',
            method: 'upload',
            commandName: 'Upload',
            input: this.params,
            clientConfig: this.client && this.client.config,
            client: this.client,
            upload: this,
            options: this.options,
          };
          state.sends.push(context);

          const value = getMethodStub(stubMap, 'S3', 'upload');
          const uploadResultPromise = resolveStubValue({
            state,
            service: 'S3',
            method: 'upload',
            value,
            input: this.params,
            context,
            passContextToCallbacks,
          });
          const bodyDrainPromise = drainUploadBody(this.params && this.params.Body);
          const [uploadResult] = await Promise.all([uploadResultPromise, bodyDrainPromise]);
          return uploadResult;
        }
      }
    ),
  };
}

function createModuleStub({ service, definition, stubMap, state, passContextToCallbacks }) {
  const exports = {};

  const Client = createNamedClass(
    definition.clientName,
    class {
      constructor(config) {
        this.config = config;
        this.service = service;
        state.clients.push({ service, config, client: this });
      }

      async send(command) {
        const commandName = command.__awsSdkV3StubCommandName || command.constructor.name;
        const method = getMethodByCommandName(definition, commandName);
        if (!method) throw new Error(`Unsupported AWS SDK v3 stub command ${commandName}`);

        const input = command.input;
        const context = {
          service,
          method,
          commandName,
          input,
          clientConfig: this.config,
          client: this,
          command,
        };
        state.sends.push(context);

        const value = getMethodStub(stubMap, service, method);
        return resolveStubValue({
          state,
          service,
          method,
          value,
          input,
          context,
          passContextToCallbacks,
        });
      }
    }
  );
  exports[definition.clientName] = Client;

  for (const commandName of Object.values(definition.commands)) {
    exports[commandName] = createNamedClass(
      commandName,
      class {
        constructor(input) {
          this.input = input;
          this.__awsSdkV3StubCommandName = commandName;
        }
      }
    );
  }

  for (const [method, paginator] of Object.entries(definition.paginators || {})) {
    exports[paginator.name] = async function* paginate(config, input) {
      if (!config || !config.client || typeof config.client.send !== 'function') {
        throw new Error(`AWS SDK v3 stub paginator ${paginator.name} requires config.client.send`);
      }
      const Command = exports[definition.commands[method]];
      if (!Command) throw new Error(`Unsupported AWS SDK v3 stub paginator method ${method}`);
      let nextToken = input && input[paginator.inputToken];
      do {
        const pageInput = { ...input };
        if (nextToken) pageInput[paginator.inputToken] = nextToken;
        else delete pageInput[paginator.inputToken];
        const page = await config.client.send(new Command(pageInput));
        yield page;
        nextToken = page && page[paginator.outputToken];
      } while (nextToken);
    };
  }

  return exports;
}

module.exports = (
  stubMap,
  { ignoreUnsupportedServices = false, passContextToCallbacks = true } = {}
) => {
  stubMap = ensurePlainObject(stubMap, {
    errorMessage: 'Expected `awsSdkV3StubMap` to be a plain object, received %v',
  });

  const state = { clients: [], sends: [], callCounts: new Map() };
  const modulesCacheStub = {};

  for (const service of Object.keys(stubMap)) {
    const definition = serviceDefinitions[service];
    if (!definition) {
      if (ignoreUnsupportedServices) continue;
      throw new Error(`Unsupported AWS SDK v3 stub service ${service}`);
    }
    if (
      ignoreUnsupportedServices &&
      !Object.keys(stubMap[service]).some((method) => supportsMethod(definition, method))
    ) {
      continue;
    }
    modulesCacheStub[definition.packageName] = createModuleStub({
      service,
      definition,
      stubMap,
      state,
      passContextToCallbacks,
    });
    if (service === 'S3') {
      modulesCacheStub['@aws-sdk/lib-storage'] = createLibStorageModuleStub({
        stubMap,
        state,
        passContextToCallbacks,
      });
    }
  }

  return {
    modulesCacheStub,
    clients: state.clients,
    sends: state.sends,
  };
};
