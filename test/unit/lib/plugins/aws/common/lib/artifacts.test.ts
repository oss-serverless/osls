'use strict';

const expect = require('chai').expect;
const path = require('path');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

describe('#moveArtifactsToPackage()', () => {
  let artifacts;
  let removeSync;

  const serviceDir = 'service';
  const serverlessTmpDirPath = path.join(serviceDir, '.serverless');
  const targetPath = path.join(serviceDir, 'target');

  const createContext = ({
    options = {},
    servicePackage = {},
    serviceDirValue = serviceDir,
  } = {}) => {
    const utils = {
      dirExistsSync: sinon.stub(),
      writeFileDir: sinon.stub(),
      copyDirContentsSync: sinon.stub(),
    };

    return {
      options,
      serverless: {
        serviceDir: serviceDirValue,
        service: { package: servicePackage },
        utils,
      },
      ...artifacts,
    };
  };

  beforeEach(() => {
    removeSync = sinon.stub();
    artifacts = proxyquire
      .noCallThru()
      .load('../../../../../../../lib/plugins/aws/common/lib/artifacts', {
        '../../../../utils/fs/remove': { removeSync },
      });
  });

  it('should resolve if servicePath is not present', async () => {
    const context = createContext({ serviceDirValue: undefined });

    await context.moveArtifactsToPackage();

    expect(context.serverless.utils.dirExistsSync).to.not.have.been.called;
    expect(removeSync).to.not.have.been.called;
  });

  it('should resolve if no package is set', async () => {
    const context = createContext();

    await context.moveArtifactsToPackage();

    expect(context.serverless.utils.dirExistsSync).to.not.have.been.called;
    expect(removeSync).to.not.have.been.called;
  });

  it('should use package option as target', async () => {
    const context = createContext({ options: { package: targetPath } });
    context.serverless.utils.dirExistsSync.withArgs(serverlessTmpDirPath).returns(true);
    context.serverless.utils.dirExistsSync.withArgs(targetPath).returns(false);

    await context.moveArtifactsToPackage();

    expect(context.serverless.utils.writeFileDir).to.have.been.calledOnceWithExactly(targetPath);
    expect(context.serverless.utils.copyDirContentsSync).to.have.been.calledOnceWithExactly(
      serverlessTmpDirPath,
      targetPath
    );
    expect(removeSync).to.have.been.calledOnceWithExactly(serverlessTmpDirPath);
    expect(
      context.serverless.utils.writeFileDir.calledBefore(
        context.serverless.utils.copyDirContentsSync
      )
    ).to.equal(true);
    expect(context.serverless.utils.copyDirContentsSync.calledBefore(removeSync)).to.equal(true);
  });

  it('should use service package path as target', async () => {
    const context = createContext({ servicePackage: { path: targetPath } });
    context.serverless.utils.dirExistsSync.withArgs(serverlessTmpDirPath).returns(true);
    context.serverless.utils.dirExistsSync.withArgs(targetPath).returns(false);

    await context.moveArtifactsToPackage();

    expect(context.serverless.utils.writeFileDir).to.have.been.calledOnceWithExactly(targetPath);
    expect(context.serverless.utils.copyDirContentsSync).to.have.been.calledOnceWithExactly(
      serverlessTmpDirPath,
      targetPath
    );
    expect(removeSync).to.have.been.calledOnceWithExactly(serverlessTmpDirPath);
    expect(
      context.serverless.utils.writeFileDir.calledBefore(
        context.serverless.utils.copyDirContentsSync
      )
    ).to.equal(true);
    expect(context.serverless.utils.copyDirContentsSync.calledBefore(removeSync)).to.equal(true);
  });

  it('should not fail with non existing temp dir', async () => {
    const context = createContext({ options: { package: targetPath } });
    context.serverless.utils.dirExistsSync.withArgs(serverlessTmpDirPath).returns(false);

    await context.moveArtifactsToPackage();

    expect(context.serverless.utils.writeFileDir).to.not.have.been.called;
    expect(context.serverless.utils.copyDirContentsSync).to.not.have.been.called;
    expect(removeSync).to.not.have.been.called;
  });

  it('should not fail with existing package dir', async () => {
    const context = createContext({ servicePackage: { path: targetPath } });
    context.serverless.utils.dirExistsSync.withArgs(serverlessTmpDirPath).returns(true);
    context.serverless.utils.dirExistsSync.withArgs(targetPath).returns(true);

    await context.moveArtifactsToPackage();

    expect(removeSync).to.have.been.calledTwice;
    expect(removeSync.firstCall.args).to.deep.equal([targetPath]);
    expect(removeSync.secondCall.args).to.deep.equal([serverlessTmpDirPath]);
    expect(context.serverless.utils.writeFileDir).to.have.been.calledOnceWithExactly(targetPath);
    expect(context.serverless.utils.copyDirContentsSync).to.have.been.calledOnceWithExactly(
      serverlessTmpDirPath,
      targetPath
    );
    expect(
      removeSync.firstCall.calledBefore(context.serverless.utils.writeFileDir.firstCall)
    ).to.equal(true);
    expect(
      context.serverless.utils.writeFileDir.firstCall.calledBefore(
        context.serverless.utils.copyDirContentsSync.firstCall
      )
    ).to.equal(true);
    expect(
      context.serverless.utils.copyDirContentsSync.firstCall.calledBefore(removeSync.secondCall)
    ).to.equal(true);
  });
});

describe('#moveArtifactsToTemp()', () => {
  let artifacts;
  let removeSync;

  const serviceDir = 'service';
  const serverlessTmpDirPath = path.join(serviceDir, '.serverless');
  const sourcePath = path.join(serviceDir, 'target');

  const createContext = ({
    options = {},
    servicePackage = {},
    serviceDirValue = serviceDir,
  } = {}) => {
    const utils = {
      dirExistsSync: sinon.stub(),
      writeFileDir: sinon.stub(),
      copyDirContentsSync: sinon.stub(),
    };

    return {
      options,
      serverless: {
        serviceDir: serviceDirValue,
        service: { package: servicePackage },
        utils,
      },
      ...artifacts,
    };
  };

  beforeEach(() => {
    removeSync = sinon.stub();
    artifacts = proxyquire
      .noCallThru()
      .load('../../../../../../../lib/plugins/aws/common/lib/artifacts', {
        '../../../../utils/fs/remove': { removeSync },
      });
  });

  it('should resolve if servicePath is not present', async () => {
    const context = createContext({ serviceDirValue: undefined });

    await context.moveArtifactsToTemp();

    expect(context.serverless.utils.dirExistsSync).to.not.have.been.called;
    expect(removeSync).to.not.have.been.called;
  });

  it('should resolve if no package is set', async () => {
    const context = createContext();

    await context.moveArtifactsToTemp();

    expect(context.serverless.utils.dirExistsSync).to.not.have.been.called;
    expect(removeSync).to.not.have.been.called;
  });

  it('should use package option as source path', async () => {
    const context = createContext({ options: { package: sourcePath } });
    context.serverless.utils.dirExistsSync.withArgs(sourcePath).returns(true);
    context.serverless.utils.dirExistsSync.withArgs(serverlessTmpDirPath).returns(false);

    await context.moveArtifactsToTemp();

    expect(context.serverless.utils.writeFileDir).to.have.been.calledOnceWithExactly(
      serverlessTmpDirPath
    );
    expect(context.serverless.utils.copyDirContentsSync).to.have.been.calledOnceWithExactly(
      sourcePath,
      serverlessTmpDirPath
    );
    expect(removeSync).to.not.have.been.called;
    expect(
      context.serverless.utils.writeFileDir.calledBefore(
        context.serverless.utils.copyDirContentsSync
      )
    ).to.equal(true);
  });

  it('should use service package path as source path', async () => {
    const context = createContext({ servicePackage: { path: sourcePath } });
    context.serverless.utils.dirExistsSync.withArgs(sourcePath).returns(true);
    context.serverless.utils.dirExistsSync.withArgs(serverlessTmpDirPath).returns(false);

    await context.moveArtifactsToTemp();

    expect(context.serverless.utils.writeFileDir).to.have.been.calledOnceWithExactly(
      serverlessTmpDirPath
    );
    expect(context.serverless.utils.copyDirContentsSync).to.have.been.calledOnceWithExactly(
      sourcePath,
      serverlessTmpDirPath
    );
    expect(removeSync).to.not.have.been.called;
    expect(
      context.serverless.utils.writeFileDir.calledBefore(
        context.serverless.utils.copyDirContentsSync
      )
    ).to.equal(true);
  });

  it('should not fail with non existing source path', async () => {
    const context = createContext({ options: { package: sourcePath } });
    context.serverless.utils.dirExistsSync.withArgs(sourcePath).returns(false);

    await context.moveArtifactsToTemp();

    expect(context.serverless.utils.writeFileDir).to.not.have.been.called;
    expect(context.serverless.utils.copyDirContentsSync).to.not.have.been.called;
    expect(removeSync).to.not.have.been.called;
  });

  it('should not fail with existing temp dir', async () => {
    const context = createContext({ servicePackage: { path: sourcePath } });
    context.serverless.utils.dirExistsSync.withArgs(sourcePath).returns(true);
    context.serverless.utils.dirExistsSync.withArgs(serverlessTmpDirPath).returns(true);

    await context.moveArtifactsToTemp();

    expect(removeSync).to.have.been.calledOnceWithExactly(serverlessTmpDirPath);
    expect(context.serverless.utils.writeFileDir).to.have.been.calledOnceWithExactly(
      serverlessTmpDirPath
    );
    expect(context.serverless.utils.copyDirContentsSync).to.have.been.calledOnceWithExactly(
      sourcePath,
      serverlessTmpDirPath
    );
    expect(removeSync.calledBefore(context.serverless.utils.writeFileDir)).to.equal(true);
    expect(
      context.serverless.utils.writeFileDir.calledBefore(
        context.serverless.utils.copyDirContentsSync
      )
    ).to.equal(true);
  });
});
