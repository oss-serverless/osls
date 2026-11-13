'use strict';

const path = require('path');
const ServerlessError = require('../../../../serverless-error');
const { safeShallowAssign } = require('../../../../utils/safe-object');
const getWebFunctionArtifactS3Key = require('../../utils/get-web-function-artifact-s3-key');
const validateWebFunctionsDeploymentMode = require('../../utils/validate-web-functions-deployment-mode');
const webFunctionsDocsUrl = require('../../../../aws/web-functions-docs-url');

const namePattern = /^[A-Za-z0-9]([A-Za-z0-9_-]*[A-Za-z0-9])?$/;
const maxNameLength = 64;
const kmsKeyArnPattern = /^arn:[^:]+:kms:[^:]*:[^:]*:key\//;

const environmentVariableNamePattern = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const entryPointEnvironmentVariable = 'AWS_LAMBDA_NODEJS_ENTRYPOINT';
const reservedEnvironmentVariables = new Set([
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
const maxEnvironmentVariableValueLength = 4096;
const maxEnvironmentSize = 32 * 1024;

class AwsCompileWebFunctions {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'initialize': () => this.validateKeysAgainstFunctions(),
      'package:initialize': () => this.validate(),
      'package:compileFunctions': async () => this.compileWebFunctions(),
    };
  }

  validateKeysAgainstFunctions() {
    const { service } = this.serverless;
    const { naming } = this.provider;
    const functionNames = service.getAllFunctions();
    const functionNamesByLogGroupLogicalId = new Map(
      functionNames
        .filter((functionName) => !service.getFunction(functionName).disableLogs)
        .map((functionName) => [naming.getLogGroupLogicalId(functionName), functionName])
    );

    for (const webFunctionName of service.getAllWebFunctions()) {
      if (functionNames.includes(webFunctionName)) {
        throw new ServerlessError(
          `Web function "${webFunctionName}" has the same key as function "${webFunctionName}". The "--function" option of commands takes either, rename one of them.`,
          'WEB_FUNCTION_KEY_ALREADY_USED_BY_FUNCTION'
        );
      }

      for (const logGroupLogicalId of [
        naming.getWebFunctionLogGroupLogicalId(webFunctionName),
        naming.getWebFunctionLocalLogGroupLogicalId(webFunctionName),
      ]) {
        if (functionNamesByLogGroupLogicalId.has(logGroupLogicalId)) {
          throw new ServerlessError(
            `Web function "${webFunctionName}" and function "${functionNamesByLogGroupLogicalId.get(
              logGroupLogicalId
            )}" both get a log group with the "${logGroupLogicalId}" logical ID. Rename one of them.`,
            'WEB_FUNCTION_LOGICAL_ID_ALREADY_USED_BY_FUNCTION'
          );
        }
      }
    }
  }

  validate() {
    const { service } = this.serverless;
    const webFunctionNames = service.getAllWebFunctions();
    if (!webFunctionNames.length) return;

    validateWebFunctionsDeploymentMode(service.provider);

    const webFunctionNamesByName = new Map();
    for (const webFunctionName of webFunctionNames) {
      const webFunctionObject = service.getWebFunction(webFunctionName);

      if (
        !namePattern.test(webFunctionObject.name) ||
        webFunctionObject.name.length > maxNameLength
      ) {
        throw new ServerlessError(
          `Web function "${webFunctionName}" has an invalid name "${webFunctionObject.name}". The name can have up to ${maxNameLength} letters, digits, hyphens and underscores, and has to start and end with a letter or a digit. Set a valid "name" on the web function.`,
          'WEB_FUNCTION_INVALID_NAME'
        );
      }
      if (webFunctionNamesByName.has(webFunctionObject.name)) {
        throw new ServerlessError(
          `Web functions "${webFunctionNamesByName.get(
            webFunctionObject.name
          )}" and "${webFunctionName}" are both named "${webFunctionObject.name}". Set a different "name" on one of them.`,
          'WEB_FUNCTION_NAME_ALREADY_USED'
        );
      }
      webFunctionNamesByName.set(webFunctionObject.name, webFunctionName);

      const { entryPoint, kmsKeyArn } = webFunctionObject;
      if (entryPoint) {
        let entryPointProblem;
        if (typeof entryPoint !== 'string') {
          entryPointProblem = 'is not a string';
        } else if (path.posix.isAbsolute(entryPoint) || path.win32.isAbsolute(entryPoint)) {
          entryPointProblem = 'is an absolute path';
        } else if (entryPoint.includes('\\')) {
          entryPointProblem = 'contains a backslash';
        } else if (
          this.provider
            .getWebFunctionEntryPoint(entryPoint)
            .split('/')
            .some((segment) => segment === '.' || segment === '..')
        ) {
          entryPointProblem = 'contains a "." or ".." segment';
        }
        if (entryPointProblem) {
          throw new ServerlessError(
            `Web function "${webFunctionName}" has an invalid "entryPoint", it ${entryPointProblem}. Set it to the path of the file relative to the root of the package, written with forward slashes and without "." or ".." segments, for example "src/server.js".`,
            'WEB_FUNCTION_INVALID_ENTRY_POINT'
          );
        }
      }

      if (typeof kmsKeyArn === 'string' && !kmsKeyArnPattern.test(kmsKeyArn)) {
        throw new ServerlessError(
          `Web function "${webFunctionName}" sets "kmsKeyArn" to "${kmsKeyArn}", which is not the ARN of a key. Lambda does not accept the ARN of an alias on web functions. Set it to an ARN of the form "arn:aws:kms:<region>:<account ID>:key/<key ID>".`,
          'WEB_FUNCTION_INVALID_KMS_KEY_ARN'
        );
      }

      let environmentSize = 0;
      for (const [variableName, value] of Object.entries(
        this.resolveEnvironment(webFunctionObject)
      )) {
        if (variableName === entryPointEnvironmentVariable) {
          throw new ServerlessError(
            `Web function "${webFunctionName}" sets the "${variableName}" environment variable. Set "entryPoint" on the web function instead, and remove the variable from "environment" and from "provider.environment".`,
            'WEB_FUNCTION_ENTRY_POINT_ENVIRONMENT_VARIABLE_DEFINED'
          );
        }
        if (reservedEnvironmentVariables.has(variableName)) {
          throw new ServerlessError(
            `Web function "${webFunctionName}" sets the "${variableName}" environment variable, which Lambda reserves on web functions. Remove it from "environment" and from "provider.environment".`,
            'WEB_FUNCTION_RESERVED_ENVIRONMENT_VARIABLE'
          );
        }
        if (!environmentVariableNamePattern.test(variableName) || value === '') {
          throw new ServerlessError(
            `Web function "${webFunctionName}" sets the "${variableName}" environment variable, which Lambda does not accept on web functions. Names have to start with a letter and values cannot be empty.`,
            'WEB_FUNCTION_INVALID_ENVIRONMENT_VARIABLE'
          );
        }
        environmentSize += Buffer.byteLength(variableName);
        if (typeof value !== 'string') continue;
        if (value.length > maxEnvironmentVariableValueLength) {
          throw new ServerlessError(
            `Web function "${webFunctionName}" sets the "${variableName}" environment variable to a value of ${value.length} characters. Lambda accepts values of up to ${maxEnvironmentVariableValueLength} characters on web functions.`,
            'WEB_FUNCTION_INVALID_ENVIRONMENT_VARIABLE'
          );
        }
        environmentSize += Buffer.byteLength(value);
      }
      if (environmentSize > maxEnvironmentSize) {
        throw new ServerlessError(
          `The environment variables of web function "${webFunctionName}" take ${environmentSize} bytes, names and values together. Lambda accepts up to 32 KB on web functions.`,
          'WEB_FUNCTION_ENVIRONMENT_TOO_LARGE'
        );
      }

      const { type, regions } = this.provider.resolveWebFunctionEndpoint(
        webFunctionObject.endpoint
      );
      if (type === 'HomeRegion') {
        if (regions.length) {
          throw new ServerlessError(
            `Web function "${webFunctionName}" sets "endpoint.regions" on an endpoint of the "HomeRegion" type, which only serves the region of the service. Remove "endpoint.regions", or set "endpoint.type" to "MultiRegion" or "PerRegion".`,
            'WEB_FUNCTION_ENDPOINT_REGIONS_NOT_ALLOWED'
          );
        }
      } else if (!regions.some((region) => region !== this.provider.getRegion())) {
        throw new ServerlessError(
          `Web function "${webFunctionName}" has an endpoint of the "${type}" type without another region to serve. List at least one region other than "${this.provider.getRegion()}", the region of the service, in "endpoint.regions".`,
          'WEB_FUNCTION_ENDPOINT_REGIONS_REQUIRED'
        );
      }
    }

    // A bucket named by the user is never configured by the framework
    if (service.provider.deploymentBucket) return;

    const deploymentBucketObject = service.provider.deploymentBucketObject || {};
    if (!deploymentBucketObject.versioning) {
      throw new ServerlessError(
        [
          'Lambda reads the code of web functions from a versioned S3 bucket. Enable versioning of the deployment bucket in the service configuration:',
          '',
          'provider:',
          '  deploymentBucket:',
          '    versioning: true',
          '',
          `Learn more: ${webFunctionsDocsUrl}#deployment-bucket`,
        ].join('\n'),
        'WEB_FUNCTIONS_DEPLOYMENT_BUCKET_VERSIONING_REQUIRED'
      );
    }
    if (deploymentBucketObject.skipPolicySetup) {
      throw new ServerlessError(
        `Web functions cannot be deployed with "provider.deploymentBucket.skipPolicySetup", because Lambda reads their code through a statement of the deployment bucket policy. Remove "skipPolicySetup", or deploy to a bucket of your own. Learn more: ${webFunctionsDocsUrl}#deployment-bucket`,
        'WEB_FUNCTIONS_DEPLOYMENT_BUCKET_POLICY_REQUIRED'
      );
    }
  }

  resolveEnvironment(webFunctionObject) {
    return safeShallowAssign(
      {},
      this.serverless.service.provider.environment,
      webFunctionObject.environment
    );
  }

  async compileWebFunction(webFunctionName) {
    const { service } = this.serverless;
    const { naming } = this.provider;
    const cfTemplate = service.provider.compiledCloudFormationTemplate;
    const webFunctionObject = service.getWebFunction(webFunctionName);
    const webFunctionLogicalId = naming.getWebFunctionLogicalId(webFunctionName);
    const revisionLogicalId = naming.getWebFunctionRevisionLogicalId(webFunctionName);
    const endpointLogicalId = naming.getWebFunctionEndpointLogicalId(webFunctionName);
    const artifactS3Key = await getWebFunctionArtifactS3Key(
      path.join(
        this.serverless.serviceDir,
        '.serverless',
        naming.getWebFunctionArtifactName(webFunctionName)
      ),
      webFunctionName,
      naming
    );

    const webFunctionResource = {
      Type: 'AWS::Lambda::WebFunction',
      Properties: {
        FunctionName: webFunctionObject.name,
      },
    };

    const tags = safeShallowAssign({}, service.provider.tags, webFunctionObject.tags);
    if (Object.keys(tags).length) {
      webFunctionResource.Properties.Tags = Object.entries(tags).map(([Key, Value]) => ({
        Key,
        Value,
      }));
    }

    const revisionResource = {
      Type: 'AWS::Lambda::WebFunctionRevision',
      DependsOn: [
        naming.getWebFunctionLogGroupLogicalId(webFunctionName),
        naming.getWebFunctionLocalLogGroupLogicalId(webFunctionName),
      ],
      Properties: {
        FunctionName: { Ref: webFunctionLogicalId },
        BuildConfig: {
          CodeConfig: {
            S3Object: {
              Bucket: service.package.deploymentBucket || {
                Ref: naming.getDeploymentBucketLogicalId(),
              },
              Key: artifactS3Key,
            },
          },
          RuntimeConfig: {
            Runtime: this.provider.getWebFunctionRuntime(webFunctionObject.runtime),
          },
        },
        ServiceConfig: {},
      },
    };

    // Lambda checks its access to the code when the revision is created
    const deploymentBucketPolicyLogicalId = naming.getDeploymentBucketPolicyLogicalId();
    if (cfTemplate.Resources[deploymentBucketPolicyLogicalId]) {
      revisionResource.DependsOn.push(deploymentBucketPolicyLogicalId);
    }

    if (webFunctionObject.description) {
      revisionResource.Properties.Description = webFunctionObject.description;
    }

    if (webFunctionObject.kmsKeyArn) {
      revisionResource.Properties.KmsKeyArn = webFunctionObject.kmsKeyArn;
    }

    const serviceConfig = revisionResource.Properties.ServiceConfig;
    const role =
      this.provider.getCustomExecutionRole(webFunctionObject) || naming.getRoleLogicalId();
    // A string other than an ARN is the logical ID of a role of this stack
    serviceConfig.ExecutionRoleArn =
      typeof role === 'string' && !role.startsWith('arn:') ? { 'Fn::GetAtt': [role, 'Arn'] } : role;

    if (webFunctionObject.timeout) {
      serviceConfig.TimeoutSeconds = webFunctionObject.timeout;
    }
    if (webFunctionObject.maxConcurrencyPerEnvironment) {
      serviceConfig.MaxConcurrencyPerEnvironment = webFunctionObject.maxConcurrencyPerEnvironment;
    }

    const environment = this.resolveEnvironment(webFunctionObject);
    const entryPoint = this.provider.getWebFunctionEntryPoint(webFunctionObject.entryPoint);
    if (entryPoint !== 'index.js') {
      environment[entryPointEnvironmentVariable] = entryPoint;
    }
    if (Object.keys(environment).length) {
      serviceConfig.EnvironmentVariables = environment;
    }

    const { applicationLogLevel, systemLogLevel } = webFunctionObject.logs || {};
    if (applicationLogLevel || systemLogLevel) {
      const loggingConfig = {};
      if (applicationLogLevel) loggingConfig.ApplicationLogLevel = applicationLogLevel;
      if (systemLogLevel) loggingConfig.SystemLogLevel = systemLogLevel;
      serviceConfig.TelemetryConfig = { LoggingConfig: loggingConfig };
    }

    const endpoint = this.provider.resolveWebFunctionEndpoint(webFunctionObject.endpoint);
    const endpointResource = {
      Type: 'AWS::Lambda::WebFunctionEndpoint',
      Properties: {
        FunctionName: { Ref: webFunctionLogicalId },
        EndpointName: endpoint.name || naming.getWebFunctionEndpointName(),
        EndpointType: endpoint.type,
        AuthType: endpoint.authorizer === 'aws_iam' ? 'IamAuth' : 'ApplicationManaged',
        RevisionWeights: [
          { RevisionId: { 'Fn::GetAtt': [revisionLogicalId, 'RevisionId'] }, Weight: 100 },
        ],
        // An omitted block keeps the limit of the deployed endpoint, an empty one clears it
        ScalingConfig: endpoint.maxEnvironments
          ? { MaxEnvironments: endpoint.maxEnvironments }
          : {},
        ThrottleConfig: endpoint.rateLimit == null ? {} : { RateLimit: endpoint.rateLimit },
      },
    };
    if (endpoint.regions.length) {
      endpointResource.Properties.Regions = endpoint.regions;
    }

    Object.assign(cfTemplate.Resources, {
      [webFunctionLogicalId]: webFunctionResource,
      [revisionLogicalId]: revisionResource,
      [endpointLogicalId]: endpointResource,
    });

    cfTemplate.Outputs[naming.getWebFunctionUrlOutputLogicalId(webFunctionName)] = {
      Description: 'Lambda Web Function URL',
      Value: {
        'Fn::Join': ['', ['https://', { 'Fn::GetAtt': [endpointLogicalId, 'DomainName'] }]],
      },
    };
  }

  compileDeploymentBucketPolicy() {
    const { service } = this.serverless;
    const deploymentBucketPolicy =
      service.provider.compiledCloudFormationTemplate.Resources[
        this.provider.naming.getDeploymentBucketPolicyLogicalId()
      ];
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
            { Ref: this.provider.naming.getDeploymentBucketLogicalId() },
            '/*',
          ],
        ],
      },
      Condition: {
        ArnLike: {
          // Any name, so that a renamed web function keeps the access while its old revision serves
          'aws:SourceArn': {
            'Fn::Sub':
              'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:web-function/*/revision/*',
          },
        },
      },
    });
  }

  async compileWebFunctions() {
    const webFunctionNames = this.serverless.service.getAllWebFunctions();
    if (!webFunctionNames.length) return;

    for (const webFunctionName of webFunctionNames) {
      await this.compileWebFunction(webFunctionName);
    }
    this.compileDeploymentBucketPolicy();
  }
}

module.exports = AwsCompileWebFunctions;
