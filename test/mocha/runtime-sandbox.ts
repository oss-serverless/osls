import fs from 'node:fs';
import path from 'node:path';

const bootstrapState = globalThis.__SERVERLESS_TEST_BOOTSTRAP__;
const originalCwd = process.cwd();
const originalEnv = Object.assign(Object.create(null), process.env);
const originalArgv = process.argv.slice();
const originalServerlessCommandStartTime = EvalError.$serverlessCommandStartTime;

const restoreEnv = (targetEnv, sourceEnv) => {
  for (const key of Object.keys(targetEnv)) {
    if (!(key in sourceEnv)) delete targetEnv[key];
  }

  for (const [key, value] of Object.entries(sourceEnv)) {
    targetEnv[key] = value;
  }
};

const removePathSync = (targetPath) => {
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 10 : 0,
    retryDelay: 50,
  });
};

// Keep the mocked home path stable across files because some tests and modules
// capture os.homedir() at load time. Only clear its contents between files.
const clearDirectoryContentsSync = (directoryPath) => {
  fs.mkdirSync(directoryPath, { recursive: true });
  for (const entry of fs.readdirSync(directoryPath)) {
    removePathSync(path.join(directoryPath, entry));
  }
};

class RuntimeSandbox {
  constructor() {
    this.baseEnv = null;
    this.testEnv = null;
    this.testArgv = null;
    this.testCwd = null;
    this.testServerlessCommandStartTime = undefined;
  }

  prepareSuite() {
    process.chdir(originalCwd);
    clearDirectoryContentsSync(bootstrapState.workerHomeDir);

    this.baseEnv = Object.assign(Object.create(null), originalEnv, {
      HOME: bootstrapState.workerHomeDir,
      USERPROFILE: bootstrapState.workerHomeDir,
    });
    this.testEnv = null;
    this.testArgv = null;
    this.testCwd = null;
    this.testServerlessCommandStartTime = undefined;

    this.restoreTestState();
  }

  captureTestState() {
    this.testEnv = Object.assign(Object.create(null), process.env);
    this.testArgv = process.argv.slice();
    this.testCwd = process.cwd();
    this.testServerlessCommandStartTime = EvalError.$serverlessCommandStartTime;
  }

  restoreTestState() {
    const envToRestore = this.testEnv || this.baseEnv;

    restoreEnv(process.env, envToRestore);
    process.argv = (this.testArgv || originalArgv).slice();
    const commandStartTime =
      this.testEnv != null
        ? this.testServerlessCommandStartTime
        : originalServerlessCommandStartTime;

    if (commandStartTime === undefined) {
      delete EvalError.$serverlessCommandStartTime;
    } else {
      EvalError.$serverlessCommandStartTime = commandStartTime;
    }
    process.chdir(this.testCwd || bootstrapState.workerHomeDir);
  }

  resetProcessState() {
    restoreEnv(process.env, originalEnv);
    process.argv = originalArgv.slice();
    if (originalServerlessCommandStartTime === undefined) {
      delete EvalError.$serverlessCommandStartTime;
    } else {
      EvalError.$serverlessCommandStartTime = originalServerlessCommandStartTime;
    }
    process.chdir(originalCwd);
  }
}

export default new RuntimeSandbox();
