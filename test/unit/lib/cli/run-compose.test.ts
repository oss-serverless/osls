'use strict';

const path = require('path');
const fsp = require('fs').promises;
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { overrideEnv, overrideCwd, overrideStdoutWrite } = require('../../../utils/process');
const { expect } = require('chai');

const provisionTmpDir = require('../../../lib/provision-tmp-dir');
const { outputFile, remove, writeJsonFile } = require('../../../utils/fs');

const createProgressFooter = () => ({
  shouldAddProgressAnimationPrefix: false,
  progressAnimationPrefixFrames: ['x'],
  updateProgress: sinon.stub(),
});

const writeFakeComposeBin = async (rootDir) => {
  const composeBinPath = path.join(rootDir, '@osls', 'compose', 'bin', 'serverless-compose.js');
  await outputFile(
    composeBinPath,
    'global.__runComposeCalls = global.__runComposeCalls || []; global.__runComposeCalls.push(__filename);'
  );
  return composeBinPath;
};

const loadRunCompose = ({ spawnStub, inquirerStub, progressFooterFactoryStub, fsStub } = {}) => {
  const modulePath = '../../../../lib/cli/run-compose';
  delete require.cache[require.resolve(modulePath)];

  return proxyquire.noCallThru().load(modulePath, {
    '../utils/spawn': spawnStub,
    '../utils/serverless-utils/inquirer': inquirerStub,
    '../utils/progress-footer': progressFooterFactoryStub,
    ...(fsStub ? { fs: fsStub } : {}),
  });
};

describe('test/unit/lib/cli/run-compose.test.js', () => {
  let serviceDir;
  let stdout;
  let restoreEnv;
  let restoreCwd;
  let restoreStdoutWrite;
  let originalStdinIsTTY;
  let originalStdoutIsTTY;
  let originalExitCode;

  beforeEach(async () => {
    serviceDir = await provisionTmpDir();
    stdout = '';
    ({ restoreEnv } = overrideEnv({ asCopy: true }));
    ({ restoreCwd } = overrideCwd(serviceDir));
    ({ restoreStdoutWrite } = overrideStdoutWrite((chunk) => {
      stdout += String(chunk);
      return true;
    }));
    originalStdinIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    delete global.__runComposeCalls;
  });

  afterEach(async () => {
    restoreStdoutWrite();
    restoreCwd();
    restoreEnv();
    if (originalStdinIsTTY === undefined) {
      delete process.stdin.isTTY;
    } else {
      process.stdin.isTTY = originalStdinIsTTY;
    }
    if (originalStdoutIsTTY === undefined) {
      delete process.stdout.isTTY;
    } else {
      process.stdout.isTTY = originalStdoutIsTTY;
    }
    process.exitCode = originalExitCode;
    delete global.__runComposeCalls;
    sinon.restore();
    await remove(serviceDir);
  });

  it('loads local compose immediately when it is already installed', async () => {
    await writeFakeComposeBin(path.join(serviceDir, 'node_modules'));
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    delete process.env.CI;

    const spawnStub = sinon.stub();
    const inquirerStub = { prompt: sinon.stub() };
    const runCompose = loadRunCompose({
      spawnStub,
      inquirerStub,
      progressFooterFactoryStub: sinon.stub(),
    });

    await runCompose();

    expect(global.__runComposeCalls).to.have.length(1);
    expect(spawnStub.called).to.equal(false);
    expect(inquirerStub.prompt.called).to.equal(false);
  });

  it('loads globally installed compose when local compose is missing', async () => {
    const globalRoot = path.join(serviceDir, 'global-node_modules');
    await writeFakeComposeBin(globalRoot);
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    delete process.env.CI;

    const spawnStub = sinon.stub().callsFake(async (command, args) => {
      if (command === 'npm' && args.join(' ') === 'root -g') {
        return { stdoutBuffer: Buffer.from(globalRoot) };
      }
      throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    });

    const inquirerStub = { prompt: sinon.stub() };
    const runCompose = loadRunCompose({
      spawnStub,
      inquirerStub,
      progressFooterFactoryStub: sinon.stub(),
    });

    await runCompose();

    expect(global.__runComposeCalls).to.have.length(1);
    expect(spawnStub.calledOnce).to.equal(true);
    expect(inquirerStub.prompt.called).to.equal(false);
  });

  it('prints manual installation guidance when the interactive prompt is declined', async () => {
    const globalRoot = path.join(serviceDir, 'global-node_modules');
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    delete process.env.CI;

    const spawnStub = sinon.stub().callsFake(async (command, args) => {
      if (command === 'npm' && args.join(' ') === 'root -g') {
        return { stdoutBuffer: Buffer.from(globalRoot) };
      }
      throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    });
    const inquirerStub = {
      prompt: sinon.stub().resolves({ shouldInstallCompose: false }),
    };
    const runCompose = loadRunCompose({
      spawnStub,
      inquirerStub,
      progressFooterFactoryStub: sinon.stub(),
    });

    await runCompose();

    expect(stdout).to.include('osls compose needs to be installed first.');
    expect(stdout).to.include(
      'Please install it manually with "npm i --save-dev @osls/compose" and run this command again.'
    );
    expect(process.exitCode).to.equal(undefined);
    expect(global.__runComposeCalls).to.equal(undefined);
  });

  it('creates package.json, installs compose, and loads it in interactive mode', async () => {
    const globalRoot = path.join(serviceDir, 'global-node_modules');
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    delete process.env.CI;

    const spawnStub = sinon.stub().callsFake(async (command, args) => {
      if (command === 'npm' && args.join(' ') === 'root -g') {
        return { stdoutBuffer: Buffer.from(globalRoot) };
      }
      if (command === 'npm' && args.join(' ') === 'install --save-dev @osls/compose') {
        await writeFakeComposeBin(path.join(serviceDir, 'node_modules'));
        return { stdoutBuffer: Buffer.from('ok') };
      }
      throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    });
    const inquirerStub = {
      prompt: sinon.stub().resolves({ shouldInstallCompose: true }),
    };
    const progressFooter = createProgressFooter();
    const runCompose = loadRunCompose({
      spawnStub,
      inquirerStub,
      progressFooterFactoryStub: sinon.stub().returns(progressFooter),
    });

    await runCompose();

    expect(
      JSON.parse(await fsp.readFile(path.join(serviceDir, 'package.json'), 'utf8'))
    ).to.deep.equal({});
    expect(global.__runComposeCalls).to.have.length(1);
    expect(progressFooter.updateProgress.called).to.equal(true);
    expect(process.exitCode).to.equal(undefined);
  });

  it('prints a package.json creation error when interactive installation cannot create one', async () => {
    const globalRoot = path.join(serviceDir, 'global-node_modules');
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    delete process.env.CI;

    const spawnStub = sinon.stub().callsFake(async (command, args) => {
      if (command === 'npm' && args.join(' ') === 'root -g') {
        return { stdoutBuffer: Buffer.from(globalRoot) };
      }
      throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    });
    const inquirerStub = {
      prompt: sinon.stub().resolves({ shouldInstallCompose: true }),
    };
    const progressFooter = createProgressFooter();
    const runCompose = loadRunCompose({
      spawnStub,
      inquirerStub,
      progressFooterFactoryStub: sinon.stub().returns(progressFooter),
      fsStub: {
        promises: {
          writeFile: sinon.stub().rejects(new Error('write failed')),
        },
      },
    });

    await runCompose();

    expect(stdout).to.include('Could not create "package.json" in current directory.');
    expect(global.__runComposeCalls).to.equal(undefined);
  });

  it('prints an install error when interactive installation fails', async () => {
    const globalRoot = path.join(serviceDir, 'global-node_modules');
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    delete process.env.CI;

    const spawnStub = sinon.stub().callsFake(async (command, args) => {
      if (command === 'npm' && args.join(' ') === 'root -g') {
        return { stdoutBuffer: Buffer.from(globalRoot) };
      }
      if (command === 'npm' && args.join(' ') === 'install --save-dev @osls/compose') {
        throw new Error('install failed');
      }
      throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    });
    const inquirerStub = {
      prompt: sinon.stub().resolves({ shouldInstallCompose: true }),
    };
    const progressFooter = createProgressFooter();
    const runCompose = loadRunCompose({
      spawnStub,
      inquirerStub,
      progressFooterFactoryStub: sinon.stub().returns(progressFooter),
    });

    await runCompose();

    expect(stdout).to.include('Could not install osls compose CLI locally.');
    expect(global.__runComposeCalls).to.equal(undefined);
  });

  it('installs compose in non-interactive mode when it is declared in devDependencies', async () => {
    const globalRoot = path.join(serviceDir, 'global-node_modules');
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    process.env.CI = '1';

    await writeJsonFile(path.join(serviceDir, 'package.json'), {
      devDependencies: {
        '@osls/compose': '^1.0.0',
      },
    });

    const spawnStub = sinon.stub().callsFake(async (command, args) => {
      if (command === 'npm' && args.join(' ') === 'root -g') {
        return { stdoutBuffer: Buffer.from(globalRoot) };
      }
      if (
        command === 'npm' &&
        args.join(' ') === 'install --no-save --no-package-lock @osls/compose'
      ) {
        await writeFakeComposeBin(path.join(serviceDir, 'node_modules'));
        return { stdoutBuffer: Buffer.from('ok') };
      }
      throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    });

    const runCompose = loadRunCompose({
      spawnStub,
      inquirerStub: { prompt: sinon.stub() },
      progressFooterFactoryStub: sinon.stub(),
    });

    await runCompose();

    expect(stdout).to.include('Installing osls compose CLI via NPM');
    expect(global.__runComposeCalls).to.have.length(1);
    expect(process.exitCode).to.equal(undefined);
  });

  it('prints an error and sets exitCode when non-interactive mode has no declared compose dependency', async () => {
    const globalRoot = path.join(serviceDir, 'global-node_modules');
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    process.env.CI = '1';

    const spawnStub = sinon.stub().callsFake(async (command, args) => {
      if (command === 'npm' && args.join(' ') === 'root -g') {
        return { stdoutBuffer: Buffer.from(globalRoot) };
      }
      throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    });

    const runCompose = loadRunCompose({
      spawnStub,
      inquirerStub: { prompt: sinon.stub() },
      progressFooterFactoryStub: sinon.stub(),
    });

    await runCompose();

    expect(stdout).to.include('Installing osls compose CLI via NPM');
    expect(stdout).to.include('Installation failed.');
    expect(process.exitCode).to.equal(1);
    expect(global.__runComposeCalls).to.equal(undefined);
  });

  it('prints an error and sets exitCode when non-interactive installation fails', async () => {
    const globalRoot = path.join(serviceDir, 'global-node_modules');
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    process.env.CI = '1';

    await writeJsonFile(path.join(serviceDir, 'package.json'), {
      devDependencies: {
        '@osls/compose': '^1.0.0',
      },
    });

    const spawnStub = sinon.stub().callsFake(async (command, args) => {
      if (command === 'npm' && args.join(' ') === 'root -g') {
        return { stdoutBuffer: Buffer.from(globalRoot) };
      }
      if (
        command === 'npm' &&
        args.join(' ') === 'install --no-save --no-package-lock @osls/compose'
      ) {
        throw new Error('install failed');
      }
      throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    });

    const runCompose = loadRunCompose({
      spawnStub,
      inquirerStub: { prompt: sinon.stub() },
      progressFooterFactoryStub: sinon.stub(),
    });

    await runCompose();

    expect(stdout).to.include('Installation failed.');
    expect(process.exitCode).to.equal(1);
    expect(global.__runComposeCalls).to.equal(undefined);
  });
});
