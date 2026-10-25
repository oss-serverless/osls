'use strict';

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
    };

    return {
      ...extendedValidate,
      packagePath: 'package-path',
      provider: {
        naming: {
          getServiceStateFileName: () => 'service-state.json',
          getServiceArtifactName: () => 'service.zip',
          getFunctionArtifactName: (functionName) => `${functionName}.zip`,
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
