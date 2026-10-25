'use strict';

function createUsagePlanResource(that, name) {
  const template = {
    Type: 'AWS::ApiGateway::UsagePlan',
    DependsOn: that.apiGatewayDeploymentLogicalId,
    Properties: {
      ApiStages: [
        {
          ApiId: that.provider.getApiGatewayRestApiId(),
          Stage: that.provider.getStage(),
        },
      ],
      Description: `Usage plan "${name}" for ${
        that.serverless.service.service
      } ${that.provider.getStage()} stage`,
      UsagePlanName: `${that.serverless.service.service}-${name}-${that.provider.getStage()}`,
    },
  };
  const usagePlan =
    that.serverless.service.provider.apiGateway &&
    that.serverless.service.provider.apiGateway.usagePlan;
  // this is done for backward compatibility
  if (name === 'default') {
    // create old legacy resources
    template.Properties.UsagePlanName = `${
      that.serverless.service.service
    }-${that.provider.getStage()}`;
    template.Properties.Description = `Usage plan for ${
      that.serverless.service.service
    } ${that.provider.getStage()} stage`;
    // assign quota
    if (usagePlan && usagePlan.quota) {
      template.Properties.Quota = {
        Limit: usagePlan.quota.limit,
        Offset: usagePlan.quota.offset,
        Period: usagePlan.quota.period,
      };
    }
    // assign throttle
    if (usagePlan && usagePlan.throttle) {
      template.Properties.Throttle = {
        BurstLimit: usagePlan.throttle.burstLimit,
        RateLimit: usagePlan.throttle.rateLimit,
      };
    }
  } else {
    // assign quota
    const quotaProperties = usagePlan.reduce((accum, planObject) => {
      if (planObject[name] && planObject[name].quota) {
        return planObject[name].quota;
      }
      return accum;
    }, {});
    if (Object.keys(quotaProperties).length) {
      template.Properties.Quota = {
        Limit: quotaProperties.limit,
        Offset: quotaProperties.offset,
        Period: quotaProperties.period,
      };
    }
    // assign throttle
    const throttleProperties = usagePlan.reduce((accum, planObject) => {
      if (planObject[name] && planObject[name].throttle) {
        return planObject[name].throttle;
      }
      return accum;
    }, {});
    if (Object.keys(throttleProperties).length) {
      template.Properties.Throttle = {
        BurstLimit: throttleProperties.burstLimit,
        RateLimit: throttleProperties.rateLimit,
      };
    }
  }
  return template;
}

module.exports = {
  compileUsagePlan() {
    const apiKeys =
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.apiKeys;
    const usagePlan =
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.usagePlan;
    if (usagePlan || apiKeys) {
      const resources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources;
      this.apiGatewayUsagePlanNames = [];

      if (Array.isArray(usagePlan)) {
        usagePlan.forEach((planObject) => {
          const usagePlanName = Object.keys(planObject)[0];
          const logicalId = this.provider.naming.getUsagePlanLogicalId(usagePlanName);
          resources[logicalId] = createUsagePlanResource(this, usagePlanName);
          this.apiGatewayUsagePlanNames.push(usagePlanName);
        });
      } else {
        const usagePlanName = 'default';
        const logicalId = this.provider.naming.getUsagePlanLogicalId();
        resources[logicalId] = createUsagePlanResource(this, usagePlanName);
        this.apiGatewayUsagePlanNames.push(usagePlanName);
      }
    }
  },
};
