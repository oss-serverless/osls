'use strict';

const chai = require('chai');
const path = require('path');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const expect = chai.expect;

describe('#cleanupTempDir()', () => {
  let context;
  let dirExistsSync;
  let removeSync;

  beforeEach(() => {
    dirExistsSync = sinon.stub();
    removeSync = sinon.stub();
    const cleanupTempDir = proxyquire
      .noCallThru()
      .load('../../../../../../../lib/plugins/aws/common/lib/cleanup-temp-dir', {
        '../../../../utils/fs/remove': { removeSync },
      });
    context = {
      serverless: {
        serviceDir: '/service',
        utils: { dirExistsSync },
      },
      ...cleanupTempDir,
    };
  });

  it('should remove .serverless in the service directory', async () => {
    const serverlessTmpDirPath = path.join(context.serverless.serviceDir, '.serverless');
    dirExistsSync.withArgs(serverlessTmpDirPath).returns(true);

    await context.cleanupTempDir();

    expect(dirExistsSync).to.have.been.calledOnceWithExactly(serverlessTmpDirPath);
    expect(removeSync).to.have.been.calledOnceWithExactly(serverlessTmpDirPath);
  });

  it('should resolve if servicePath is not present', async () => {
    delete context.serverless.serviceDir;

    await expect(context.cleanupTempDir()).to.eventually.be.fulfilled;

    expect(dirExistsSync).to.not.have.been.called;
    expect(removeSync).to.not.have.been.called;
  });

  it('should resolve if the .serverless directory is not present', async () => {
    dirExistsSync.returns(false);

    await expect(context.cleanupTempDir()).to.eventually.be.fulfilled;

    expect(removeSync).to.not.have.been.called;
  });
});
