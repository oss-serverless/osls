import * as chai from 'chai';
import path from 'node:path';
import * as sinon from 'sinon';
import esmock from 'esmock';

const expect = chai.expect;

describe('#cleanupTempDir()', () => {
  let context;
  let dirExistsSync;
  let removeSync;

  beforeEach(async () => {
    dirExistsSync = sinon.stub();
    removeSync = sinon.stub();
    const cleanupTempDir = (
      await esmock('../../../../../../../lib/plugins/aws/common/lib/cleanup-temp-dir.ts', {
        '../../../../../../../lib/utils/fs/remove.ts': { removeSync },
      })
    ).default;
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
