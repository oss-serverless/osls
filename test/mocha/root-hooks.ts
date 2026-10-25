import * as sinon from 'sinon';
import runtimeSandbox from './runtime-sandbox.ts';
import clearCaches from './clear-caches.ts';

export const mochaHooks = {
  beforeAll() {
    runtimeSandbox.prepareSuite();
  },

  beforeEach() {
    runtimeSandbox.captureTestState();
    runtimeSandbox.restoreTestState();
  },

  afterEach() {
    sinon.restore();
    clearCaches();
    runtimeSandbox.restoreTestState();
  },

  afterAll() {
    clearCaches();
    runtimeSandbox.resetProcessState();
  },
};
