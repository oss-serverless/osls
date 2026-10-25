'use strict';

const promiseLimit = require('ext/promise/limit').bind(Promise);
const { log, writeText } = require('../../utils/serverless-utils/log');
const validate = require('./lib/validate');
const parseDeploymentObjectKey = require('./utils/parse-deployment-object-key');
const setBucketName = require('./lib/set-bucket-name');
const ServerlessError = require('../../serverless-error');
const { S3Client, paginateListObjectsV2 } = require('@aws-sdk/client-s3');
const {
  LambdaClient,
  GetFunctionCommand,
  ListVersionsByFunctionCommand,
} = require('@aws-sdk/client-lambda');
const { isS3ListObjectsAccessDeniedError } = require('../../aws/aws-sdk-v3-error');

class AwsDeployList {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('aws');
    this.limitLambdaRequests = promiseLimit(6, async (task) => task());

    Object.assign(this, validate, setBucketName);

    this.hooks = {
      'before:deploy:list:log': () => this.validate(),
      'before:deploy:list:functions:log': () => this.validate(),

      'deploy:list:log': async () => {
        await this.setBucketName();
        await this.listDeployments();
      },
      'deploy:list:functions:log': async () => this.listFunctions(),
    };
  }

  async getS3Client() {
    this.s3ClientPromise ||= this.provider
      .getAwsSdkV3Config()
      .then((config) => new S3Client(config));
    return this.s3ClientPromise;
  }

  async getLambdaClient() {
    this.lambdaClientPromise ||= this.provider
      .getAwsSdkV3Config()
      .then((config) => new LambdaClient(config));
    return this.lambdaClientPromise;
  }

  async listDeployments() {
    const service = this.serverless.service.service;
    const stage = this.provider.getStage();
    const prefix = this.provider.getDeploymentPrefix();

    let foundDeployment = false;
    let currentDirectory = null;
    let currentDeployment = [];
    const flushDeployment = () => {
      if (!currentDeployment.length) return;
      this.printDeployment(currentDeployment);
      foundDeployment = true;
      currentDeployment = [];
    };

    try {
      const s3 = await this.getS3Client();
      const paginator = paginateListObjectsV2(
        { client: s3 },
        {
          Bucket: this.bucketName,
          Prefix: `${prefix}/${service}/${stage}/`,
        }
      );
      for await (const page of paginator) {
        for (const object of page.Contents || []) {
          const entry = parseDeploymentObjectKey(object.Key, prefix, service, stage);
          if (!entry) continue;

          if (currentDirectory && entry.directory !== currentDirectory) flushDeployment();
          currentDirectory = entry.directory;
          currentDeployment.push(entry);
        }
      }
      flushDeployment();
    } catch (err) {
      if (isS3ListObjectsAccessDeniedError(err)) {
        throw new ServerlessError(
          'Could not list objects in the deployment bucket. Make sure you have sufficient permissions to access it.',
          'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED'
        );
      }
      throw err;
    }

    if (!foundDeployment) {
      log.notice();
      log.notice.skip(
        "No deployments found, if that's unexpected ensure that stage and region are correct"
      );
    }
  }

  printDeployment(deployment) {
    const directoryRegex = new RegExp('(.+)-(.+-.+-.+)');
    const match = deployment[0].directory.match(directoryRegex);
    const date = new Date(Date.parse(match[2]));
    writeText(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, 0)}-${String(
        date.getUTCDate()
      ).padStart(2, 0)} ` +
        `${String(date.getUTCHours()).padStart(2, 0)}:${String(date.getUTCMinutes()).padStart(
          2,
          0
        )}:${String(date.getUTCSeconds()).padStart(2, 0)} UTC`,
      `Timestamp: ${match[1]}`,
      'Files:'
    );
    deployment.forEach((entry) => {
      writeText(`  - ${entry.file}`);
    });
  }

  // list all functions and their versions
  async listFunctions() {
    const funcs = await this.getFunctions();
    const funcsVersions = await this.getFunctionVersions(funcs);
    this.displayFunctions(funcsVersions);
  }

  async getFunctions() {
    const funcs = this.serverless.service.getAllFunctionsNames();
    const lambda = await this.getLambdaClient();

    const result = await Promise.all(
      funcs.map((funcName) => {
        const params = {
          FunctionName: funcName,
        };

        return this.limitLambdaRequests(() => lambda.send(new GetFunctionCommand(params)));
      })
    );

    return result.map((item) => item.Configuration);
  }

  async getFunctionPaginatedVersions(params, totalVersions) {
    const lambda = await this.getLambdaClient();
    const Versions = totalVersions ? [...totalVersions] : [];
    let input = params;

    do {
      const response = await lambda.send(new ListVersionsByFunctionCommand(input));
      Versions.push(...(response.Versions || []));
      input = response.NextMarker ? { ...params, Marker: response.NextMarker } : null;
    } while (input);

    return { Versions };
  }

  async getFunctionVersions(funcs) {
    return Promise.all(
      funcs.map((func) => {
        const params = {
          FunctionName: func.FunctionName,
        };

        return this.limitLambdaRequests(() => this.getFunctionPaginatedVersions(params));
      })
    );
  }

  displayFunctions(funcs) {
    funcs.forEach((func) => {
      let name = func.Versions[0].FunctionName;
      name = name.replace(`${this.serverless.service.service}-`, '');
      name = name.replace(`${this.provider.getStage()}-`, '');

      writeText(name);
      const versionsLength = func.Versions.length;
      const versions = func.Versions.map((funcEntry) => funcEntry.Version).slice(
        Math.max(0, func.Versions.length - 5)
      );
      if (versionsLength < 6) writeText(`  All versions: ${versions.join(', ')}`);
      else writeText(`  Last 5 versions: ${versions.join(', ')}`);
    });
  }
}

module.exports = AwsDeployList;
