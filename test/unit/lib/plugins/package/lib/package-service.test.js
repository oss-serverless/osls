'use strict';

const os = require('os');
const path = require('path');
const fsp = require('fs').promises;
const JSZip = require('jszip');
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

  describe('web apps', () => {
    const startFileName = '__osls_web_app_start.mjs';
    let serviceDir;
    let serviceZippedFiles;
    let apiZippedFiles;
    let otherZippedFiles;

    before(async () => {
      const { serviceConfig, servicePath } = await setupProgrammaticFixture('web-app', {
        configExt: {
          package: { patterns: ['!docs/**'] },
          functions: { fn: { handler: 'src/server.handler' } },
          webApps: {
            api: { package: { patterns: ['!tests/**', 'docs/api.md'] } },
            other: { entry: 'src/other.mjs' },
          },
        },
        files: [
          { to: 'src/other.mjs', contents: "import 'node:http';" },
          { to: 'tests/server.test.js', contents: '' },
          { to: 'docs/api.md', contents: '' },
          { to: 'docs/other.md', contents: '' },
        ],
      });
      serviceDir = servicePath;
      await runServerless({ cwd: serviceDir, command: 'package' });

      serviceZippedFiles = await listZipFiles(
        path.join(serviceDir, '.serverless', `${serviceConfig.service}.zip`)
      );
      apiZippedFiles = await listZipFiles(path.join(serviceDir, '.serverless', 'api.web-app.zip'));
      otherZippedFiles = await listZipFiles(
        path.join(serviceDir, '.serverless', 'other.web-app.zip')
      );
    });

    it('should package every web app on its own without `package.individually`', () => {
      expect(apiZippedFiles).to.include('src/server.js');
      expect(otherZippedFiles).to.include('src/other.mjs');
    });

    it('should add the start file to the root of web app packages only', () => {
      expect(apiZippedFiles).to.include(startFileName);
      expect(otherZippedFiles).to.include(startFileName);
      expect(serviceZippedFiles).to.not.include(startFileName);
    });

    it('should start the `entry` of the web app from the start file', async () => {
      const zip = await new JSZip().loadAsync(
        await fsp.readFile(path.join(serviceDir, '.serverless', 'other.web-app.zip'))
      );

      expect(await zip.file(startFileName).async('string')).to.include(
        'path.join(import.meta.dirname, "src/other.mjs")'
      );
    });

    it('should apply `webApps[].package.patterns` after `package.patterns`', () => {
      expect(apiZippedFiles).to.not.include('tests/server.test.js');
      expect(apiZippedFiles).to.include('docs/api.md');
      expect(apiZippedFiles).to.not.include('docs/other.md');
      expect(otherZippedFiles).to.include('tests/server.test.js');
      expect(otherZippedFiles).to.not.include('docs/api.md');
    });

    it('should create the same package again from unchanged files', async () => {
      const artifactPath = path.join(serviceDir, '.serverless', 'api.web-app.zip');
      const artifact = await fsp.readFile(artifactPath);
      const now = new Date();
      await fsp.utimes(path.join(serviceDir, 'src/server.js'), now, now);

      await runServerless({ cwd: serviceDir, command: 'package' });

      expect((await fsp.readFile(artifactPath)).equals(artifact)).to.equal(true);
    });

    it('should reject an `entry` that is not packaged', async () => {
      await expect(
        runServerless({
          fixture: 'web-app',
          command: 'package',
          configExt: { webApps: { api: { entry: 'src/missing.js' } } },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'WEB_APP_ENTRY_NOT_PACKAGED');
    });

    it('should reject a file named like the start file', async () => {
      const { servicePath } = await setupProgrammaticFixture('web-app', {
        files: [{ to: startFileName, contents: '' }],
      });

      await expect(
        runServerless({ cwd: servicePath, command: 'package' })
      ).to.eventually.be.rejected.and.have.property('code', 'WEB_APP_START_FILE_NAME_CONFLICT');
    });

    describe('with `webApps[].package.artifact`', () => {
      const setupArtifactFixture = async (entry) => {
        const zip = new JSZip();
        zip.file('dist/server.js', '');
        return setupProgrammaticFixture('web-app', {
          configExt: { webApps: { api: { entry, package: { artifact: 'prebuilt.zip' } } } },
          files: [
            { to: 'prebuilt.zip', contents: await zip.generateAsync({ type: 'nodebuffer' }) },
          ],
        });
      };

      it('should deploy the artifact as it is', async () => {
        const { servicePath } = await setupArtifactFixture('dist/server.js');

        const { serverless } = await runServerless({ cwd: servicePath, command: 'package' });

        expect(serverless.service.getWebApp('api').package.artifact).to.equal(
          path.join(servicePath, 'prebuilt.zip')
        );
        expect(await fsp.readdir(path.join(servicePath, '.serverless'))).to.not.include(
          'api.web-app.zip'
        );
      });

      it('should reject an `entry` that is not in the artifact', async () => {
        const { servicePath } = await setupArtifactFixture('src/server.js');

        await expect(
          runServerless({ cwd: servicePath, command: 'package' })
        ).to.eventually.be.rejected.and.have.property('code', 'WEB_APP_ENTRY_MISSING_IN_ARTIFACT');
      });

      it('should reject an artifact that does not exist', async () => {
        await expect(
          runServerless({
            fixture: 'web-app',
            command: 'package',
            configExt: { webApps: { api: { package: { artifact: 'missing.zip' } } } },
          })
        ).to.eventually.be.rejected.and.have.property('code', 'INVALID_PACKAGE_ARTIFACT_PATH');
      });
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
