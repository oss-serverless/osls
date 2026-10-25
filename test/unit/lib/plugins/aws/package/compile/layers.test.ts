'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const chai = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { getTmpDirPath } = require('../../../../../../utils/fs');
const runServerless = require('../../../../../../utils/run-serverless');
const releasePendingRequestsUntilSettled = require('../../../../../../utils/release-pending-requests-until-settled');
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');

const expect = chai.expect;

const awsSdkV3StubMap = {
  CloudFormation: {
    describeStacks: {
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'LayerLambdaLayerHash', OutputValue: '1qaz' },
            { OutputKey: 'LayerLambdaLayerS3Key', OutputValue: 'a/b/c/foo.zip' },
          ],
        },
      ],
    },
  },
};

describe('lib/plugins/aws/package/compile/layers/index.test.js', () => {
  const allowedAccount = 'arn:aws:iam::123456789012:root';
  let cfResources;
  let naming;
  let updateConfig;
  let serviceDir;
  let service;
  let cfOutputs;

  before(async () => {
    const { awsNaming, cfTemplate, fixtureData, serverless } = await runServerless({
      fixture: 'layer',
      command: 'package',
      configExt: {
        package: {
          individually: true,
        },
        layers: {
          layerOne: {
            path: 'layer',
            allowedAccounts: ['*'],
          },
          layerTwo: {
            description: 'Layer two example',
            path: 'layer',
            compatibleRuntimes: ['nodejs20.x'],
            compatibleArchitectures: ['arm64'],
            licenseInfo: 'GPL',
            allowedAccounts: ['123456789012', '123456789013'],
          },
          layerRetain: {
            path: 'layer',
            retain: true,
            allowedAccounts: [allowedAccount],
          },
        },
      },
      awsSdkV3StubMap,
    });
    cfResources = cfTemplate.Resources;
    cfOutputs = cfTemplate.Outputs;
    naming = awsNaming;
    service = serverless.service;
    ({ updateConfig, servicePath: serviceDir } = fixtureData);
  });

  it('should support `layers[].package.artifact` with `package.individually`', () => {
    const resourceName = 'layer';
    const layerResource = cfResources[naming.getLambdaLayerLogicalId(resourceName)];
    const s3Folder = service.package.artifactDirectoryName;
    const s3FileName = service.layers[resourceName].package.artifact.split(path.sep).pop();

    expect(layerResource.Properties.Content.S3Key).to.equal(`${s3Folder}/${s3FileName}`);
  });

  it('should generate expected layer version resource', () => {
    const resourceName = 'layer';
    const layerResource = cfResources[naming.getLambdaLayerLogicalId(resourceName)];
    const s3Folder = service.package.artifactDirectoryName;
    const s3FileName = service.layers[resourceName].package.artifact.split(path.sep).pop();

    expect(layerResource.Type).to.equals('AWS::Lambda::LayerVersion');
    expect(layerResource.Properties.Content.S3Key).to.equal(`${s3Folder}/${s3FileName}`);
    expect(layerResource.Properties.LayerName).to.equal('layer');
    expect(layerResource.Properties.Content.S3Bucket.Ref).to.equal('ServerlessDeploymentBucket');

    expect(cfOutputs.LayerLambdaLayerQualifiedArn.Description).to.equals(
      'Current Lambda layer version'
    );
    expect(cfOutputs.LayerLambdaLayerQualifiedArn.Value.Ref).to.equals('LayerLambdaLayer');
  });

  it('hashes layer artifacts with streams instead of buffering the whole zip', async () => {
    const packagePath = getTmpDirPath();
    const layerArtifactPath = path.join(packagePath, 'layer.zip');
    fs.mkdirSync(packagePath, { recursive: true });
    fs.writeFileSync(layerArtifactPath, 'layer artifact content');

    const readFileStub = sinon.stub().rejects(new Error('layer artifact should not be buffered'));
    const createReadStreamStub = sinon
      .stub()
      .callsFake((filePath) => fs.createReadStream(filePath));
    const fakeFs = Object.create(fs);
    Object.defineProperty(fakeFs, 'promises', { value: { readFile: readFileStub } });
    fakeFs.createReadStream = createReadStreamStub;

    const AwsCompileLayers = proxyquire(
      '../../../../../../../lib/plugins/aws/package/compile/layers',
      {
        fs: fakeFs,
      }
    );

    const layerObject = { path: 'layer' };
    const testNaming = {
      getLayerArtifactName: sinon.stub().returns('layer.zip'),
      getLambdaLayerLogicalId: sinon.stub().returns('LayerLambdaLayer'),
      getLambdaLayerOutputLogicalId: sinon.stub().returns('LayerLambdaLayerQualifiedArn'),
      getLambdaLayerHashOutputLogicalId: sinon.stub().returns('LayerLambdaLayerHash'),
      getLambdaLayerS3KeyOutputLogicalId: sinon.stub().returns('LayerLambdaLayerS3Key'),
      getLambdaLayerPermissionLogicalId: sinon.stub().returns('LayerLambdaLayerPermission'),
    };
    const testService = {
      package: { artifactDirectoryName: 'artifact-dir', path: packagePath },
      provider: { compiledCloudFormationTemplate: { Resources: {}, Outputs: {} } },
      getLayer: sinon.stub().withArgs('layer').returns(layerObject),
    };
    const testProvider = {
      serverless: { service: testService },
      naming: testNaming,
      resolveLayerArtifactName: sinon.stub().withArgs('layer').returns(layerArtifactPath),
    };
    const testServerless = {
      serviceDir: packagePath,
      service: testService,
      getProvider: sinon.stub().withArgs('aws').returns(testProvider),
    };

    const awsCompileLayers = new AwsCompileLayers(testServerless, {});
    await awsCompileLayers.compileLayer('layer');

    expect(createReadStreamStub).to.have.been.calledOnceWithExactly(layerArtifactPath);
    expect(readFileStub).to.not.have.been.called;

    const layerForHash = structuredClone(
      testService.provider.compiledCloudFormationTemplate.Resources.LayerLambdaLayer
    );
    delete layerForHash.Properties.Content.S3Key;
    const expectedHash = crypto
      .createHash('sha1')
      .update(JSON.stringify(layerForHash))
      .update(fs.readFileSync(layerArtifactPath))
      .digest('hex');

    expect(
      testService.provider.compiledCloudFormationTemplate.Outputs.LayerLambdaLayerHash.Value
    ).to.equal(expectedHash);
  });

  describe('`layers[].retain` property', () => {
    it('should ensure expected deletion policy for layer resource', () => {
      const layerResourceNamePrefix = naming.getLambdaLayerLogicalId('layerRetain');
      const layerResourceName = Object.keys(cfResources).find((resourceName) =>
        resourceName.startsWith(layerResourceNamePrefix)
      );
      expect(layerResourceName).to.not.equal(layerResourceNamePrefix);
      const layerResource = cfResources[layerResourceName];
      expect(layerResource.DeletionPolicy).to.equal('Retain');
    });

    it('should ensure expected deletion policy for layer permission resource', () => {
      const layerPermissionResourceNamePrefix = naming.getLambdaLayerPermissionLogicalId(
        'layerRetain',
        allowedAccount
      );
      const layerPermissionResourceName = Object.keys(cfResources).find((resourceName) =>
        resourceName.startsWith(layerPermissionResourceNamePrefix)
      );
      expect(layerPermissionResourceName).to.not.equal(layerPermissionResourceNamePrefix);
      const layerPermissionResource = cfResources[layerPermissionResourceName];
      expect(layerPermissionResource.DeletionPolicy).to.equal('Retain');
    });

    it('should ensure unique resource id per layer version', async () => {
      const layerResourceNamePrefix = naming.getLambdaLayerLogicalId('layerRetain');
      const firstLayerResourceName = Object.keys(cfResources).find((resourceName) =>
        resourceName.startsWith(layerResourceNamePrefix)
      );

      await updateConfig({ layers: { layerRetain: { description: 'foo' } } });
      const {
        cfTemplate: { Resources: secondCfResources },
      } = await runServerless({
        cwd: serviceDir,
        command: 'package',
        awsSdkV3StubMap,
      });
      expect(secondCfResources).to.not.have.property(firstLayerResourceName);

      await updateConfig({ layers: { layerRetain: { description: null } } });
      const {
        cfTemplate: { Resources: firstCfResources },
      } = await runServerless({
        cwd: serviceDir,
        command: 'package',
        awsSdkV3StubMap,
      });
      expect(firstCfResources).to.have.property(firstLayerResourceName);
    });
  });

  it('should generate expected permissions resource', () => {
    const layerNamePermission = naming.getLambdaLayerPermissionLogicalId('LayerOne', 'Wild');
    const layerPermission = cfResources[layerNamePermission];

    expect(layerPermission.Type).to.equals('AWS::Lambda::LayerVersionPermission');
    expect(layerPermission.Properties.Action).to.equals('lambda:GetLayerVersion');
    expect(layerPermission.Properties.LayerVersionArn.Ref).to.equals('LayerOneLambdaLayer');
    expect(layerPermission.Properties.Principal).to.equals('*');
  });

  it('should support `layers[].allowedAccounts`', () => {
    const layerNamePermissionFirstUser = naming.getLambdaLayerPermissionLogicalId(
      'layerTwo',
      '123456789012'
    );
    const layerPermissionFirstUser = cfResources[layerNamePermissionFirstUser];
    expect(layerPermissionFirstUser.Properties.Principal).to.equals('123456789012');

    const layerNamePermissionUserSecond = naming.getLambdaLayerPermissionLogicalId(
      'layerTwo',
      '123456789013'
    );
    const layerPermissionSecondUser = cfResources[layerNamePermissionUserSecond];
    expect(layerPermissionSecondUser.Properties.Principal).to.equals('123456789013');
  });

  it('should support `layers[].description`', () => {
    const layerResourceName = naming.getLambdaLayerLogicalId('LayerTwo');
    const layerOne = cfResources[layerResourceName];

    expect(layerOne.Type).to.equals('AWS::Lambda::LayerVersion');
    expect(layerOne.Properties.Description).to.equals('Layer two example');
  });

  it('should support `layers[].compatibleRuntimes`', () => {
    const layerResourceName = naming.getLambdaLayerLogicalId('LayerTwo');
    const layerOne = cfResources[layerResourceName];

    expect(layerOne.Type).to.equals('AWS::Lambda::LayerVersion');
    expect(layerOne.Properties.CompatibleRuntimes).to.deep.equals(['nodejs20.x']);
  });

  it('should accept `layers[].compatibleRuntimes: [java25]`', async () => {
    const {
      awsNaming,
      cfTemplate: { Resources },
    } = await runServerless({
      fixture: 'layer',
      command: 'package',
      configExt: {
        layers: {
          layer: {
            compatibleRuntimes: ['java25'],
          },
        },
      },
      awsSdkV3StubMap,
    });

    expect(
      Resources[awsNaming.getLambdaLayerLogicalId('layer')].Properties.CompatibleRuntimes
    ).to.deep.equal(['java25']);
  });

  it('should accept `layers[].compatibleRuntimes: [ruby4.0]`', async () => {
    const {
      awsNaming,
      cfTemplate: { Resources },
    } = await runServerless({
      fixture: 'layer',
      command: 'package',
      configExt: {
        layers: {
          layer: {
            compatibleRuntimes: ['ruby4.0'],
          },
        },
      },
      awsSdkV3StubMap,
    });

    expect(
      Resources[awsNaming.getLambdaLayerLogicalId('layer')].Properties.CompatibleRuntimes
    ).to.deep.equal(['ruby4.0']);
  });

  it('should accept AL2023 Java runtimes in `layers[].compatibleRuntimes`', async () => {
    const {
      awsNaming,
      cfTemplate: { Resources },
    } = await runServerless({
      fixture: 'layer',
      command: 'package',
      configExt: {
        layers: {
          layer: {
            compatibleRuntimes: ['java8.al2023', 'java11.al2023', 'java17.al2023'],
          },
        },
      },
      awsSdkV3StubMap,
    });

    expect(
      Resources[awsNaming.getLambdaLayerLogicalId('layer')].Properties.CompatibleRuntimes
    ).to.deep.equal(['java8.al2023', 'java11.al2023', 'java17.al2023']);
  });

  it('should reject deprecated `layers[].compatibleRuntimes` values', () => {
    return expect(
      runServerless({
        fixture: 'layer',
        command: 'package',
        configExt: {
          layers: {
            layer: {
              compatibleRuntimes: ['go1.x'],
            },
          },
        },
        awsSdkV3StubMap,
      })
    ).to.eventually.be.rejected.and.have.property(
      'code',
      'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
    );
  });

  it('should support `layers[].compatibleArchitectures`', () => {
    const layerResourceName = naming.getLambdaLayerLogicalId('LayerTwo');
    const layerOne = cfResources[layerResourceName];

    expect(layerOne.Properties.CompatibleArchitectures).to.deep.equals(['arm64']);
  });

  it('should support `layers[].licenseInfo`', () => {
    const layerResourceName = naming.getLambdaLayerLogicalId('LayerTwo');
    const layerOne = cfResources[layerResourceName];

    expect(layerOne.Type).to.equals('AWS::Lambda::LayerVersion');
    expect(layerOne.Properties.LicenseInfo).to.deep.equals('GPL');
  });

  it('uses SDK v3 DescribeStacks when comparing previous layer uploads', async () => {
    const { awsNaming, awsSdkV3Stub, serverless } = await runServerless({
      fixture: 'layer',
      command: 'package',
      awsSdkV3StubMap,
    });
    const describeStacksSends = awsSdkV3Stub.sends.filter(
      ({ service, method }) => service === 'CloudFormation' && method === 'describeStacks'
    );

    expect(describeStacksSends).to.have.length(1);
    expect(describeStacksSends[0].commandName).to.equal('DescribeStacksCommand');
    expect(describeStacksSends[0].input).to.deep.equal({
      StackName: awsNaming.getStackName(),
    });
    const expectedCredentials = serverless.getProvider('aws').getAwsSdkV3CredentialsProvider();
    expect(describeStacksSends[0].clientConfig.region).to.equal('us-east-1');
    expect(describeStacksSends[0].clientConfig.credentials).to.equal(expectedCredentials);
  });

  it('ignores native SDK v3 missing stack errors when comparing previous layer uploads', async () => {
    await runServerless({
      fixture: 'layer',
      command: 'package',
      awsSdkV3StubMap: {
        CloudFormation: {
          describeStacks: () => {
            throw Object.assign(new Error('Stack with id service-dev does not exist'), {
              name: 'ValidationError',
            });
          },
        },
      },
    });
  });

  it('does not ignore message-only missing stack errors when comparing previous layer uploads', async () => {
    await expect(
      runServerless({
        fixture: 'layer',
        command: 'package',
        awsSdkV3StubMap: {
          CloudFormation: {
            describeStacks: () => {
              throw new Error('Stack with id service-dev does not exist');
            },
          },
        },
      })
    ).to.eventually.be.rejectedWith('Stack with id service-dev does not exist');
  });

  it('limits concurrent CloudFormation describeStacks requests to 2', async () => {
    const layerNames = ['layer'].concat(
      Array.from({ length: 9 }, (ignored, index) => `layer${index}`)
    );
    let activeRequests = 0;
    let observedMaxActiveRequests = 0;
    const pendingResolvers = [];
    const describeStacksStub = sinon
      .stub(CloudFormationClient.prototype, 'send')
      .callsFake(async (command) => {
        expect(command).to.be.instanceOf(DescribeStacksCommand);
        activeRequests += 1;
        observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
        expect(activeRequests).to.be.at.most(2);
        await new Promise((resolve) => pendingResolvers.push(resolve));
        activeRequests -= 1;
        return { Stacks: [{ Outputs: [] }] };
      });
    const AwsCompileLayers = require('../../../../../../../lib/plugins/aws/package/compile/layers');
    const compiledCloudFormationTemplate = { Resources: {}, Outputs: {} };
    const provider = {
      getAwsSdkV3Config: sinon.stub().resolves({
        region: 'us-east-1',
        credentials: async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' }),
      }),
      naming: {
        getStackName: sinon.stub().returns('service-dev'),
        getLambdaLayerHashOutputLogicalId: (layerName) => `${layerName}LambdaLayerHash`,
      },
    };
    const serverless = {
      service: {
        package: {},
        provider: { compiledCloudFormationTemplate },
        getAllLayers: sinon.stub().returns(layerNames),
      },
      getProvider: sinon.stub().withArgs('aws').returns(provider),
    };
    const awsCompileLayers = new AwsCompileLayers(serverless, {});
    sinon.stub(awsCompileLayers, 'compileLayer').callsFake(async (layerName) => {
      compiledCloudFormationTemplate.Outputs[`${layerName}LambdaLayerHash`] = {
        Value: 'new-sha',
      };
    });

    const promise = awsCompileLayers.compileLayers();

    try {
      for (let index = 0; index < 100 && pendingResolvers.length < 2; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(observedMaxActiveRequests).to.equal(2);
      await releasePendingRequestsUntilSettled(pendingResolvers, promise);
      expect(observedMaxActiveRequests).to.equal(2);
      expect(describeStacksStub).to.have.callCount(10);
      expect(provider.getAwsSdkV3Config).to.have.been.calledOnce;
      expect(
        describeStacksStub
          .getCalls()
          .every((call) => call.args[0].input.StackName === 'service-dev')
      ).to.equal(true);
    } finally {
      for (const resolve of pendingResolvers.splice(0)) resolve();
      CloudFormationClient.prototype.send.restore();
    }
  });

  it('compares compiled layers without passing SDK clients or limiters', async () => {
    const AwsCompileLayers = require('../../../../../../../lib/plugins/aws/package/compile/layers');
    const provider = {
      getAwsSdkV3Config: sinon.stub().throws(new Error('should not create a client')),
    };
    const serverless = {
      service: {
        package: {},
        getAllLayers: sinon.stub().returns(['layerOne', 'layerTwo']),
      },
      getProvider: sinon.stub().withArgs('aws').returns(provider),
    };
    const awsCompileLayers = new AwsCompileLayers(serverless, {});
    sinon.stub(awsCompileLayers, 'compileLayer').resolves();
    sinon.stub(awsCompileLayers, 'compareWithLastLayer').resolves();

    await awsCompileLayers.compileLayers();

    expect(awsCompileLayers.compareWithLastLayer).to.have.been.calledTwice;
    expect(awsCompileLayers.compareWithLastLayer.firstCall.args).to.deep.equal(['layerOne']);
    expect(awsCompileLayers.compareWithLastLayer.secondCall.args).to.deep.equal(['layerTwo']);
    expect(provider.getAwsSdkV3Config).to.not.have.been.called;
  });
});
