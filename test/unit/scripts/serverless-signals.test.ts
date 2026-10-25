import { expect } from 'chai';
import * as sinon from 'sinon';
import esmock from 'esmock';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

// setTimeout is stubbed in these tests, setImmediate is not. One turn drains all microtasks
const flush = () => new Promise((resolve) => setImmediate(resolve));

// The script imports its dependencies lazily, which takes more than a few microtasks
const waitFor = async (condition) => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await flush();
  }
};

describe('test/unit/scripts/serverless-signals.test.ts', () => {
  let sleepDeferred;
  let renderVersionDeferred;
  let onceHandlers;
  let timerToken;
  let stubs;
  let originalPlatformDescriptor;
  let originalStackTraceLimit;
  let scriptModule;

  beforeEach(() => {
    originalStackTraceLimit = Error.stackTraceLimit;
  });

  const loadScript = async ({ signals = ['SIGINT', 'SIGTERM'], listenerCount = 0 } = {}) => {
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

    // The script imports most modules lazily (`await import()`), so the mocks must persist
    scriptModule = await esmock.p('../../../scripts/serverless.ts', {
      '../../../lib/utils/serverless-utils/log-reporters/node.ts': {},
      '../../../lib/utils/serverless-utils/log.ts': { log, progress },
      '../../../lib/cli/handle-error.ts': stubs.handleError,
      '../../../lib/utils/log-deprecation.ts': { printSummary: stubs.printSummary },
      '../../../lib/utils/sleep.ts': stubs.sleep,
      'signal-exit/signals': { signals },
      '../../../lib/configuration/variables/humanize-property-path-keys.ts': sinon.stub(),
      '../../../lib/cli/param-reg-exp.ts': { default: /^-/ },
      '../../../lib/cli/resolve-input.ts': resolveInput,
      '../../../lib/cli/commands-schema/no-service.ts': {},
      '../../../lib/cli/render-version.ts': stubs.renderVersion,
    });
  };

  afterEach(async () => {
    // Let the script run to completion before the process stubs are restored
    if (sleepDeferred) {
      sleepDeferred.resolve();
      await waitFor(() => stubs.renderVersion.called);
    }

    if (renderVersionDeferred) renderVersionDeferred.resolve();
    await flush();

    if (scriptModule) {
      esmock.purge(scriptModule);
      scriptModule = null;
    }

    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
      originalPlatformDescriptor = null;
    }

    Error.stackTraceLimit = originalStackTraceLimit;

    sinon.restore();
  });

  it('registers uncaughtException synchronously and signal handlers after sleep', async () => {
    await loadScript({ signals: ['SIGINT', 'SIGTERM'] });

    expect(stubs.once).to.have.been.calledWith('uncaughtException', sinon.match.func);
    expect(onceHandlers.has('SIGINT')).to.equal(false);
    expect(onceHandlers.has('SIGTERM')).to.equal(false);

    sleepDeferred.resolve();
    await waitFor(() => stubs.renderVersion.called);

    expect(stubs.once).to.have.been.calledWith('SIGINT', sinon.match.func);
    expect(stubs.once).to.have.been.calledWith('SIGTERM', sinon.match.func);
    expect(stubs.renderVersion).to.have.been.calledOnce;
  });

  it('finalizes synchronously and re-emits signal when no other listener exists', async () => {
    await loadScript({ signals: ['SIGINT'], listenerCount: 0 });

    sleepDeferred.resolve();
    await waitFor(() => stubs.renderVersion.called);

    onceHandlers.get('SIGINT')();

    expect(stubs.clearTimeout).to.have.been.calledWithExactly(timerToken);
    expect(stubs.progress.clear).to.have.been.calledOnce;
    expect(stubs.printSummary).to.not.have.been.called;
    expect(stubs.kill).to.have.been.calledOnceWithExactly(process.pid, 'SIGINT');
    expect(stubs.exit).to.not.have.been.called;
  });

  it('does not re-emit signal when another listener exists', async () => {
    await loadScript({ signals: ['SIGTERM'], listenerCount: 1 });

    sleepDeferred.resolve();
    await waitFor(() => stubs.renderVersion.called);

    onceHandlers.get('SIGTERM')();

    expect(stubs.clearTimeout).to.have.been.calledWithExactly(timerToken);
    expect(stubs.progress.clear).to.have.been.calledOnce;
    expect(stubs.kill).to.not.have.been.called;
  });

  it('remaps SIGHUP to SIGINT before re-emitting on Windows', async () => {
    originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });

    await loadScript({ signals: ['SIGHUP'], listenerCount: 0 });

    sleepDeferred.resolve();
    await waitFor(() => stubs.renderVersion.called);

    onceHandlers.get('SIGHUP')();

    expect(stubs.kill).to.have.been.calledOnceWithExactly(process.pid, 'SIGINT');
  });

  it('handles uncaughtException through finalize and process.exit', async () => {
    const error = new Error('boom');

    await loadScript();

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
