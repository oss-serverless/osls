'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { expect } = require('chai');

const {
  createEnv,
  overrideArgv,
  overrideCwd,
  overrideEnv,
  overrideStdoutWrite,
} = require('../../../utils/process');

describe('test/unit/lib/utils/process.test.js', () => {
  let originalEnv;
  let originalArgv;
  let originalStdoutWrite;
  let originalCwd;
  let tmpDir;

  beforeEach(() => {
    originalEnv = process.env;
    originalArgv = process.argv;
    originalStdoutWrite = process.stdout.write;
    originalCwd = process.cwd();
    tmpDir = null;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
    process.stdout.write = originalStdoutWrite;
    process.chdir(originalCwd);
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates env from whitelist and variables', () => {
    process.env = { KEEP: 'yes', SKIP: 'no' };

    const env = createEnv({
      whitelist: ['KEEP', 'MISSING'],
      variables: { ADDED: '42' },
    });

    expect(env.KEEP).to.equal('yes');
    expect(env.ADDED).to.equal('42');
    expect(env.SKIP).to.equal(undefined);
    expect(env.MISSING).to.equal(undefined);
  });

  it('preserves unsafe env keys as own properties', () => {
    const variables = Object.create(null);
    variables.__proto__ = 'proto-value';
    variables.toString = 'string-value';

    const env = createEnv({ variables });

    expect(Object.prototype.hasOwnProperty.call(env, '__proto__')).to.equal(true);
    expect(Object.prototype.hasOwnProperty.call(env, 'toString')).to.equal(true);
    expect(env.__proto__).to.equal('proto-value');
    expect(env.toString).to.equal('string-value');
  });

  it('matches upstream coercion errors for Symbol env values', () => {
    expect(() => createEnv({ variables: { FOO: Symbol('foo') } })).to.throw(TypeError);
  });

  it('copies current env when asCopy is true', () => {
    process.env = { COPIED: 'yes' };

    const env = createEnv({ asCopy: true });

    expect(env.COPIED).to.equal('yes');
  });

  it('returns manual env restore handles', () => {
    const { originalEnv: handleOriginalEnv, restoreEnv } = overrideEnv({
      variables: { FOO: 'bar' },
    });

    expect(handleOriginalEnv).to.equal(originalEnv);
    expect(process.env).to.not.equal(originalEnv);
    expect(process.env.FOO).to.equal('bar');

    restoreEnv();

    expect(process.env).to.equal(originalEnv);
  });

  it('restores env after callback resolves', async () => {
    const result = await overrideEnv({ variables: { FOO: 'bar' } }, async (callbackOriginalEnv) => {
      expect(callbackOriginalEnv).to.equal(originalEnv);
      expect(process.env.FOO).to.equal('bar');
      return 'result';
    });

    expect(result).to.equal('result');
    expect(process.env).to.equal(originalEnv);
  });

  it('restores env after callback rejects', async () => {
    const error = new Error('failure');

    await expect(
      overrideEnv({ variables: { FOO: 'bar' } }, async () => {
        throw error;
      })
    ).to.be.rejectedWith(error);

    expect(process.env).to.equal(originalEnv);
  });

  it('restores env after callback throws', () => {
    const error = new Error('failure');

    expect(() =>
      overrideEnv({ variables: { FOO: 'bar' } }, () => {
        throw error;
      })
    ).to.throw(error);

    expect(process.env).to.equal(originalEnv);
  });

  it('returns manual cwd restore handles', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-process-cwd-'));
    const expectedCwd = fs.realpathSync(tmpDir);

    const { originalCwd: handleOriginalCwd, restoreCwd } = overrideCwd(tmpDir);

    expect(handleOriginalCwd).to.equal(originalCwd);
    expect(process.cwd()).to.equal(expectedCwd);

    restoreCwd();

    expect(process.cwd()).to.equal(originalCwd);
  });

  it('restores cwd after callback resolves', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-process-cwd-'));
    const expectedCwd = fs.realpathSync(tmpDir);

    const result = await overrideCwd(tmpDir, async (callbackOriginalCwd) => {
      expect(callbackOriginalCwd).to.equal(originalCwd);
      expect(process.cwd()).to.equal(expectedCwd);
      return 'result';
    });

    expect(result).to.equal('result');
    expect(process.cwd()).to.equal(originalCwd);
  });

  it('returns manual argv restore handles', () => {
    process.argv = ['node', 'script.js', 'old'];
    const argvBeforeOverride = process.argv;

    const { originalArgv: handleOriginalArgv, restoreArgv } = overrideArgv({
      sliceAt: 2,
      args: ['deploy', 42],
    });

    expect(handleOriginalArgv).to.equal(argvBeforeOverride);
    expect(process.argv).to.deep.equal(['node', 'script.js', 'deploy', '42']);

    restoreArgv();

    expect(process.argv).to.equal(argvBeforeOverride);
  });

  it('restores argv after callback resolves', async () => {
    process.argv = ['node', 'script.js', 'old'];
    const argvBeforeOverride = process.argv;

    const result = await overrideArgv({ args: ['deploy'] }, async (callbackOriginalArgv) => {
      expect(callbackOriginalArgv).to.equal(argvBeforeOverride);
      expect(process.argv).to.deep.equal(['node', 'deploy']);
      return 'result';
    });

    expect(result).to.equal('result');
    expect(process.argv).to.equal(argvBeforeOverride);
  });

  it('rejects invalid argv sliceAt values', () => {
    expect(() => overrideArgv({ sliceAt: -1 })).to.throw(TypeError);
    expect(() => overrideArgv({ sliceAt: 1.5 })).to.throw(TypeError);
  });

  it('returns manual stdout.write restore handles', () => {
    let output = '';

    const {
      originalWrite,
      originalStdoutWrite: handleOriginalStdoutWrite,
      restoreStdoutWrite,
    } = overrideStdoutWrite((chunk) => {
      output += String(chunk);
      return 'handled';
    });

    expect(originalWrite).to.equal(originalStdoutWrite);
    expect(handleOriginalStdoutWrite).to.be.a('function');
    expect(process.stdout.write('hello')).to.equal('handled');
    expect(output).to.equal('hello');

    restoreStdoutWrite();

    expect(process.stdout.write).to.equal(originalStdoutWrite);
  });

  it('restores stdout.write after callback resolves', async () => {
    let output = '';

    const result = await overrideStdoutWrite(
      (chunk) => {
        output += String(chunk);
        return true;
      },
      async (handleOriginalStdoutWrite, handleOriginalWrite) => {
        expect(handleOriginalStdoutWrite).to.be.a('function');
        expect(handleOriginalWrite).to.equal(originalStdoutWrite);
        expect(process.stdout.write('hello')).to.equal(true);
        return 'result';
      }
    );

    expect(result).to.equal('result');
    expect(output).to.equal('hello');
    expect(process.stdout.write).to.equal(originalStdoutWrite);
  });
});
