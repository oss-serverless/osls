'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const promiseLimit = require('ext/promise/limit').bind(Promise);
const getLambdaLayerArtifactPath = require('../../utils/get-lambda-layer-artifact-path');
const { log } = require('../../../../utils/serverless-utils/log');
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const { isCloudFormationMissingStackError } = require('../../../../aws/aws-sdk-v3-error');

const getLayerArtifactHash = async (layerArtifactPath, layerForHash) =>
  new Promise((resolve, reject) => {
    const sha = crypto.createHash('sha1');
    sha.update(JSON.stringify(layerForHash));

    const readStream = fs.createReadStream(layerArtifactPath);
    readStream
      .on('data', (chunk) => {
        sha.update(chunk);
      })
      .on('close', () => {
        resolve(sha.digest('hex'));
      })
      .on('error', reject);
  });

class AwsCompileLayers {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    const serviceDir = this.serverless.serviceDir || '';
    this.packagePath =
      this.serverless.service.package.path || path.join(serviceDir || '.', '.serverless');

    this.provider = this.serverless.getProvider('aws');
    this.limitCloudFormationRequests = promiseLimit(2, async (task) => task());

    this.hooks = {
      'package:compileLayers': async () => this.compileLayers(),
    };
  }

  getCloudFormationClient() {
    if (!this.cloudFormationClientPromise) {
      this.cloudFormationClientPromise = this.provider
        .getAwsSdkV3Config()
        .then((config) => new CloudFormationClient(config));
    }
    return this.cloudFormationClientPromise;
  }

  async compileLayer(layerName) {
    const newLayer = this.cfLambdaLayerTemplate();
    const layerObject = this.serverless.service.getLayer(layerName);
    layerObject.package = layerObject.package || {};
    Object.defineProperty(newLayer, '_serverlessLayerName', { value: layerName });

    const artifactFilePath = this.provider.resolveLayerArtifactName(layerName);

    if (this.serverless.service.package.deploymentBucket) {
      newLayer.Properties.Content.S3Bucket = this.serverless.service.package.deploymentBucket;
    }

    const s3Folder = this.serverless.service.package.artifactDirectoryName;
    const s3FileName = artifactFilePath.split(path.sep).pop();
    newLayer.Properties.Content.S3Key = `${s3Folder}/${s3FileName}`;

    newLayer.Properties.LayerName = layerObject.name || layerName;
    if (layerObject.description) {
      newLayer.Properties.Description = layerObject.description;
    }
    if (layerObject.licenseInfo) {
      newLayer.Properties.LicenseInfo = layerObject.licenseInfo;
    }
    if (layerObject.compatibleRuntimes) {
      newLayer.Properties.CompatibleRuntimes = layerObject.compatibleRuntimes;
    }
    if (layerObject.compatibleArchitectures) {
      newLayer.Properties.CompatibleArchitectures = layerObject.compatibleArchitectures;
    }

    let layerLogicalId = this.provider.naming.getLambdaLayerLogicalId(layerName);
    const layerArtifactPath = getLambdaLayerArtifactPath(
      this.packagePath,
      layerName,
      this.provider.serverless.service,
      this.provider.naming
    );
    const layerForHash = structuredClone(newLayer);
    delete layerForHash.Properties.Content.S3Key;
    const sha = await getLayerArtifactHash(layerArtifactPath, layerForHash);
    if (layerObject.retain) {
      layerLogicalId = `${layerLogicalId}${sha}`;
      newLayer.DeletionPolicy = 'Retain';
    }
    const newLayerObject = {
      [layerLogicalId]: newLayer,
    };

    if (layerObject.allowedAccounts) {
      layerObject.allowedAccounts.map((account) => {
        const newPermission = this.cfLambdaLayerPermissionTemplate();
        newPermission.Properties.LayerVersionArn = { Ref: layerLogicalId };
        newPermission.Properties.Principal = account;
        let layerPermLogicalId = this.provider.naming.getLambdaLayerPermissionLogicalId(
          layerName,
          account
        );
        if (layerObject.retain) {
          layerPermLogicalId = `${layerPermLogicalId}${sha}`;
          newPermission.DeletionPolicy = 'Retain';
        }
        newLayerObject[layerPermLogicalId] = newPermission;
        return newPermission;
      });
    }

    Object.assign(
      this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
      newLayerObject
    );

    // Add layer to Outputs section
    const layerOutputLogicalId = this.provider.naming.getLambdaLayerOutputLogicalId(layerName);
    const newLayerOutput = this.cfOutputLayerTemplate();

    newLayerOutput.Value = { Ref: layerLogicalId };

    const layerHashOutputLogicalId =
      this.provider.naming.getLambdaLayerHashOutputLogicalId(layerName);
    const newLayerHashOutput = this.cfOutputLayerHashTemplate();
    newLayerHashOutput.Value = sha;

    const layerS3KeyOutputLogicalId =
      this.provider.naming.getLambdaLayerS3KeyOutputLogicalId(layerName);
    const newLayerS3KeyOutput = this.cfOutputLayerS3KeyTemplate();
    newLayerS3KeyOutput.Value = newLayer.Properties.Content.S3Key;

    Object.assign(this.serverless.service.provider.compiledCloudFormationTemplate.Outputs, {
      [layerOutputLogicalId]: newLayerOutput,
      [layerHashOutputLogicalId]: newLayerHashOutput,
      [layerS3KeyOutputLogicalId]: newLayerS3KeyOutput,
    });
  }

  async compareWithLastLayer(layerName) {
    const stackName = this.provider.naming.getStackName();
    const layerHashOutputLogicalId =
      this.provider.naming.getLambdaLayerHashOutputLogicalId(layerName);
    const cloudFormation = await this.getCloudFormationClient();

    let data;
    try {
      data = await this.limitCloudFormationRequests(() =>
        cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }))
      );
    } catch (e) {
      if (isCloudFormationMissingStackError(e)) {
        return;
      }
      throw e;
    }

    const lastHash = data.Stacks[0].Outputs.find(
      (output) => output.OutputKey === layerHashOutputLogicalId
    );
    const compiledCloudFormationTemplate =
      this.serverless.service.provider.compiledCloudFormationTemplate;
    const newSha = compiledCloudFormationTemplate.Outputs[layerHashOutputLogicalId].Value;
    if (lastHash == null || lastHash.OutputValue !== newSha) {
      return;
    }

    const layerS3keyOutputLogicalId =
      this.provider.naming.getLambdaLayerS3KeyOutputLogicalId(layerName);
    const lastS3Key = data.Stacks[0].Outputs.find(
      (output) => output.OutputKey === layerS3keyOutputLogicalId
    );
    compiledCloudFormationTemplate.Outputs[layerS3keyOutputLogicalId].Value = lastS3Key.OutputValue;
    const layerLogicalId = this.provider.naming.getLambdaLayerLogicalId(layerName);
    const layerResource =
      compiledCloudFormationTemplate.Resources[layerLogicalId] ||
      compiledCloudFormationTemplate.Resources[`${layerLogicalId}${lastHash.OutputValue}`];
    layerResource.Properties.Content.S3Key = lastS3Key.OutputValue;
    const layerObject = this.serverless.service.getLayer(layerName);
    layerObject.artifactAlreadyUploaded = true;
    log.info(`Layer ${layerName} is already uploaded.`);
  }

  async compileLayers() {
    const allLayers = this.serverless.service.getAllLayers();
    if (!allLayers.length) return;

    await Promise.all(
      allLayers.map((layerName) =>
        this.compileLayer(layerName).then(() => this.compareWithLastLayer(layerName))
      )
    );
  }

  cfLambdaLayerTemplate() {
    return {
      Type: 'AWS::Lambda::LayerVersion',
      Properties: {
        Content: {
          S3Bucket: {
            Ref: 'ServerlessDeploymentBucket',
          },
          S3Key: 'S3Key',
        },
        LayerName: 'LayerName',
      },
    };
  }

  cfLambdaLayerPermissionTemplate() {
    return {
      Type: 'AWS::Lambda::LayerVersionPermission',
      Properties: {
        Action: 'lambda:GetLayerVersion',
        LayerVersionArn: 'LayerVersionArn',
        Principal: 'Principal',
      },
    };
  }

  cfOutputLayerTemplate() {
    return {
      Description: 'Current Lambda layer version',
      Value: 'Value',
    };
  }

  cfOutputLayerHashTemplate() {
    return {
      Description: 'Current Lambda layer hash',
      Value: 'Value',
    };
  }

  cfOutputLayerS3KeyTemplate() {
    return {
      Description: 'Current Lambda layer S3Key',
      Value: 'Value',
    };
  }
}

module.exports = AwsCompileLayers;
