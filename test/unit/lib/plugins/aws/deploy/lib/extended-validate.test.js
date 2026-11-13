'use strict';

const path = require('path');
const chai = require('chai');
const sinon = require('sinon');
const extendedValidate = require('../../../../../../../lib/plugins/aws/deploy/lib/extended-validate');

const expect = chai.expect;

describe('extendedValidate', () => {
  let awsDeploy;
  let fileExistsSyncStub;
  let readFileSyncStub;
  let stateFileMock;

  const createServiceConfig = () => ({
    service: 'first-service',
    provider: 'aws',
    functions: {
      first: {
        handler: 'sample.handler',
      },
    },
  });

  const createStateFile = () => ({
    service: createServiceConfig(),
    package: {
      individually: true,
      artifactDirectoryName: 'some/path',
      artifact: '',
    },
  });

  const createAwsDeploy = () => {
    const service = {
      service: 'first-service',
      provider: {},
      package: {
        individually: false,
      },
      functions: {
        first: {
          handler: 'sample.handler',
        },
      },
      getAllFunctions() {
        return Object.keys(this.functions);
      },
      getFunction(functionName) {
        return this.functions[functionName];
      },
      webApps: {},
      getAllWebApps() {
        return Object.keys(this.webApps);
      },
      getWebApp(webAppName) {
        return this.webApps[webAppName];
      },
    };

    return {
      ...extendedValidate,
      packagePath: 'package-path',
      provider: {
        naming: {
          getServiceStateFileName: () => 'service-state.json',
          getServiceArtifactName: () => 'service.zip',
          getFunctionArtifactName: (functionName) => `${functionName}.zip`,
          getWebAppArtifactName: (webAppName) => `${webAppName}.web-app.zip`,
        },
      },
      serverless: {
        serviceDir: 'service-dir',
        service,
        utils: {
          fileExistsSync: sinon.stub(),
          readFileSync: sinon.stub(),
        },
      },
    };
  };

  beforeEach(() => {
    awsDeploy = createAwsDeploy();
    stateFileMock = createStateFile();
    fileExistsSyncStub = awsDeploy.serverless.utils.fileExistsSync;
    readFileSyncStub = awsDeploy.serverless.utils.readFileSync;
  });

  describe('extendedValidate()', () => {
    it('should throw error if state file does not exist', async () => {
      fileExistsSyncStub.returns(false);

      await expect(awsDeploy.extendedValidate()).to.eventually.be.rejectedWith(Error);
    });

    it('should throw error if packaged individually but functions packages do not exist', async () => {
      fileExistsSyncStub.onCall(0).returns(true);
      fileExistsSyncStub.onCall(1).returns(false);
      readFileSyncStub.returns(stateFileMock);

      awsDeploy.serverless.service.package.individually = true;

      await expect(awsDeploy.extendedValidate()).to.eventually.be.rejectedWith(Error);
    });

    it('should throw error if service package does not exist', async () => {
      fileExistsSyncStub.onCall(0).returns(true);
      fileExistsSyncStub.onCall(1).returns(false);
      readFileSyncStub.returns(stateFileMock);

      await expect(awsDeploy.extendedValidate()).to.eventually.be.rejectedWith(Error);
    });

    it('should not throw error if service has no functions and no service package', async () => {
      stateFileMock.service.functions = {};
      fileExistsSyncStub.returns(true);
      readFileSyncStub.returns(stateFileMock);

      await awsDeploy.extendedValidate();
      expect(fileExistsSyncStub.calledOnce).to.equal(true);
      expect(readFileSyncStub.calledOnce).to.equal(true);
    });

    it('should not throw error if service has no functions and no function packages', async () => {
      stateFileMock.service.functions = {};
      awsDeploy.serverless.service.package.individually = true;
      fileExistsSyncStub.returns(true);
      readFileSyncStub.returns(stateFileMock);

      await awsDeploy.extendedValidate();
      expect(fileExistsSyncStub.calledOnce).to.equal(true);
      expect(readFileSyncStub.calledOnce).to.equal(true);
    });

    it('should not throw error if individual packaging defined on a function level', async () => {
      awsDeploy.serverless.service.package.individually = false;
      stateFileMock.service.functions = {
        first: {
          package: {
            individually: true,
          },
        },
      };
      fileExistsSyncStub.returns(true);
      readFileSyncStub.returns(stateFileMock);
      return awsDeploy.extendedValidate();
    });

    it('should use function package level artifact when provided', async () => {
      stateFileMock.service.functions = {
        first: {
          package: {
            artifact: 'artifact.zip',
          },
        },
      };
      awsDeploy.serverless.service.package.individually = true;
      fileExistsSyncStub.returns(true);
      readFileSyncStub.returns(stateFileMock);

      await awsDeploy.extendedValidate();
      expect(fileExistsSyncStub.calledTwice).to.equal(true);
      expect(readFileSyncStub.calledOnce).to.equal(true);
      expect(fileExistsSyncStub).to.have.been.calledWithExactly('artifact.zip');
    });

    it('should throw error if specified package artifact does not exist', async () => {
      fileExistsSyncStub.onCall(0).returns(true);
      fileExistsSyncStub.onCall(1).returns(false);
      readFileSyncStub.returns(stateFileMock);
      awsDeploy.serverless.service.package.artifact = 'some/file.zip';
      await expect(awsDeploy.extendedValidate()).to.eventually.be.rejectedWith(Error);
    });

    it('should not throw error if specified package artifact exists', async () => {
      fileExistsSyncStub.onCall(0).returns(true);
      fileExistsSyncStub.onCall(1).returns(true);
      readFileSyncStub.returns(stateFileMock);
      awsDeploy.serverless.service.package.artifact = 'some/file.zip';
      await awsDeploy.extendedValidate();
    });

    it('should throw error if the package of a web app does not exist', async () => {
      stateFileMock.service.functions = {};
      stateFileMock.service.webApps = { api: { entry: 'server.js' } };
      fileExistsSyncStub.onCall(0).returns(true);
      fileExistsSyncStub.onCall(1).returns(false);
      readFileSyncStub.returns(stateFileMock);

      await expect(awsDeploy.extendedValidate()).to.eventually.be.rejected.and.have.property(
        'code',
        'MISSING_ARTIFACT_FILE'
      );
      expect(fileExistsSyncStub.secondCall.args[0]).to.equal(
        path.join('package-path', 'api.web-app.zip')
      );
    });

    it('should use the package artifact of a web app when provided', async () => {
      stateFileMock.service.functions = {};
      stateFileMock.service.webApps = {
        api: { entry: 'server.js', package: { artifact: 'prebuilt.zip' } },
      };
      fileExistsSyncStub.returns(true);
      readFileSyncStub.returns(stateFileMock);

      await awsDeploy.extendedValidate();
      expect(fileExistsSyncStub).to.have.been.calledWithExactly('prebuilt.zip');
    });

    it('restores persisted service state without mutating the service prototype', async () => {
      const restoredService = createServiceConfig();
      restoredService.functions = {};
      Object.defineProperty(restoredService, '__proto__', {
        value: { polluted: true },
        writable: true,
        enumerable: true,
        configurable: true,
      });

      const originalPrototype = Object.getPrototypeOf(awsDeploy.serverless.service);

      fileExistsSyncStub.returns(true);
      readFileSyncStub.returns({
        service: restoredService,
        package: {
          individually: true,
          artifactDirectoryName: 'some/path',
          artifact: '',
        },
      });

      await awsDeploy.extendedValidate();

      expect(Object.getPrototypeOf(awsDeploy.serverless.service)).to.equal(originalPrototype);
      expect(
        Object.getOwnPropertyDescriptor(awsDeploy.serverless.service, '__proto__').value
      ).to.deep.equal({ polluted: true });
    });
  });
});
