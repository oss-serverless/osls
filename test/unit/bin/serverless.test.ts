'use strict';

const chai = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const expect = chai.expect;

describe('test/unit/bin/serverless.test.js', () => {
  const loadBin = (stubs) => {
    delete require.cache[require.resolve('../../../bin/serverless.js')];
    proxyquire.noCallThru().load('../../../bin/serverless.js', stubs);
  };

  afterEach(() => {
    sinon.restore();
  });

  it('exits before CLI triage on unsupported Node versions', () => {
    const isSupportedNodeVersion = sinon.stub().returns(false);
    isSupportedNodeVersion.supportedRange = '^20.19.0 || ^22.13.0 || >=24';
    const triage = sinon.stub();
    const stderrWrite = sinon.stub(process.stderr, 'write');
    const processExitError = new Error('process.exit');
    const processExit = sinon.stub(process, 'exit').callsFake(() => {
      throw processExitError;
    });

    expect(() => {
      loadBin({
        '../lib/cli/is-supported-node-version': isSupportedNodeVersion,
        '../package.json': { version: '3.40.1' },
        '../lib/cli/triage': triage,
      });
    }).to.throw(processExitError);

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
    const runCompose = sinon.stub().resolves();
    const isSupportedNodeVersion = sinon.stub().returns(true);
    isSupportedNodeVersion.supportedRange = '^20.19.0 || ^22.13.0 || >=24';

    loadBin({
      '../lib/cli/is-supported-node-version': isSupportedNodeVersion,
      '../lib/utils/is-standalone-executable': false,
      '../lib/cli/triage': triage,
      '../lib/cli/run-compose': runCompose,
    });

    await Promise.resolve();

    expect(triage).to.have.been.calledOnceWithExactly();
    expect(runCompose).to.have.been.calledOnceWithExactly();
  });
});
