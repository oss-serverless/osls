'use strict';

const path = require('path');
const isObject = require('type/object/is');
const ServerlessError = require('../../../../serverless-error');
const { safeShallowAssign } = require('../../../../utils/safe-object');
const getHashForFilePath = require('../../../../utils/get-hash-for-file-path');
const getWebAppArtifactPath = require('../../utils/get-web-app-artifact-path');
const parseS3URI = require('../../utils/parse-s3-uri');
const resolveExecutionRole = require('../../utils/resolve-execution-role');

const docsUrl = 'https://github.com/oss-serverless/osls/blob/4.x/docs/guides/web-apps.md';

const isValidName = RegExp.prototype.test.bind(/^[A-Za-z0-9]([A-Za-z0-9_-]*[A-Za-z0-9])?$/);
const maxNameLength = 64;
const minTimeout = 3;
const isTypeScriptEntry = RegExp.prototype.test.bind(/\.(ts|mts|cts|tsx)$/);

const unsupportedSettings = new Map([
  [
    'build',
    {
      // osls never bundles, which is what "build: false" asks for
      isSupported: (value) => value === false,
      reason:
        'osls has no bundler. Build the web app first and point "entry" at the JavaScript output.',
      code: 'WEB_APP_BUILD_UNSUPPORTED',
    },
  ],
  [
    'dev',
    {
      reason: 'osls has no dev mode, so the setting can be removed.',
      code: 'WEB_APP_DEV_UNSUPPORTED',
    },
  ],
  [
    'iam',
    {
      reason:
        'osls does not create a role per web app. Add the statements to "provider.iam.role.statements", or point "role" at a role of your own.',
      code: 'WEB_APP_IAM_UNSUPPORTED',
    },
  ],
  [
    'vpc',
    {
      reason: `osls does not create the network connector that gives a web app access to a VPC. See ${docsUrl}#vpc`,
      code: 'WEB_APP_VPC_UNSUPPORTED',
    },
  ],
]);

const frameworkEnvironmentVariableNames = new Set([
  'PORT',
  'HOSTNAME',
  'AWS_LAMBDA_NODEJS_ENTRYPOINT',
]);
const lambdaReservedEnvironmentVariableNames = new Set([
  'AWS_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SECRET_KEY',
  'AWS_SECURITY_TOKEN',
  'AWS_SESSION_TOKEN',
  'AWS_DEFAULT_REGION',
  'AWS_REGION',
  'AWS_LAMBDA_HTTP_ENDPOINT',
  'AWS_LAMBDA_RUNTIME_API',
  'AWS_LAMBDA_INITIALIZATION_TYPE',
  'AWS_LAMBDA_FUNCTION_MEMORY_SIZE',
  'AWS_LAMBDA_METADATA_API',
  'AWS_LAMBDA_METADATA_TOKEN',
]);
const isValidEnvironmentVariableName = RegExp.prototype.test.bind(/^[a-zA-Z][a-zA-Z0-9_]*$/);
const maxEnvironmentVariableValueLength = 4096;
const maxEnvironmentSize = 32 * 1024;

class AwsCompileWebApps {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.packagePath = path.join(this.serverless.serviceDir || '.', '.serverless');
    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'package:initialize': () => this.validate(),
      'package:compileFunctions': async () => this.compileWebApps(),
    };
  }

  validate() {
    const webAppNames = this.serverless.service.getAllWebApps();
    if (!webAppNames.length) return;

    const { provider } = this.serverless.service;
    if (provider.deploymentMode === 'express' && provider.disableRollback) {
      throw new ServerlessError(
        'Web apps cannot be deployed with "provider.deploymentMode: express" and "provider.disableRollback: true" together: every change to a web app replaces its revision, and CloudFormation rejects replacements in express mode while rollback is disabled. Remove "disableRollback", or use the default deployment mode.',
        'WEB_APP_EXPRESS_MODE_WITHOUT_ROLLBACK'
      );
    }
    if (!provider.deploymentBucket) {
      const deploymentBucketObject = provider.deploymentBucketObject || {};
      if (!deploymentBucketObject.versioning) {
        throw new ServerlessError(
          [
            'AWS Lambda reads the code of a web app straight from the deployment bucket, which therefore has to be versioned. Add this to the service configuration:',
            '',
            'provider:',
            '  deploymentBucket:',
            '    versioning: true',
          ].join('\n'),
          'WEB_APP_DEPLOYMENT_BUCKET_VERSIONING_REQUIRED'
        );
      }
      if (deploymentBucketObject.skipPolicySetup) {
        throw new ServerlessError(
          'Web apps cannot be combined with "provider.deploymentBucket.skipPolicySetup", because AWS Lambda reads their code through a statement that osls adds to the policy of the deployment bucket. ' +
            `Remove "skipPolicySetup", or name a bucket of your own in "provider.deploymentBucket.name". See ${docsUrl}#deployment-bucket`,
          'WEB_APP_DEPLOYMENT_BUCKET_POLICY_REQUIRED'
        );
      }
    }

    const { naming } = this.provider;
    const functionKeysByLogGroupLogicalId = new Map(
      this.serverless.service
        .getAllFunctions()
        .filter((functionKey) => !this.serverless.service.getFunction(functionKey).disableLogs)
        .map((functionKey) => [naming.getLogGroupLogicalId(functionKey), functionKey])
    );
    const webAppNamesByName = new Map();
    for (const webAppName of webAppNames) {
      this.validateWebApp(webAppName);

      const { name } = this.serverless.service.getWebApp(webAppName);
      if (webAppNamesByName.has(name)) {
        throw new ServerlessError(
          `Web apps "${webAppNamesByName.get(name)}" and "${webAppName}" both resolve to the name "${name}". Set a different "name" on one of them.`,
          'WEB_APP_NAME_CONFLICT'
        );
      }
      webAppNamesByName.set(name, webAppName);

      for (const logGroupLogicalId of [
        naming.getWebFunctionLogGroupLogicalId(webAppName),
        naming.getWebFunctionLocalLogGroupLogicalId(webAppName),
      ]) {
        if (!functionKeysByLogGroupLogicalId.has(logGroupLogicalId)) continue;
        throw new ServerlessError(
          `Web app "${webAppName}" and function "${functionKeysByLogGroupLogicalId.get(logGroupLogicalId)}" both need a CloudFormation resource with the logical ID "${logGroupLogicalId}" for a log group. Rename one of the two keys.`,
          'WEB_APP_FUNCTION_LOGICAL_ID_CONFLICT'
        );
      }
    }
  }

  validateWebApp(webAppName) {
    const webAppObject = this.serverless.service.getWebApp(webAppName);

    for (const [setting, { isSupported, reason, code }] of unsupportedSettings) {
      const value = webAppObject[setting];
      if (value == null || (isSupported && isSupported(value))) continue;
      throw new ServerlessError(
        `Web app "${webAppName}" sets "${setting}", which osls does not support: ${reason}`,
        code
      );
    }

    const { entry } = webAppObject;
    if (typeof entry !== 'string' || !entry) {
      throw new ServerlessError(
        `Web app "${webAppName}" needs an "entry": the file that starts its HTTP server.`,
        'WEB_APP_ENTRY_MISSING'
      );
    }
    if (
      path.posix.isAbsolute(entry) ||
      path.win32.isAbsolute(entry) ||
      entry.split(/[\\/]/).includes('..')
    ) {
      throw new ServerlessError(
        `The "entry" of web app "${webAppName}" has to be a path relative to the service directory, without ".." segments. Received "${entry}".`,
        'WEB_APP_INVALID_ENTRY'
      );
    }
    if (isTypeScriptEntry(entry)) {
      throw new ServerlessError(
        `Web app "${webAppName}" has the TypeScript "entry" "${entry}", which osls does not support: osls does not compile TypeScript. Compile it first and point "entry" at the JavaScript output.`,
        'WEB_APP_TYPESCRIPT_ENTRY_UNSUPPORTED'
      );
    }

    if (webAppObject.package && parseS3URI(webAppObject.package.artifact)) {
      throw new ServerlessError(
        `Web app "${webAppName}" sets "package.artifact" to an S3 location, which osls does not support. Point it at a local zip file.`,
        'WEB_APP_S3_ARTIFACT_UNSUPPORTED'
      );
    }

    const { name } = webAppObject;
    if (typeof name !== 'string' || !isValidName(name) || name.length > maxNameLength) {
      throw new ServerlessError(
        `Web app "${webAppName}" resolves to the name "${name}", which AWS Lambda does not accept: a name is at most ${maxNameLength} characters long, contains only letters, digits, hyphens and underscores, and starts and ends with a letter or digit. Set a valid "name" on the web app.`,
        'WEB_APP_INVALID_NAME'
      );
    }

    this.validateUrl(webAppName);
    const providerTimeout = this.serverless.service.provider.timeout;
    if (!webAppObject.timeout && providerTimeout && providerTimeout < minTimeout) {
      throw new ServerlessError(
        `Web app "${webAppName}" inherits "provider.timeout: ${providerTimeout}", but the timeout of a web app is at least ${minTimeout} seconds. Set "timeout" on the web app.`,
        'WEB_APP_INVALID_TIMEOUT'
      );
    }

    this.validateEnvironment(webAppName);
  }

  validateUrl(webAppName) {
    const { url } = this.serverless.service.getWebApp(webAppName);

    if (url === false) {
      throw new ServerlessError(
        `Web app "${webAppName}" sets "url: false", which is not accepted because every web app has an HTTPS endpoint. Remove "url", or set "url.authorizer: aws_iam" to require signed requests.`,
        'WEB_APP_URL_REQUIRED'
      );
    }
    if (!isObject(url)) return;

    if (url.name != null && (!isValidName(url.name) || String(url.name).length > maxNameLength)) {
      throw new ServerlessError(
        `Web app "${webAppName}" sets "url.name" to "${url.name}", which AWS Lambda does not accept: the name of an endpoint is at most ${maxNameLength} characters long, contains only letters, digits, hyphens and underscores, and starts and ends with a letter or digit.`,
        'WEB_APP_INVALID_URL_NAME'
      );
    }

    const regions = url.regions || [];
    if (!url.type || url.type === 'HomeRegion') {
      if (!regions.length) return;
      throw new ServerlessError(
        `Web app "${webAppName}" sets "url.regions", which needs "url.type" to be "MultiRegion" or "PerRegion".`,
        'WEB_APP_URL_REGIONS_NOT_ALLOWED'
      );
    }
    const homeRegion = this.provider.getRegion();
    if (!regions.some((region) => region !== homeRegion)) {
      throw new ServerlessError(
        `Web app "${webAppName}" sets "url.type: ${url.type}", which needs "url.regions" to list at least one Region other than "${homeRegion}", the Region of the service.`,
        'WEB_APP_URL_REGIONS_REQUIRED'
      );
    }
  }

  validateEnvironment(webAppName) {
    const webAppObject = this.serverless.service.getWebApp(webAppName);

    for (const variableName of Object.keys(webAppObject.environment || {})) {
      if (frameworkEnvironmentVariableNames.has(variableName)) {
        throw new ServerlessError(
          `Web app "${webAppName}" sets the environment variable "${variableName}", which is reserved for osls on web apps. Remove it from "environment".`,
          'WEB_APP_RESERVED_ENVIRONMENT_VARIABLE'
        );
      }
    }

    let environmentSize = 0;
    for (const [variableName, value] of Object.entries(this.resolveEnvironment(webAppName))) {
      if (lambdaReservedEnvironmentVariableNames.has(variableName)) {
        throw new ServerlessError(
          `Web app "${webAppName}" sets the environment variable "${variableName}", which AWS Lambda reserves for web functions. Remove it from "environment" and "provider.environment".`,
          'WEB_APP_RESERVED_ENVIRONMENT_VARIABLE'
        );
      }
      if (!isValidEnvironmentVariableName(variableName)) {
        throw new ServerlessError(
          `Web app "${webAppName}" sets the environment variable "${variableName}", but for web functions AWS Lambda only accepts names that start with a letter and contain letters, digits and underscores.`,
          'WEB_APP_INVALID_ENVIRONMENT_VARIABLE'
        );
      }
      if (typeof value !== 'string') continue;
      if (!value.length || value.length > maxEnvironmentVariableValueLength) {
        throw new ServerlessError(
          `Web app "${webAppName}" sets the environment variable "${variableName}" to ${
            value.length ? `a value of ${value.length} characters` : 'an empty value'
          }, but for web functions AWS Lambda only accepts values of 1 to ${maxEnvironmentVariableValueLength} characters.`,
          'WEB_APP_INVALID_ENVIRONMENT_VARIABLE'
        );
      }
      environmentSize += Buffer.byteLength(variableName) + Buffer.byteLength(value);
    }
    if (environmentSize > maxEnvironmentSize) {
      throw new ServerlessError(
        `The environment variables of web app "${webAppName}" take ${environmentSize} bytes, above the 32 KB that AWS Lambda accepts for a web function.`,
        'WEB_APP_ENVIRONMENT_TOO_LARGE'
      );
    }
  }

  resolveEnvironment(webAppName) {
    const webAppObject = this.serverless.service.getWebApp(webAppName);
    const environment = safeShallowAssign(
      {},
      this.serverless.service.provider.environment,
      webAppObject.environment
    );

    if (webAppObject.package && webAppObject.package.artifact) {
      environment.AWS_LAMBDA_NODEJS_ENTRYPOINT = path.posix.normalize(webAppObject.entry);
    } else {
      // The start file sets both from the address AWS Lambda assigns
      delete environment.PORT;
      delete environment.HOSTNAME;
      environment.AWS_LAMBDA_NODEJS_ENTRYPOINT = this.provider.naming.getWebAppStartFileName();
    }
    return environment;
  }

  resolveLoggingConfig(webAppName) {
    const webAppLogs = this.serverless.service.getWebApp(webAppName).logs || {};
    const providerLogs =
      (this.serverless.service.provider.logs && this.serverless.service.provider.logs.lambda) || {};
    const loggingConfig = {};

    const applicationLogLevel = webAppLogs.applicationLogLevel || providerLogs.applicationLogLevel;
    if (applicationLogLevel) loggingConfig.ApplicationLogLevel = applicationLogLevel.toUpperCase();

    const systemLogLevel = webAppLogs.systemLogLevel || providerLogs.systemLogLevel;
    if (systemLogLevel) loggingConfig.SystemLogLevel = systemLogLevel.toUpperCase();

    return loggingConfig;
  }

  async compileWebApp(webAppName) {
    const cfTemplate = this.serverless.service.provider.compiledCloudFormationTemplate;
    const webAppObject = this.serverless.service.getWebApp(webAppName);
    const { naming } = this.provider;

    const webFunctionLogicalId = naming.getWebFunctionLogicalId(webAppName);
    const revisionLogicalId = naming.getWebFunctionRevisionLogicalId(webAppName);
    const endpointLogicalId = naming.getWebFunctionEndpointLogicalId(webAppName);

    const webFunctionResource = {
      Type: 'AWS::Lambda::WebFunction',
      Properties: {
        FunctionName: webAppObject.name,
      },
    };

    const tags = Object.entries(
      safeShallowAssign({}, this.serverless.service.provider.tags, webAppObject.tags)
    );
    if (tags.length) {
      webFunctionResource.Properties.Tags = tags.map(([Key, Value]) => ({ Key, Value }));
    }

    const artifactFilePath = getWebAppArtifactPath(
      this.packagePath,
      webAppName,
      this.serverless.service,
      naming
    );
    const artifactHash = Buffer.from(await getHashForFilePath(artifactFilePath), 'base64').toString(
      'hex'
    );
    // Lambda reads the zip for as long as the revision lives, so it is stored under a name
    // derived from its content, outside of the deployment directories that get cleaned up
    webAppObject.artifactS3Key = `${naming.getWebAppArtifactS3KeyDirname()}/${webAppName}-${artifactHash}.zip`;

    const { roleArn, dependsOn: roleDependsOn } = resolveExecutionRole(
      this.provider.getCustomExecutionRole(webAppObject) || 'IamRoleLambdaExecution'
    );

    const revisionResource = {
      Type: 'AWS::Lambda::WebFunctionRevision',
      DependsOn: [
        naming.getWebFunctionLogGroupLogicalId(webAppName),
        naming.getWebFunctionLocalLogGroupLogicalId(webAppName),
      ],
      Properties: {
        FunctionName: { Ref: webFunctionLogicalId },
        BuildConfig: {
          CodeConfig: {
            S3Object: {
              Bucket: this.serverless.service.package.deploymentBucket
                ? this.serverless.service.package.deploymentBucket
                : { Ref: 'ServerlessDeploymentBucket' },
              Key: webAppObject.artifactS3Key,
            },
          },
          RuntimeConfig: {
            Runtime: this.provider.getWebAppRuntime(webAppObject.runtime),
          },
        },
        ServiceConfig: {
          ExecutionRoleArn: roleArn,
        },
      },
    };

    if (cfTemplate.Resources[naming.getDeploymentBucketPolicyLogicalId()]) {
      revisionResource.DependsOn.push(naming.getDeploymentBucketPolicyLogicalId());
    }
    if (roleDependsOn) revisionResource.DependsOn.push(roleDependsOn);

    if (webAppObject.description) {
      revisionResource.Properties.Description = webAppObject.description;
    }

    const kmsKeyArn = webAppObject.kmsKeyArn || this.serverless.service.provider.kmsKeyArn;
    if (kmsKeyArn) revisionResource.Properties.KmsKeyArn = kmsKeyArn;

    const serviceConfig = revisionResource.Properties.ServiceConfig;

    const timeout = webAppObject.timeout || this.serverless.service.provider.timeout;
    if (timeout) serviceConfig.TimeoutSeconds = timeout;

    if (webAppObject.maxConcurrency) {
      serviceConfig.MaxConcurrencyPerEnvironment = webAppObject.maxConcurrency;
    }

    serviceConfig.EnvironmentVariables = this.resolveEnvironment(webAppName);

    const loggingConfig = this.resolveLoggingConfig(webAppName);
    if (Object.keys(loggingConfig).length) {
      serviceConfig.TelemetryConfig = { LoggingConfig: loggingConfig };
    }

    const url = isObject(webAppObject.url) ? webAppObject.url : {};
    const endpointResource = {
      Type: 'AWS::Lambda::WebFunctionEndpoint',
      Properties: {
        FunctionName: { Ref: webFunctionLogicalId },
        EndpointName: url.name || naming.getWebFunctionEndpointName(),
        EndpointType: url.type || 'HomeRegion',
        AuthType: url.authorizer === 'aws_iam' ? 'IamAuth' : 'ApplicationManaged',
        RevisionWeights: [
          { RevisionId: { 'Fn::GetAtt': [revisionLogicalId, 'RevisionId'] }, Weight: 100 },
        ],
        // On update an omitted limit keeps its previous value, only an empty object clears it
        ScalingConfig: url.maxEnvironments == null ? {} : { MaxEnvironments: url.maxEnvironments },
        ThrottleConfig: url.rateLimit == null ? {} : { RateLimit: url.rateLimit },
      },
    };

    if (url.regions && url.regions.length) endpointResource.Properties.Regions = url.regions;

    Object.assign(cfTemplate.Resources, {
      [webFunctionLogicalId]: webFunctionResource,
      [revisionLogicalId]: revisionResource,
      [endpointLogicalId]: endpointResource,
    });

    cfTemplate.Outputs[naming.getWebFunctionUrlOutputLogicalId(webAppName)] = {
      Description: 'Lambda Web Function URL',
      Value: {
        'Fn::Join': ['', ['https://', { 'Fn::GetAtt': [endpointLogicalId, 'DomainName'] }]],
      },
    };
  }

  compileDeploymentBucketPolicy() {
    const cfTemplate = this.serverless.service.provider.compiledCloudFormationTemplate;
    const { naming } = this.provider;
    const deploymentBucketPolicy =
      cfTemplate.Resources[naming.getDeploymentBucketPolicyLogicalId()];
    if (!deploymentBucketPolicy) return;

    deploymentBucketPolicy.Properties.PolicyDocument.Statement.push({
      Effect: 'Allow',
      Principal: { Service: 'lambda.amazonaws.com' },
      Action: ['s3:GetObject', 's3:GetObjectVersion'],
      Resource: {
        'Fn::Join': [
          '',
          [
            'arn:',
            { Ref: 'AWS::Partition' },
            ':s3:::',
            { Ref: naming.getDeploymentBucketLogicalId() },
            `/${naming.getWebAppArtifactS3KeyDirname()}/*`,
          ],
        ],
      },
      Condition: {
        ArnLike: {
          'aws:SourceArn': this.serverless.service.getAllWebApps().map((webAppName) => ({
            'Fn::Sub': `arn:\${AWS::Partition}:lambda:\${AWS::Region}:\${AWS::AccountId}:web-function/${
              this.serverless.service.getWebApp(webAppName).name
            }/revision/*`,
          })),
        },
      },
    });
  }

  async compileWebApps() {
    const allWebApps = this.serverless.service.getAllWebApps();
    if (!allWebApps.length) return;

    await Promise.all(allWebApps.map((webAppName) => this.compileWebApp(webAppName)));
    this.compileDeploymentBucketPolicy();
  }
}

module.exports = AwsCompileWebApps;
