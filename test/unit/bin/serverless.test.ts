import * as chai from 'chai';
import * as sinon from 'sinon';
import esmock from 'esmock';

const expect = chai.expect;

describe('test/unit/bin/serverless.test.ts', () => {
  let binModule;

  // triage and run-compose are imported lazily (`await import()`), so the mocks must persist
  const loadBin = async (stubs) => {
    binModule = await esmock.p('../../../bin/serverless.ts', stubs);
    return binModule;
  };

  afterEach(() => {
    sinon.restore();
    if (binModule) esmock.purge(binModule);
    binModule = null;
  });

  it('exits before CLI triage on unsupported Node versions', async () => {
    const isSupportedNodeVersion = sinon.stub().returns(false);
    isSupportedNodeVersion.supportedRange = '^20.19.0 || ^22.13.0 || >=24';
    const triage = sinon.stub();
    const stderrWrite = sinon.stub(process.stderr, 'write');
    const processExitError = new Error('process.exit');
    const processExit = sinon.stub(process, 'exit').callsFake(() => {
      throw processExitError;
    });

    let error;
    try {
      await loadBin({
        '../../../lib/cli/is-supported-node-version.ts': isSupportedNodeVersion,
        '../../../lib/utils/package-root.ts': { packageJson: { version: '3.40.1' } },
        '../../../lib/cli/triage.ts': triage,
      });
    } catch (loadError) {
      error = loadError;
    }
    stderrWrite.restore();
    expect(error).to.equal(processExitError);

    expect(isSupportedNodeVersion).to.have.been.calledOnceWithExactly(process.version);
    expect(stderrWrite).to.have.been.calledOnceWithExactly(
      'Error: osls v3.40.1 does not support ' +
        `Node.js ${process.version}. Please use a supported release. ` +
        'Supported versions: ^20.19.0 || ^22.13.0 || >=24.\n'
    );
    expect(processExit).to.have.been.calledOnceWithExactly(1);
    expect(triage.called).to.equal(false);
  });

  it('dispatches compose requests through run-compose on supported Node versions', async () => {
    const triage = sinon.stub().returns(Promise.resolve('@osls/compose'));
    let resolveRunCompose;
    const runComposeCalled = new Promise((resolve) => {
      resolveRunCompose = resolve;
    });
    const runCompose = sinon.stub().callsFake(async () => resolveRunCompose());
    const isSupportedNodeVersion = sinon.stub().returns(true);
    isSupportedNodeVersion.supportedRange = '^20.19.0 || ^22.13.0 || >=24';

    await loadBin({
      '../../../lib/cli/is-supported-node-version.ts': isSupportedNodeVersion,
      '../../../lib/cli/triage.ts': triage,
      '../../../lib/cli/run-compose.ts': runCompose,
    });

    await runComposeCalled;

    expect(triage).to.have.been.calledOnceWithExactly();
    expect(runCompose).to.have.been.calledOnceWithExactly();
  });
});
