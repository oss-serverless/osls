'use strict';

const path = require('path');
const crypto = require('crypto');
const fsp = require('fs').promises;
const memoizee = require('memoizee');
const { log } = require('../../../utils/serverless-utils/log');
const generateZip = require('./generate-zip');
const ensureArtifact = require('../../../utils/ensure-artifact');
const ServerlessError = require('../../../serverless-error');

const copyCustomResourcesZip = async (zipFilePath) => {
  const [cachedZipFilePath] = await Promise.all([
    generateZip(),
    fsp.mkdir(path.dirname(zipFilePath), { recursive: true }),
  ]);
  await fsp.copyFile(cachedZipFilePath, zipFilePath);
};

const prepareCustomResourcePackage = memoizee(
  async (zipFilePath) => {
    log.info('Generating custom CloudFormation resources');
    try {
      await copyCustomResourcesZip(zipFilePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      // The cached artifact lives in ~/.serverless/artifacts, which can be
      // cleaned up externally at any time. Treat a missing source as a cache
      // miss: drop the memoized ensure result, regenerate once and retry.
      ensureArtifact.clear();
      await copyCustomResourcesZip(zipFilePath);
    }
    return path.basename(zipFilePath);
  },
  { promise: true, primitive: true }
);

async function addCustomResourceToService(awsProvider, resourceName, iamRoleStatements) {
  let functionName;
  let absoluteFunctionName;
  let Handler;
  let customResourceFunctionLogicalId;

  const { serverless } = awsProvider;
  const providerConfig = serverless.service.provider;
  const shouldWriteLogs = providerConfig.logs && providerConfig.logs.frameworkLambda;
  const { Resources } = providerConfig.compiledCloudFormationTemplate;
  const customResourcesRoleLogicalId = awsProvider.naming.getCustomResourcesRoleLogicalId();
  const zipFilePath = path.join(
    serverless.serviceDir,
    '.serverless',
    awsProvider.naming.getCustomResourcesArtifactName()
  );
  const funcPrefix = `${serverless.service.service}-${awsProvider.getStage()}`;

  // check which custom resource should be used
  if (resourceName === 's3') {
    functionName = awsProvider.naming.getCustomResourceS3HandlerFunctionName();
    Handler = 's3/handler.handler';
    customResourceFunctionLogicalId =
      awsProvider.naming.getCustomResourceS3HandlerFunctionLogicalId();
  } else if (resourceName === 'cognitoUserPool') {
    functionName = awsProvider.naming.getCustomResourceCognitoUserPoolHandlerFunctionName();
    Handler = 'cognito-user-pool/handler.handler';
    customResourceFunctionLogicalId =
      awsProvider.naming.getCustomResourceCognitoUserPoolHandlerFunctionLogicalId();
  } else if (resourceName === 'eventBridge') {
    functionName = awsProvider.naming.getCustomResourceEventBridgeHandlerFunctionName();
    Handler = 'event-bridge/handler.handler';
    customResourceFunctionLogicalId =
      awsProvider.naming.getCustomResourceEventBridgeHandlerFunctionLogicalId();
  } else if (resourceName === 'apiGatewayCloudWatchRole') {
    functionName =
      awsProvider.naming.getCustomResourceApiGatewayAccountCloudWatchRoleHandlerFunctionName();
    Handler = 'api-gateway-cloud-watch-role/handler.handler';
    customResourceFunctionLogicalId =
      awsProvider.naming.getCustomResourceApiGatewayAccountCloudWatchRoleHandlerFunctionLogicalId();
  } else {
    throw new ServerlessError(
      `No implementation found for Custom Resource "${resourceName}"`,
      'MISSING_CUSTOM_RESOURCE_IMPLEMENTATION'
    );
  }
  absoluteFunctionName = `${funcPrefix}-${functionName}`;
  if (absoluteFunctionName.length > 64) {
    // Function names cannot be longer than 64.
    // Temporary solution until we have https://github.com/serverless/serverless/issues/6598
    // (which doesn't change names of already deployed functions)
    absoluteFunctionName = `${absoluteFunctionName.slice(0, 32)}${crypto
      .createHash('md5')
      .update(absoluteFunctionName)
      .digest('hex')}`;
  }

  const zipFileBasename = await prepareCustomResourcePackage(zipFilePath);
  let S3Bucket = {
    Ref: awsProvider.naming.getDeploymentBucketLogicalId(),
  };
  if (serverless.service.package.deploymentBucket) {
    S3Bucket = serverless.service.package.deploymentBucket;
  }
  const s3Folder = serverless.service.package.artifactDirectoryName;
  const s3FileName = zipFileBasename;
  const S3Key = `${s3Folder}/${s3FileName}`;

  const customDeploymentRole = awsProvider.getCustomDeploymentRole();

  if (!customDeploymentRole) {
    let customResourceRole = Resources[customResourcesRoleLogicalId];
    if (!customResourceRole) {
      customResourceRole = {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: {
                  Service: ['lambda.amazonaws.com'],
                },
                Action: ['sts:AssumeRole'],
              },
            ],
          },
          Policies: [
            {
              PolicyName: {
                'Fn::Join': [
                  '-',
                  [
                    awsProvider.getStage(),
                    awsProvider.serverless.service.service,
                    'custom-resources-lambda',
                  ],
                ],
              },
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [],
              },
            },
          ],
        },
      };
      Resources[customResourcesRoleLogicalId] = customResourceRole;

      if (shouldWriteLogs) {
        const logGroupsPrefix = awsProvider.naming.getLogGroupName(funcPrefix);
        customResourceRole.Properties.Policies[0].PolicyDocument.Statement.push(
          {
            Effect: 'Allow',
            Action: ['logs:CreateLogStream', 'logs:CreateLogGroup', 'logs:TagResource'],
            Resource: [
              {
                'Fn::Sub':
                  'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}' +
                  `:log-group:${logGroupsPrefix}*:*`,
              },
            ],
          },
          {
            Effect: 'Allow',
            Action: ['logs:PutLogEvents'],
            Resource: [
              {
                'Fn::Sub':
                  'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}' +
                  `:log-group:${logGroupsPrefix}*:*:*`,
              },
            ],
          }
        );
      }
    }
    const { Statement } = customResourceRole.Properties.Policies[0].PolicyDocument;
    iamRoleStatements.forEach((newStmt) => {
      if (!Statement.some((existingStmt) => existingStmt.Resource === newStmt.Resource)) {
        Statement.push(newStmt);
      }
    });
  }

  let runtimeVersion = 'nodejs24.x';
  const providerRuntime = awsProvider.getRuntime();
  if (providerRuntime.startsWith('nodejs')) {
    runtimeVersion = providerRuntime;
  }

  const customResourceFunction = {
    Type: 'AWS::Lambda::Function',
    Properties: {
      Code: {
        S3Bucket,
        S3Key,
      },
      FunctionName: absoluteFunctionName,
      Handler,
      MemorySize: 1024,
      Runtime: runtimeVersion,
      Timeout: 180,
    },
    DependsOn: [],
  };

  if (providerConfig.architecture) {
    customResourceFunction.Properties.Architectures = [providerConfig.architecture];
  }

  Resources[customResourceFunctionLogicalId] = customResourceFunction;

  if (customDeploymentRole) {
    customResourceFunction.Properties.Role = customDeploymentRole;
  } else {
    customResourceFunction.Properties.Role = {
      'Fn::GetAtt': [customResourcesRoleLogicalId, 'Arn'],
    };
    customResourceFunction.DependsOn.push(customResourcesRoleLogicalId);
  }

  if (shouldWriteLogs) {
    const customResourceLogGroupLogicalId = awsProvider.naming.getLogGroupLogicalId(functionName);
    customResourceFunction.DependsOn.push(customResourceLogGroupLogicalId);
    Object.assign(Resources, {
      [customResourceLogGroupLogicalId]: {
        Type: 'AWS::Logs::LogGroup',
        Properties: {
          LogGroupName: awsProvider.naming.getLogGroupName(absoluteFunctionName),
          RetentionInDays: awsProvider.getLogRetentionInDays(),
          DataProtectionPolicy: awsProvider.getLogDataProtectionPolicy(),
        },
      },
    });
  }
}

module.exports = {
  addCustomResourceToService,
  clearArtifactCopyCache: prepareCustomResourcePackage.clear,
};
