'use strict';

const { isDeepStrictEqual } = require('node:util');
const promiseLimit = require('ext/promise/limit').bind(Promise);
const {
  APIGatewayClient,
  CreateStageCommand,
  GetDeploymentsCommand,
  GetRestApisCommand,
  GetStageCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateStageCommand,
} = require('@aws-sdk/client-api-gateway');
const { CloudWatchLogsClient, DeleteLogGroupCommand } = require('@aws-sdk/client-cloudwatch-logs');
const ServerlessError = require('../../../../../../../../serverless-error');
const { safeShallowAssign } = require('../../../../../../../../utils/safe-object');
const { isApiGatewayNotFoundError } = require('../../../../../../../../aws/aws-sdk-v3-error');

const defaultApiGatewayLogFormat = [
  'requestId: $context.requestId',
  'ip: $context.identity.sourceIp',
  'caller: $context.identity.caller',
  'user: $context.identity.user',
  'requestTime: $context.requestTime',
  'httpMethod: $context.httpMethod',
  'resourcePath: $context.resourcePath',
  'status: $context.status',
  'protocol: $context.protocol',
  'responseLength: $context.responseLength',
].join(', ');
const defaultApiGatewayLogLevel = 'INFO';

// NOTE --> Keep this file in sync with ../stage.js

// NOTE: This code was written since there are problem setting up dedicated CloudFormation
// Stage resource (see https://github.com/serverless/serverless/pull/5692#issuecomment-467849311 for more information).

module.exports = {
  defaultApiGatewayLogLevel,
  async updateStage() {
    const provider = this.state.service.provider;
    this.hasTracingConfigured = provider.tracing && provider.tracing.apiGateway != null;
    this.hasMetricsConfigured = provider.apiGateway && provider.apiGateway.metrics != null;
    this.hasLogsConfigured = provider.logs && provider.logs.restApi != null;
    this.hasTagsConfigured = provider.tags != null || provider.stackTags != null;

    if (
      !this.hasTracingConfigured &&
      !this.hasLogsConfigured &&
      !this.hasTagsConfigured &&
      !this.hasMetricsConfigured
    ) {
      return null;
    }

    this.apiGatewayStagePatchOperations = [];
    this.apiGatewayTagResourceParams = [];
    this.apiGatewayUntagResourceParams = [];
    this.apiGatewayStageState = {};
    this.apiGatewayDeploymentId = null;
    this.apiGatewayRestApiId = null;
    this.limitApiGatewayRequests = promiseLimit(2, async (task) => task());

    const getApiGateway = createAwsSdkV3ClientGetter(
      () => this.provider.getAwsSdkV3Config(),
      APIGatewayClient
    );
    const getCloudWatchLogs = createAwsSdkV3ClientGetter(
      () => this.provider.getAwsSdkV3Config(),
      CloudWatchLogsClient
    );

    await resolveAccountInfo.call(this);
    await resolveRestApiId.call(this, getApiGateway);
    if (this.apiGatewayRestApiId) await resolveDeploymentId.call(this, getApiGateway);

    if (this.isExternalRestApi) return null;
    if (!this.apiGatewayDeploymentId) {
      if (!this.serverless.utils.isEventUsed(this.state.service.functions, 'http')) return null;
      if (!this.hasTracingConfigured && !this.hasLogsConfigured) return null;

      const errorMessage = [
        'Rest API id could not be resolved.\n',
        'This might be caused by a custom API Gateway configuration.\n\n',
        'In given setup stage specific options such as ',
        '`tracing`, `logs` and `tags` are not supported.\n\n',
        'Please update your configuration (or open up an issue if you feel ',
        "that there's a way to support your setup).",
      ].join('');

      throw new ServerlessError(errorMessage, 'API_GATEWAY_REST_API_ID_NOT_RESOLVED');
    }

    await resolveStage.call(this, getApiGateway);
    await ensureStage.call(this, getApiGateway);
    handleTracing.call(this);
    handleMetrics.call(this);
    handleLogs.call(this);
    handleTags.call(this);
    await applyUpdates.call(this, getApiGateway);
    await addTags.call(this, getApiGateway);
    await removeTags.call(this, getApiGateway);
    return removeAccessLoggingLogGroup.call(this, getCloudWatchLogs);
  },
};

function createAwsSdkV3ClientGetter(getAwsSdkV3Config, Client) {
  let clientPromise;
  return () => {
    if (!clientPromise) clientPromise = getAwsSdkV3Config().then((config) => new Client(config));
    return clientPromise;
  };
}

async function resolveAccountInfo() {
  return this.provider.getAccountInfo().then((account) => {
    this.accountId = account.accountId;
    this.partition = account.partition;
  });
}

function resolveApiGatewayResource(resources) {
  const apiGatewayResources = Object.fromEntries(
    Object.entries(resources).filter(([, resource]) => resource.Type === 'AWS::ApiGateway::RestApi')
  );
  const apiGatewayResourcesIds = Object.keys(apiGatewayResources);
  if (apiGatewayResourcesIds.length !== 1) return null;
  const apiGatewayResourceId = apiGatewayResourcesIds[0];
  if (
    !Object.keys(resources).some((key) => {
      const resource = resources[key];
      if (resource.Type !== 'AWS::ApiGateway::Deployment') return false;
      if (!resource.Properties || !resource.Properties.RestApiId) return false;
      return resource.Properties.RestApiId.Ref === apiGatewayResourceId;
    })
  ) {
    return null;
  }
  return apiGatewayResources[apiGatewayResourceId];
}

async function resolveRestApiId(getApiGateway) {
  const provider = this.state.service.provider;
  const externalRestApiId = provider.apiGateway && provider.apiGateway.restApiId;
  if (externalRestApiId) {
    this.isExternalRestApi = true;
    this.apiGatewayRestApiId = null;
    return;
  }
  const apiGatewayResource = resolveApiGatewayResource(
    this.serverless.service.provider.compiledCloudFormationTemplate.Resources
  );
  if (
    !apiGatewayResource &&
    // If there are 'http' events, assume that there is API Gateway configured
    // it's just probably hidden in nested stack (some rely on plugins that split stacks)
    !this.serverless.utils.isEventUsed(this.state.service.functions, 'http')
  ) {
    this.apiGatewayRestApiId = null;
    return;
  }
  const apiName = apiGatewayResource
    ? apiGatewayResource.Properties.Name
    : this.provider.naming.getApiGatewayName();
  const apiGateway = await getApiGateway();
  const resolveFromAws = async (position) => {
    const result = await apiGateway.send(new GetRestApisCommand({ position, limit: 500 }));
    const restApi = (result.items || []).find((api) => api.name === apiName);
    if (restApi) return restApi.id;
    if (result.position) return resolveFromAws(result.position);
    return null;
  };
  this.apiGatewayRestApiId = await resolveFromAws();
}

async function resolveStage(getApiGateway) {
  const apiGateway = await getApiGateway();
  const restApiId = this.apiGatewayRestApiId;

  try {
    this.apiGatewayStageState = await apiGateway.send(
      new GetStageCommand({
        restApiId,
        stageName: this.provider.getApiGatewayStage(),
      })
    );
  } catch (error) {
    if (!isApiGatewayNotFoundError(error)) throw error;
  }
}

async function resolveDeploymentId(getApiGateway) {
  if (!Object.keys(this.apiGatewayStageState).length) {
    const apiGateway = await getApiGateway();
    const restApiId = this.apiGatewayRestApiId;

    const res = await apiGateway.send(
      new GetDeploymentsCommand({
        restApiId,
        limit: 500,
      })
    );
    const deployments = res.items || [];
    if (deployments.length) {
      // there will ever only be 1 deployment associated
      const deployment = deployments[0];
      this.apiGatewayDeploymentId = deployment.id;
      return;
    }
    this.apiGatewayDeploymentId = null;
  }

  return undefined;
}

async function ensureStage(getApiGateway) {
  if (!Object.keys(this.apiGatewayStageState).length) {
    const apiGateway = await getApiGateway();
    const restApiId = this.apiGatewayRestApiId;
    const deploymentId = this.apiGatewayDeploymentId;

    return apiGateway.send(
      new CreateStageCommand({
        deploymentId,
        restApiId,
        stageName: this.provider.getApiGatewayStage(),
      })
    );
  }

  return undefined;
}

function handleTracing() {
  if (!this.hasTracingConfigured) return;
  const tracingEnabled = this.state.service.provider.tracing.apiGateway;

  let operation = { op: 'replace', path: '/tracingEnabled', value: 'false' };
  if (tracingEnabled) {
    operation = { op: 'replace', path: '/tracingEnabled', value: 'true' };
  }
  this.apiGatewayStagePatchOperations.push(operation);
}

function handleMetrics() {
  if (!this.hasMetricsConfigured) return;
  const metricsEnabled = this.state.service.provider.apiGateway.metrics;

  const operation = {
    op: 'replace',
    path: '/*/*/metrics/enabled',
    value: metricsEnabled ? 'true' : 'false',
  };
  this.apiGatewayStagePatchOperations.push(operation);
}

function handleLogs() {
  if (!this.hasLogsConfigured) return;
  const logs = this.state.service.provider.logs.restApi;
  const ops = this.apiGatewayStagePatchOperations;

  let operations = [
    { op: 'replace', path: '/*/*/logging/dataTrace', value: 'false' },
    { op: 'replace', path: '/*/*/logging/loglevel', value: 'OFF' },
  ];

  if (logs) {
    const service = this.state.service.service;
    const stage = this.provider.getApiGatewayStage();
    const region = this.options.region;
    const partition = this.partition;
    const logGroupName = `/aws/api-gateway/${service}-${stage}`;

    operations = [];

    let logFormat = defaultApiGatewayLogFormat;
    if (logs.format) {
      logFormat = logs.format;
    }

    const executionLogging = logs.executionLogging == null ? true : logs.executionLogging;

    let level = defaultApiGatewayLogLevel;
    if (!executionLogging) {
      level = 'OFF';
    } else if (logs.level) {
      level = logs.level;
    }

    const accessLogging = logs.accessLogging == null ? true : logs.accessLogging;

    if (accessLogging) {
      const resourceArn = `arn:${partition}:logs:${region}:${this.accountId}:log-group:${logGroupName}`;
      const destinationArn = {
        op: 'replace',
        path: '/accessLogSettings/destinationArn',
        value: resourceArn,
      };
      const format = {
        op: 'replace',
        path: '/accessLogSettings/format',
        value: logFormat,
      };

      operations.push(destinationArn, format);
    } else {
      // this is required to remove any existing log setting
      operations.push({
        op: 'remove',
        path: '/accessLogSettings',
      });
    }

    const fullExecutionData = logs.fullExecutionData == null ? true : logs.fullExecutionData;
    operations.push({
      op: 'replace',
      path: '/*/*/logging/dataTrace',
      value: String(Boolean(fullExecutionData)),
    });

    operations.push({ op: 'replace', path: '/*/*/logging/loglevel', value: level });
  }

  ops.push(...operations);
}

function handleTags() {
  if (!this.hasTagsConfigured) return;
  const provider = this.state.service.provider;
  const mergedTags = safeShallowAssign({}, provider.stackTags, provider.tags);
  const tagsMerged = Object.fromEntries(
    Object.entries(mergedTags).map(([key, value]) => [key, String(value)])
  );
  const currentTags = this.apiGatewayStageState.tags || {};
  const tagKeysToBeRemoved = Object.keys(currentTags).filter(
    (currentKey) => !currentKey.startsWith('aws:') && typeof tagsMerged[currentKey] !== 'string'
  );

  const restApiId = this.apiGatewayRestApiId;
  const stageName = this.provider.getApiGatewayStage();
  const region = this.options.region;
  const partition = this.partition;
  const resourceArn = `arn:${partition}:apigateway:${region}::/restapis/${restApiId}/stages/${stageName}`;

  if (tagKeysToBeRemoved.length > 0) {
    this.apiGatewayUntagResourceParams.push({
      resourceArn,
      tagKeys: tagKeysToBeRemoved,
    });
  }
  if (!isDeepStrictEqual(currentTags, tagsMerged) && Object.keys(tagsMerged).length > 0) {
    this.apiGatewayTagResourceParams.push({
      resourceArn,
      tags: tagsMerged,
    });
  }
}

async function addTags(getApiGateway) {
  const apiGateway = await getApiGateway();
  const requests = this.apiGatewayTagResourceParams.map((tagResourceParam) =>
    this.limitApiGatewayRequests(() => apiGateway.send(new TagResourceCommand(tagResourceParam)))
  );
  return Promise.all(requests);
}

async function removeTags(getApiGateway) {
  const apiGateway = await getApiGateway();
  const requests = this.apiGatewayUntagResourceParams.map((untagResourceParam) =>
    this.limitApiGatewayRequests(() =>
      apiGateway.send(new UntagResourceCommand(untagResourceParam))
    )
  );
  return Promise.all(requests);
}

async function applyUpdates(getApiGateway) {
  const restApiId = this.apiGatewayRestApiId;
  const patchOperations = this.apiGatewayStagePatchOperations;

  if (patchOperations.length) {
    const apiGateway = await getApiGateway();
    return apiGateway.send(
      new UpdateStageCommand({
        restApiId,
        stageName: this.provider.getApiGatewayStage(),
        patchOperations,
      })
    );
  }

  return undefined;
}

async function removeAccessLoggingLogGroup(getCloudWatchLogs) {
  const service = this.state.service.service;
  const provider = this.state.service.provider;
  const stage = this.provider.getApiGatewayStage();
  const logGroupName = `/aws/api-gateway/${service}-${stage}`;

  let accessLogging = provider.logs && provider.logs.restApi;

  if (accessLogging) {
    accessLogging = accessLogging.accessLogging == null ? true : accessLogging.accessLogging;
  }

  // if there are no logs setup (or the user has disabled them) we need to
  // ensure that the log group is removed. Otherwise we'll run into duplicate
  // log group name issues when logs are enabled again
  if (!accessLogging) {
    const cloudWatchLogs = await getCloudWatchLogs();
    try {
      return await cloudWatchLogs.send(new DeleteLogGroupCommand({ logGroupName }));
    } catch {
      // Preserve legacy best-effort cleanup behavior for disabled access logging.
    }
  }

  return undefined;
}
