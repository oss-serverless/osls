'use strict';

const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();
const requireUncached = require('../../../utils/require-uncached');
const sinon = require('sinon');

const { expect } = require('chai');

describe('test/unit/lib/utils/resolve-process-tmp-dir.test.js', () => {
  const randomHex = 'abcd'.repeat(6);

  afterEach(() => {
    sinon.restore();
  });

  it('creates and reuses a process temp directory', async () => {
    const resolveProcessTmpDir = requireUncached(() =>
      require('../../../../lib/utils/resolve-process-tmp-dir')
    );

    const firstTmpDir = await resolveProcessTmpDir();
    const secondTmpDir = await resolveProcessTmpDir();

    expect(secondTmpDir).to.equal(firstTmpDir);
    expect(path.basename(firstTmpDir)).to.match(/^node-process-[0-9a-f]{24}-/);
    expect((await fsp.stat(firstTmpDir)).isDirectory()).to.equal(true);

    await fsp.rm(firstTmpDir, { recursive: true, force: true });
  });

  it('retries after a failed temp directory creation', async () => {
    const error = new Error('temporary failure');
    const tmpDir = path.join(os.tmpdir(), `node-process-${randomHex}-retry`);

    const fsStub = {
      promises: {
        mkdtemp: sinon.stub(),
      },
      rmSync: sinon.stub(),
    };
    fsStub.promises.mkdtemp.onFirstCall().rejects(error);
    fsStub.promises.mkdtemp.onSecondCall().resolves(tmpDir);
    sinon.stub(process, 'once').returns(process);

    const resolveProcessTmpDir = proxyquire('../../../../lib/utils/resolve-process-tmp-dir', {
      fs: fsStub,
      crypto: {
        randomBytes: () => Buffer.from(randomHex, 'hex'),
      },
    });

    await expect(resolveProcessTmpDir()).to.be.rejectedWith(error);
    expect(await resolveProcessTmpDir()).to.equal(tmpDir);
    expect(fsStub.promises.mkdtemp).to.have.been.calledTwice;
  });

  it('memoizes the resolved temp dir for subsequent calls', async () => {
    const tmpDir = path.join(os.tmpdir(), `node-process-${randomHex}-memoized`);
    const fsStub = {
      promises: { mkdtemp: sinon.stub().resolves(tmpDir) },
      rmSync: sinon.stub(),
    };
    sinon.stub(process, 'once').returns(process);

    const resolveProcessTmpDir = proxyquire('../../../../lib/utils/resolve-process-tmp-dir', {
      fs: fsStub,
      crypto: { randomBytes: () => Buffer.from(randomHex, 'hex') },
    });

    expect(await resolveProcessTmpDir()).to.equal(tmpDir);
    expect(await resolveProcessTmpDir()).to.equal(tmpDir);
    expect(fsStub.promises.mkdtemp).to.have.been.calledOnce;
  });

  it('registers an exit cleanup for the resolved temp dir', async () => {
    const tmpDir = path.join(os.tmpdir(), `node-process-${randomHex}-cleanup`);
    const fsStub = {
      promises: { mkdtemp: sinon.stub().resolves(tmpDir) },
      rmSync: sinon.stub(),
    };
    const onceStub = sinon.stub(process, 'once').returns(process);

    const resolveProcessTmpDir = proxyquire('../../../../lib/utils/resolve-process-tmp-dir', {
      fs: fsStub,
      crypto: { randomBytes: () => Buffer.from(randomHex, 'hex') },
    });

    await resolveProcessTmpDir();

    expect(onceStub).to.have.been.calledOnceWithExactly('exit', sinon.match.func);
    onceStub.firstCall.args[1]();
    expect(fsStub.rmSync).to.have.been.calledOnceWithExactly(tmpDir, {
      recursive: true,
      force: true,
    });
  });

  it('swallows rmSync errors during exit cleanup', async () => {
    const tmpDir = path.join(os.tmpdir(), `node-process-${randomHex}-cleanup-error`);
    const fsStub = {
      promises: { mkdtemp: sinon.stub().resolves(tmpDir) },
      rmSync: sinon.stub().throws(new Error('cleanup failed')),
    };
    const onceStub = sinon.stub(process, 'once').returns(process);

    const resolveProcessTmpDir = proxyquire('../../../../lib/utils/resolve-process-tmp-dir', {
      fs: fsStub,
      crypto: { randomBytes: () => Buffer.from(randomHex, 'hex') },
    });

    await resolveProcessTmpDir();

    expect(() => onceStub.firstCall.args[1]()).to.not.throw();
    expect(fsStub.rmSync).to.have.been.calledOnceWithExactly(tmpDir, {
      recursive: true,
      force: true,
    });
  });
});
