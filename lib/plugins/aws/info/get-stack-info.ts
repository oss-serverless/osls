'use strict';

const ServerlessError = require('../../../serverless-error');
const {
  CloudFormationClient,
  DescribeStacksCommand,
  ListExportsCommand,
} = require('@aws-sdk/client-cloudformation');
const { ApiGatewayV2Client, GetApiCommand } = require('@aws-sdk/client-apigatewayv2');
const { retryOnThrottlingError } = require('../../../aws/retry');

function getCloudFormationClient(context) {
  context.cloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.cloudFormationClientPromise;
}

function getApiGatewayV2Client(context) {
  context.apiGatewayV2ClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new ApiGatewayV2Client(config));
  return context.apiGatewayV2ClientPromise;
}

async function resolveCfImportValue(context, name) {
  const cloudFormation = await getCloudFormationClient(context);
  let nextToken;

  do {
    const input = nextToken ? { NextToken: nextToken } : {};
    const result = await retryOnThrottlingError(
      () => cloudFormation.send(new ListExportsCommand(input)),
      { name: 'CloudFormation exports listing' }
    );
    const targetExportMeta = (result.Exports || []).find((exportMeta) => exportMeta.Name === name);
    if (targetExportMeta) return targetExportMeta.Value;
    nextToken = result.NextToken;
  } while (nextToken);

  throw new ServerlessError(
    `Could not resolve Fn::ImportValue with name ${name}. Are you sure this value is exported?`,
    'CF_IMPORT_RESOLUTION'
  );
}

module.exports = {
  async getStackInfo() {
    // NOTE: this is the global gatheredData object which will be passed around
    this.gatheredData = {
      info: {
        functions: [],
        layers: [],
        endpoints: [],
        service: this.serverless.service.service,
        stage: this.provider.getStage(),
        region: this.provider.getRegion(),
        stack: this.provider.naming.getStackName(),
      },
      outputs: [],
    };

    const stackName = this.provider.naming.getStackName();

    const stackData = {};
    const cloudFormation = await getCloudFormationClient(this);
    const sdkRequests = [
      retryOnThrottlingError(
        () => cloudFormation.send(new DescribeStacksCommand({ StackName: stackName })),
        { name: 'CloudFormation stack description' }
      ).then((result) => {
        if (result) stackData.outputs = result.Stacks[0].Outputs;
      }),
    ];
    const httpApiId =
      this.serverless.service.provider.httpApi && this.serverless.service.provider.httpApi.id;
    if (httpApiId) {
      sdkRequests.push(
        (httpApiId['Fn::ImportValue']
          ? resolveCfImportValue(this, httpApiId['Fn::ImportValue'])
          : Promise.resolve(httpApiId)
        )
          .then(async (id) => {
            const apiGatewayV2 = await getApiGatewayV2Client(this);
            return retryOnThrottlingError(
              () => apiGatewayV2.send(new GetApiCommand({ ApiId: id })),
              { name: 'API Gateway HTTP API description' }
            );
          })
          .then(
            (result) => {
              stackData.externalHttpApiEndpoint = result.ApiEndpoint;
            },
            (error) => {
              throw new ServerlessError(
                `Could not resolve provider.httpApi.id parameter. ${error.message}`,
                'UNABLE_TO_RESOLVE_HTTP_API_ID'
              );
            }
          )
      );
    }

    // Get info from CloudFormation Outputs
    return Promise.all(sdkRequests).then(async () => {
      let outputs;

      if (stackData.outputs) {
        ({ outputs } = stackData);

        const serviceEndpointOutputRegex = this.provider.naming.getServiceEndpointRegex();

        // Outputs
        this.gatheredData.outputs = outputs;

        // Functions
        this.serverless.service.getAllFunctions().forEach((func) => {
          const functionObj = this.serverless.service.getFunction(func);
          const functionInfo = {};
          functionInfo.name = func;
          functionInfo.deployedName = functionObj.name;
          functionInfo.artifactSize = functionObj.artifactSize;
          const functionUrlOutput = outputs.find(
            (output) =>
              output.OutputKey === this.provider.naming.getLambdaFunctionUrlOutputLogicalId(func)
          );
          if (functionUrlOutput) {
            functionInfo.url = functionUrlOutput.OutputValue;
          }
          this.gatheredData.info.functions.push(functionInfo);
        });

        // Layers
        this.serverless.service.getAllLayers().forEach((layer) => {
          const layerInfo = {};
          layerInfo.name = layer;
          const layerOutputId = this.provider.naming.getLambdaLayerOutputLogicalId(layer);
          for (const output of outputs) {
            if (output.OutputKey === layerOutputId) {
              layerInfo.arn = output.OutputValue;
              break;
            }
          }
          this.gatheredData.info.layers.push(layerInfo);
        });

        // CloudFront
        const cloudFrontDomainName = outputs.find(
          (output) =>
            output.OutputKey === this.provider.naming.getCloudFrontDistributionDomainNameLogicalId()
        );
        if (cloudFrontDomainName) {
          this.gatheredData.info.cloudFront = cloudFrontDomainName.OutputValue;
        }

        // Endpoints
        outputs
          .filter((x) => x.OutputKey.match(serviceEndpointOutputRegex))
          .forEach((x) => {
            if (x.OutputKey === 'HttpApiUrl') {
              this.gatheredData.info.endpoints.push(`httpApi: ${x.OutputValue}`);
            } else {
              this.gatheredData.info.endpoints.push(x.OutputValue);
            }
            if (
              this.serverless.service.deployment &&
              this.serverless.service.deployment.deploymentId
            ) {
              this.serverless.service.deployment.apiId = x.OutputValue.split('//')[1].split('.')[0];
            }
          });
      }
      if (stackData.externalHttpApiEndpoint) {
        this.gatheredData.info.endpoints.push(`httpApi: ${stackData.externalHttpApiEndpoint}`);
      }

      return undefined;
    });
  },
};
