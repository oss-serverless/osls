'use strict';

const promiseLimit = require('ext/promise/limit').bind(Promise);
const {
  APIGatewayClient,
  GetUsagePlansCommand,
  UpdateUsagePlanCommand,
} = require('@aws-sdk/client-api-gateway');
const {
  CloudFormationClient,
  DescribeStackResourceCommand,
} = require('@aws-sdk/client-cloudformation');
const { log } = require('../../../../../../../../utils/serverless-utils/log');

function getApiGatewayRequestLimiter(context) {
  if (!context.limitApiGatewayRequests) {
    context.limitApiGatewayRequests = promiseLimit(2, async (task) => task());
  }
  return context.limitApiGatewayRequests;
}

function getCloudFormationClient(context) {
  context.disassociateUsagePlanCloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.disassociateUsagePlanCloudFormationClientPromise;
}

function getApiGatewayClient(context) {
  context.disassociateUsagePlanApiGatewayClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new APIGatewayClient(config));
  return context.disassociateUsagePlanApiGatewayClientPromise;
}

async function getAllUsagePlans(apiGateway) {
  const items = [];
  let position;

  do {
    const input = position ? { position, limit: 500 } : { limit: 500 };
    const response = await apiGateway.send(new GetUsagePlansCommand(input));
    items.push(...(response.items || []));
    position = response.position;
  } while (position);

  return items;
}

module.exports = {
  async disassociateUsagePlan() {
    const apiKeys =
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.apiKeys;

    if (apiKeys && apiKeys.length) {
      log.info('Removing usage plan association');
      const cloudFormation = await getCloudFormationClient(this);
      const apiGateway = await getApiGatewayClient(this);
      const limitApiGatewayRequests = getApiGatewayRequestLimiter(this);
      const stackName = `${this.provider.naming.getStackName()}`;
      const [stackResource, usagePlans] = await Promise.all([
        cloudFormation.send(
          new DescribeStackResourceCommand({
            StackName: stackName,
            LogicalResourceId: this.provider.naming.getRestApiLogicalId(),
          })
        ),
        getAllUsagePlans(apiGateway),
      ]);
      const restApiId = stackResource.StackResourceDetail.PhysicalResourceId;

      return Promise.all(
        usagePlans.flatMap((item) =>
          (item.apiStages || [])
            .filter((apiStage) => apiStage.apiId === restApiId)
            .map((apiStage) =>
              limitApiGatewayRequests(() =>
                apiGateway.send(
                  new UpdateUsagePlanCommand({
                    usagePlanId: item.id,
                    patchOperations: [
                      {
                        op: 'remove',
                        path: '/apiStages',
                        value: `${apiStage.apiId}:${apiStage.stage}`,
                      },
                    ],
                  })
                )
              )
            )
        )
      );
    }
  },
};
