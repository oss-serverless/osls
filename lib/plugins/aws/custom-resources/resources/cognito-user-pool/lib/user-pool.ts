'use strict';

const { MAX_AWS_REQUEST_TRY } = require('../../utils');
const {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({ maxAttempts: MAX_AWS_REQUEST_TRY });

const customSenderSources = ['CustomSMSSender', 'CustomEmailSender'];

const KMSKeyID = 'KMSKeyID';

function getUpdateConfigFromCurrentSetup(currentSetup) {
  const updatedConfig = Object.assign({}, currentSetup);
  delete updatedConfig.Id;
  delete updatedConfig.Name;
  delete updatedConfig.Status;
  delete updatedConfig.LastModifiedDate;
  delete updatedConfig.CreationDate;
  delete updatedConfig.SchemaAttributes;
  delete updatedConfig.AliasAttributes;
  delete updatedConfig.UsernameAttributes;
  delete updatedConfig.EstimatedNumberOfUsers;
  delete updatedConfig.SmsConfigurationFailure;
  delete updatedConfig.EmailConfigurationFailure;
  delete updatedConfig.Domain;
  delete updatedConfig.CustomDomain;
  delete updatedConfig.UsernameConfiguration;
  delete updatedConfig.Arn;
  // necessary reassignments
  updatedConfig.Policies.PasswordPolicy.TemporaryPasswordValidityDays =
    updatedConfig.AdminCreateUserConfig.UnusedAccountValidityDays;
  delete updatedConfig.AdminCreateUserConfig.UnusedAccountValidityDays;
  return updatedConfig;
}

async function findUserPoolByName(config) {
  const { userPoolName, region } = config;

  const payload = {
    MaxResults: 60,
  };

  cognito.config.region = () => region;

  async function recursiveFind(nextToken) {
    if (nextToken) payload.NextToken = nextToken;
    return cognito.send(new ListUserPoolsCommand(payload)).then((result) => {
      const matches = result.UserPools.filter((pool) => pool.Name === userPoolName);
      if (matches.length) {
        return matches.shift();
      }
      if (result.NextToken) return recursiveFind(result.NextToken);
      return null;
    });
  }

  return recursiveFind();
}

async function getConfiguration(config) {
  const { region } = config;

  cognito.config.region = () => region;

  return findUserPoolByName(config).then((userPool) => {
    if (!userPool) return null;
    return cognito.send(new DescribeUserPoolCommand({ UserPoolId: userPool.Id }));
  });
}

async function updateConfiguration(config) {
  const { lambdaArn, previousLambdaArn, userPoolConfigs, region } = config;

  cognito.config.region = () => region;

  return getConfiguration(config).then((res) => {
    if (!res) {
      throw new Error(`Could not find Cognito User Pool "${config.userPoolName}"`);
    }
    const UserPoolId = res.UserPool.Id;
    let { LambdaConfig } = res.UserPool;

    // remove configurations for this specific function
    LambdaConfig = removeExistingLambdas(
      LambdaConfig,
      [lambdaArn, previousLambdaArn].filter(Boolean)
    );

    userPoolConfigs.forEach((poolConfig) => {
      if (customSenderSources.includes(poolConfig.Trigger)) {
        LambdaConfig[poolConfig.Trigger] = {
          LambdaArn: lambdaArn,
          LambdaVersion: poolConfig.LambdaVersion,
        };
        LambdaConfig.KMSKeyID = poolConfig.KMSKeyID;
      } else if (poolConfig.Trigger === 'PreTokenGeneration' && poolConfig.LambdaVersion) {
        LambdaConfig.PreTokenGenerationConfig = {
          LambdaArn: lambdaArn,
          LambdaVersion: poolConfig.LambdaVersion,
        };
      } else {
        LambdaConfig[poolConfig.Trigger] = lambdaArn;
      }
    });

    const updatedConfig = getUpdateConfigFromCurrentSetup(res.UserPool);
    Object.assign(updatedConfig, {
      UserPoolId,
      LambdaConfig,
    });

    return cognito.send(new UpdateUserPoolCommand(updatedConfig));
  });
}

async function removeConfiguration(config) {
  const { lambdaArn, region } = config;

  cognito.config.region = () => region;

  return getConfiguration(config).then((res) => {
    if (!res) return null;
    const UserPoolId = res.UserPool.Id;
    let { LambdaConfig } = res.UserPool;

    // remove configurations for this specific function
    LambdaConfig = removeExistingLambdas(LambdaConfig, lambdaArn);

    const updatedConfig = getUpdateConfigFromCurrentSetup(res.UserPool);
    Object.assign(updatedConfig, {
      UserPoolId,
      LambdaConfig,
    });

    return cognito.send(new UpdateUserPoolCommand(updatedConfig));
  });
}

function removeExistingLambdas(lambdaConfig, lambdaArns) {
  const targets = new Set(Array.isArray(lambdaArns) ? lambdaArns : [lambdaArns]);
  const res = Object.fromEntries(
    Object.entries(lambdaConfig).filter(([key, value]) => {
      if (key === 'PreTokenGenerationConfig' && value && targets.has(value.LambdaArn)) {
        return false;
      }
      return (
        !(customSenderSources.includes(key) && value && targets.has(value.LambdaArn)) &&
        !targets.has(value)
      );
    })
  );
  // if there are no customSenderSources also delete KMSKeyId
  if (KMSKeyID in res && customSenderSources.every((source) => !(source in res))) {
    delete res[KMSKeyID];
  }
  return res;
}

module.exports = {
  findUserPoolByName,
  updateConfiguration,
  removeConfiguration,
};
