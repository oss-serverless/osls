'use strict';

const os = require('os');
const path = require('path');
const fsp = require('fs').promises;
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');
const { listFileProperties, listZipFiles } = require('../../../../../utils/fs');
const runServerless = require('../../../../../utils/run-serverless');
const setupProgrammaticFixture = require('../../../../../utils/setup-programmatic-fixture');
const packageService = require('../../../../../../lib/plugins/package/lib/package-service');

// Configure chai
const { expect } = require('chai');

describe('test/unit/lib/plugins/package/lib/packageService.test.js', () => {
  const awsSdkV3StubMap = {
    S3: {
      headBucket: {},
    },
    CloudFormation: {
      describeStacks: {
        Stacks: [
          {
            Outputs: [
              { OutputKey: 'LayerLambdaLayerHash', OutputValue: '123' },
              { OutputKey: 'LayerLambdaLayerS3Key', OutputValue: 'path/to/layer.zip' },
            ],
          },
        ],
      },
    },
  };

  describe('#getRuntime()', () => {
    it('should default to "nodejs24.x" when no runtime is configured', () => {
      expect(
        packageService.getRuntime.call({ serverless: { service: { provider: {} } } }, undefined)
      ).to.equal('nodejs24.x');
    });
  });

  describe('#resolveFilePathsFromPatterns()', () => {
    it('preserves file names named like __proto__', async () => {
      const packageServiceWithStubbedGlob = proxyquire(
        '../../../../../../lib/plugins/package/lib/package-service',
        {
          '../../../utils/glob': sinon.stub().resolves(['__proto__', 'keep.js']),
        }
      );

      const filePaths = await packageServiceWithStubbedGlob.resolveFilePathsFromPatterns.call(
        { serverless: { serviceDir: process.cwd() } },
        {
          include: [],
          exclude: [],
        }
      );

      expect(filePaths).to.deep.equal(['__proto__', 'keep.js']);
    });
  });

  describe('service wide', () => {
    let serverless;
    let serviceZippedFiles;
    let fnIndividualZippedFiles;
    let fnFileProperties;
    let fnLayerFiles;

    before(async () => {
      const {
        fixtureData: {
          servicePath: serviceDir,
          serviceConfig: { service: serviceName },
        },
        serverless: serverlessInstance,
      } = await runServerless({
        fixture: 'packaging',
        command: 'package',
        awsSdkV3StubMap,
        configExt: {
          package: {
            patterns: [
              '!dir1/**',
              'dir1/subdir3/**',
              'dir1/subdir2/**',
              '!dir1/subdir2/subsubdir1',
            ],
          },
          functions: {
            fnIndividual: {
              package: { patterns: ['dir1/subdir4/**', '!dir3/**'] },
            },
          },
        },
      });
      serverless = serverlessInstance;

      serviceZippedFiles = await listZipFiles(
        path.join(serviceDir, '.serverless', `${serviceName}.zip`)
      );

      fnIndividualZippedFiles = await listZipFiles(
        path.join(serviceDir, '.serverless', 'fnIndividual.zip')
      );

      fnLayerFiles = await listZipFiles(path.join(serviceDir, '.serverless', 'layer.zip'));

      fnFileProperties = await listFileProperties(
        path.join(serviceDir, '.serverless', 'fnIndividual.zip')
      );
    });

    it('should exclude defaults', () => {
      expect(serviceZippedFiles).to.not.include('.gitignore');
    });

    it('should exclude service config', () => {
      expect(serviceZippedFiles).to.not.include('serverless.yml');
    });

    it('should exclude default plugins localPath', () => {
      expect(serviceZippedFiles).to.not.include('.serverless-plugins/index.js');
    });

    it('should support exclusion via `package.patterns`', () => {
      expect(serviceZippedFiles, fnIndividualZippedFiles).to.not.include('dir1/subdir1/index.js');
      expect(serviceZippedFiles, fnIndividualZippedFiles).to.include('dir1/subdir3/index.js');
    });

    it('should support inclusion via `package.patterns`', () => {
      expect(serviceZippedFiles, fnIndividualZippedFiles).to.include('dir1/subdir2/index.js');
      expect(serviceZippedFiles, fnIndividualZippedFiles).to.not.include(
        'dir1/subdir2/subsubdir1/index.js'
      );
      expect(serviceZippedFiles, fnIndividualZippedFiles).to.include(
        'dir1/subdir2/subsubdir2/index.js'
      );
    });

    it('should support `functions[].package.individually`', () => {
      expect(serverless.service.getFunction('fnIndividual').package.artifact).to.include(
        'fnIndividual.zip'
      );
    });

    it('should support function-level exclusion via `functions[].package.patterns`', () => {
      expect(fnIndividualZippedFiles).to.not.include('dir3/index.js');
    });

    it('should support function-level inclusion via `functions[].package.patterns`', () => {
      expect(fnIndividualZippedFiles).to.include('dir1/subdir4/index.js');
    });

    (process.platform === 'win32' ? it : it.skip)(
      'should force packaged files to be executable on windows',
      () => {
        expect(fnFileProperties['index.js'].unixPermissions).to.equal(Math.pow(2, 15) + 0o755);
      }
    );

    it('should package layer', () => {
      expect(fnLayerFiles).to.include('layer-module-1.js');
      expect(fnLayerFiles).to.include('layer-module-2.js');
      expect(fnLayerFiles).to.not.include('layer/layer-module-1.js');
      expect(fnLayerFiles).to.not.include('layer/layer-module-2.js');
    });
  });

  describe('with useDotenv', () => {
    it('should exclude .env files', async () => {
      const {
        fixtureData: {
          servicePath: serviceDir,
          serviceConfig: { service: serviceName },
        },
      } = await runServerless({
        fixture: 'packaging',
        command: 'package',
        awsSdkV3StubMap,
        configExt: {
          useDotenv: true,
        },
      });

      const zippedFiles = await listZipFiles(
        path.join(serviceDir, '.serverless', `${serviceName}.zip`)
      );

      expect(zippedFiles).to.not.include('.env');
      expect(zippedFiles).to.not.include('.env.stage');
    });
  });

  describe('#packageLayer()', () => {
    it('rejects layer paths with control characters', async () => {
      const resolveFilePathsLayerStub = sinon.stub().resolves(['index.js']);

      let error;
      try {
        await packageService.packageLayer.call(
          {
            serverless: {
              serviceDir: process.cwd(),
              service: {
                getLayer: () => ({ path: 'layer\nRUN whoami' }),
              },
            },
            resolveFilePathsLayer: resolveFilePathsLayerStub,
            zipFiles: sinon.stub().resolves('layer.zip'),
          },
          'layer'
        );
      } catch (caughtError) {
        error = caughtError;
      }

      expect(error).to.have.property('code', 'INVALID_LAYER_PATH');
      expect(error.message).to.include('layers.layer.path');
      expect(error.message).to.not.include('RUN whoami');
      expect(resolveFilePathsLayerStub).to.not.have.been.called;
    });

    it('resolves layer package paths against serviceDir instead of cwd', async () => {
      const originalCwd = process.cwd();
      const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'sls-cwd-'));
      const serviceDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sls-service-'));

      try {
        process.chdir(cwd);

        const layerObject = { path: 'layer' };
        const zipFilesStub = sinon.stub().resolves('layer.zip');

        await packageService.packageLayer.call(
          {
            serverless: {
              serviceDir,
              service: {
                getLayer: () => layerObject,
              },
            },
            resolveFilePathsLayer: sinon.stub().resolves(['index.js']),
            zipFiles: zipFilesStub,
          },
          'layer'
        );

        expect(zipFilesStub).to.have.been.calledWithExactly(
          [path.join(serviceDir, 'layer', 'index.js')],
          'layer.zip',
          path.join(serviceDir, 'layer')
        );
      } finally {
        process.chdir(originalCwd);
        await fsp.rm(cwd, { recursive: true, force: true });
        await fsp.rm(serviceDir, { recursive: true, force: true });
      }
    });
  });

  describe('individually', () => {
    let fnIndividualZippedFiles;
    let serverless;

    before(async () => {
      const {
        fixtureData: { servicePath: serviceDir },
        serverless: serverlessInstance,
      } = await runServerless({
        fixture: 'packaging',
        command: 'package',
        awsSdkV3StubMap,
        configExt: {
          package: {
            individually: true,
            patterns: [
              '!dir1/**',
              'dir1/subdir3/**',
              'dir1/subdir2/**',
              '!dir1/subdir2/subsubdir1',
            ],
          },
          functions: {
            fnIndividual: {
              package: { patterns: ['dir1/subdir4/**', '!dir3/**'] },
            },
          },
          plugins: {
            localPath: './custom-plugins',
            modules: ['index'],
          },
        },
      });
      serverless = serverlessInstance;

      fnIndividualZippedFiles = await listZipFiles(
        path.join(serviceDir, '.serverless', 'fnIndividual.zip')
      );
    });

    it('should exclude custom plugins localPath', () => {
      expect(fnIndividualZippedFiles).to.not.include('.custom-plugins/index.js');
    });

    it('should support `package.individually`', () => {
      expect(serverless.service.getFunction('fnIndividual').package.artifact).to.include(
        'fnIndividual.zip'
      );
      expect(serverless.service.getFunction('fnService').package.artifact).to.include(
        'fnService.zip'
      );
    });

    it('should support exclusion via `package.patterns`', () => {
      expect(fnIndividualZippedFiles).to.not.include('dir1/subdir1/index.js');
      expect(fnIndividualZippedFiles).to.not.include('dir1/subdir1/index.js');
      expect(fnIndividualZippedFiles).to.include('dir1/subdir3/index.js');
    });

    it('should support inclusion via `package.patterns`', () => {
      expect(fnIndividualZippedFiles).to.include('dir1/subdir2/index.js');
      expect(fnIndividualZippedFiles).to.not.include('dir1/subdir2/subsubdir1/index.js');
      expect(fnIndividualZippedFiles).to.include('dir1/subdir2/subsubdir2/index.js');
      expect(fnIndividualZippedFiles).to.include('dir1/subdir4/index.js');
    });
  });

  describe('pre-prepared artifact', () => {
    let serverless;
    before(async () => {
      const { serverless: serverlessInstance } = await runServerless({
        fixture: 'packaging',
        command: 'package',
        awsSdkV3StubMap,
        configExt: {
          package: {
            artifact: 'artifact.zip',
            patterns: ['!dir1', 'dir1/subdir3/**', 'dir1/subdir2/**', '!dir1/subdir2/subsubdir1'],
          },
          functions: {
            fnIndividual: {
              handler: 'index.handler',
              package: { individually: true, patterns: ['dir1/subdir3/**', '!dir1/subdir2'] },
            },
            fnArtifact: {
              handler: 'index.handler',
              package: { artifact: 'artifact-function.zip' },
            },
          },
        },
      });
      serverless = serverlessInstance;
    });
    it('should support `package.artifact`', () => {
      expect(serverless.service.package.artifact).is.equal('artifact.zip');
    });

    it('should ignore `package.artifact` if `functions[].package.individually', () => {
      expect(serverless.service.getFunction('fnIndividual').package.artifact).is.not.equal(
        serverless.service.package.artifact
      );
    });

    it('should support `functions[].package.artifact`', () => {
      expect(serverless.service.getFunction('fnArtifact').package.artifact).is.equal(
        'artifact-function.zip'
      );
    });
  });

  describe('pre-prepared artifact with absolute artifact path', () => {
    describe('while deploying whole service', () => {
      const s3UploadStub = sinon.stub();
      const innerAwsSdkV3StubMap = {
        Lambda: {
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
            },
          },
        },
        S3: {
          upload: s3UploadStub,
          listObjectsV2: { Contents: [] },
          headBucket: {},
        },
        CloudFormation: {
          describeStacks: { Stacks: [{}] },
          describeStackResource: { StackResourceDetail: { PhysicalResourceId: 'resource-id' } },
        },
        STS: {
          getCallerIdentity: {
            ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
            UserId: 'XXXXXXXXXXXXXXXXXXXXX',
            Account: '999999999999',
            Arn: 'arn:aws:iam::999999999999:user/test',
          },
        },
      };

      beforeEach(() => {
        s3UploadStub.resetHistory();
      });

      it('for function', async () => {
        const { servicePath: serviceDir, updateConfig } =
          await setupProgrammaticFixture('package-artifact');
        const absoluteArtifactFilePath = path.join(serviceDir, 'absolute-artifact.zip');

        await updateConfig({
          functions: {
            other: {
              package: {
                artifact: absoluteArtifactFilePath,
              },
            },
          },
        });

        await runServerless({
          cwd: serviceDir,
          command: 'deploy',
          lastLifecycleHookName: 'aws:deploy:deploy:uploadArtifacts',
          awsSdkV3StubMap: innerAwsSdkV3StubMap,
        });

        const callArgs = s3UploadStub.args.find((item) =>
          item[0].Key.endsWith('absolute-artifact.zip')
        );
        expect(callArgs[0].Body.path).to.equal(absoluteArtifactFilePath);
      });

      it('service-wide', async () => {
        const { servicePath: serviceDir, updateConfig } =
          await setupProgrammaticFixture('package-artifact');
        const absoluteArtifactFilePath = path.join(serviceDir, 'absolute-artifact.zip');

        await updateConfig({
          package: {
            artifact: absoluteArtifactFilePath,
          },
        });
        await runServerless({
          cwd: serviceDir,
          command: 'deploy',
          lastLifecycleHookName: 'aws:deploy:deploy:uploadArtifacts',
          awsSdkV3StubMap: innerAwsSdkV3StubMap,
        });

        const callArgs = s3UploadStub.args.find((item) =>
          item[0].Key.endsWith('absolute-artifact.zip')
        );
        expect(callArgs[0].Body.path).to.equal(absoluteArtifactFilePath);
      });
    });

    describe('while deploying specific function', () => {
      const updateFunctionCodeStub = sinon.stub();
      const innerAwsSdkV3StubMap = {
        Lambda: {
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              State: 'Active',
              LastUpdateStatus: 'Successful',
            },
          },
          updateFunctionCode: updateFunctionCodeStub,
          updateFunctionConfiguration: {},
        },
      };

      beforeEach(() => {
        updateFunctionCodeStub.resetHistory();
      });

      it('for function', async () => {
        const { servicePath: serviceDir, updateConfig } =
          await setupProgrammaticFixture('package-artifact');
        const absoluteArtifactFilePath = path.join(serviceDir, 'absolute-artifact.zip');
        const zipContent = await fsp.readFile(absoluteArtifactFilePath);

        await updateConfig({
          functions: {
            other: {
              package: {
                artifact: absoluteArtifactFilePath,
              },
            },
          },
        });
        await runServerless({
          cwd: serviceDir,
          command: 'deploy function',
          options: { function: 'other' },
          awsSdkV3StubMap: innerAwsSdkV3StubMap,
        });
        expect(updateFunctionCodeStub).to.have.been.calledOnce;
        expect(updateFunctionCodeStub.args[0][0].ZipFile).to.deep.equal(Buffer.from(zipContent));
      });

      it('service-wide', async () => {
        const { servicePath: serviceDir, updateConfig } =
          await setupProgrammaticFixture('package-artifact');
        const absoluteArtifactFilePath = path.join(serviceDir, 'absolute-artifact.zip');
        const zipContent = await fsp.readFile(absoluteArtifactFilePath);

        await updateConfig({
          package: {
            artifact: absoluteArtifactFilePath,
          },
        });
        await runServerless({
          cwd: serviceDir,
          command: 'deploy function',
          options: { function: 'foo' },
          awsSdkV3StubMap: innerAwsSdkV3StubMap,
        });
        expect(updateFunctionCodeStub).to.have.been.calledOnce;
        expect(updateFunctionCodeStub.args[0][0].ZipFile).to.deep.equal(Buffer.from(zipContent));
      });
    });
  });
});
