'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const modulePath = '../../../scripts/serverless.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('test/unit/scripts/serverless-signals.test.js', () => {
  let sleepDeferred;
  let renderVersionDeferred;
  let onceHandlers;
  let timerToken;
  let stubs;
  let originalPlatformDescriptor;
  let originalStackTraceLimit;

  beforeEach(() => {
    originalStackTraceLimit = Error.stackTraceLimit;
  });

  const loadScript = ({ signals = ['SIGINT', 'SIGTERM'], listenerCount = 0 } = {}) => {
    sleepDeferred = deferred();
    renderVersionDeferred = deferred();
    onceHandlers = new Map();
    timerToken = {};

    const processLog = { debug: sinon.stub() };
    const log = {
      get: sinon.stub().withArgs('process').returns(processLog),
      error: sinon.stub(),
    };
    const progress = { clear: sinon.stub() };
    const resolveInput = sinon.stub().returns({
      command: undefined,
      commands: [],
      options: { version: true },
      isHelpRequest: false,
      commandSchema: undefined,
    });

    stubs = {
      setTimeout: sinon.stub(global, 'setTimeout').returns(timerToken),
      clearTimeout: sinon.stub(global, 'clearTimeout'),
      once: sinon.stub(process, 'once').callsFake((eventName, listener) => {
        onceHandlers.set(eventName, listener);
        return process;
      }),
      listenerCount: sinon.stub(process, 'listenerCount').callsFake((eventName) => {
        if (signals.includes(eventName)) return listenerCount;
        return 0;
      }),
      kill: sinon.stub(process, 'kill'),
      exit: sinon.stub(process, 'exit'),
      sleep: sinon.stub().returns(sleepDeferred.promise),
      renderVersion: sinon.stub().returns(renderVersionDeferred.promise),
      handleError: sinon.stub(),
      printSummary: sinon.stub().resolves(),
      log,
      progress,
      processLog,
      resolveInput,
    };

    sinon.stub(process, 'argv').value(['node', 'serverless', '--version']);

    delete require.cache[require.resolve(modulePath)];

    proxyquire.noCallThru().load(modulePath, {
      '../lib/utils/serverless-utils/log-reporters/node': {},
      '../lib/utils/serverless-utils/log': { log, progress },
      '../lib/cli/handle-error': stubs.handleError,
      '../lib/utils/log-deprecation': { printSummary: stubs.printSummary },
      '../lib/utils/sleep': stubs.sleep,
      'signal-exit/signals': { signals },
      '../lib/configuration/variables/humanize-property-path-keys': sinon.stub(),
      '../lib/cli/param-reg-exp': /^-/,
      '../lib/cli/resolve-input': resolveInput,
      '../lib/cli/commands-schema/no-service': {},
      '../lib/cli/render-version': stubs.renderVersion,
    });
  };

  afterEach(async () => {
    if (sleepDeferred) sleepDeferred.resolve();
    await flush();

    if (renderVersionDeferred) renderVersionDeferred.resolve();
    await flush();

    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
      originalPlatformDescriptor = null;
    }

    Error.stackTraceLimit = originalStackTraceLimit;

    sinon.restore();
  });

  it('registers uncaughtException synchronously and signal handlers after sleep', async () => {
    loadScript({ signals: ['SIGINT', 'SIGTERM'] });

    expect(stubs.once).to.have.been.calledWith('uncaughtException', sinon.match.func);
    expect(onceHandlers.has('SIGINT')).to.equal(false);
    expect(onceHandlers.has('SIGTERM')).to.equal(false);

    sleepDeferred.resolve();
    await flush();

    expect(stubs.once).to.have.been.calledWith('SIGINT', sinon.match.func);
    expect(stubs.once).to.have.been.calledWith('SIGTERM', sinon.match.func);
    expect(stubs.renderVersion).to.have.been.calledOnce;
  });

  it('finalizes synchronously and re-emits signal when no other listener exists', async () => {
    loadScript({ signals: ['SIGINT'], listenerCount: 0 });

    sleepDeferred.resolve();
    await flush();

    onceHandlers.get('SIGINT')();

    expect(stubs.clearTimeout).to.have.been.calledWithExactly(timerToken);
    expect(stubs.progress.clear).to.have.been.calledOnce;
    expect(stubs.printSummary).to.not.have.been.called;
    expect(stubs.kill).to.have.been.calledOnceWithExactly(process.pid, 'SIGINT');
    expect(stubs.exit).to.not.have.been.called;
  });

  it('does not re-emit signal when another listener exists', async () => {
    loadScript({ signals: ['SIGTERM'], listenerCount: 1 });

    sleepDeferred.resolve();
    await flush();

    onceHandlers.get('SIGTERM')();

    expect(stubs.clearTimeout).to.have.been.calledWithExactly(timerToken);
    expect(stubs.progress.clear).to.have.been.calledOnce;
    expect(stubs.kill).to.not.have.been.called;
  });

  it('remaps SIGHUP to SIGINT before re-emitting on Windows', async () => {
    originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });

    loadScript({ signals: ['SIGHUP'], listenerCount: 0 });

    sleepDeferred.resolve();
    await flush();

    onceHandlers.get('SIGHUP')();

    expect(stubs.kill).to.have.been.calledOnceWithExactly(process.pid, 'SIGINT');
  });

  it('handles uncaughtException through finalize and process.exit', async () => {
    const error = new Error('boom');

    loadScript();

    onceHandlers.get('uncaughtException')(error);
    await flush();

    expect(stubs.log.error).to.have.been.calledOnceWithExactly('Uncaught exception');
    expect(stubs.handleError).to.have.been.calledOnceWithExactly(error, {
      serverless: undefined,
    });
    expect(stubs.printSummary).to.have.been.calledOnce;
    expect(stubs.exit).to.have.been.calledOnceWithExactly();
  });
});
