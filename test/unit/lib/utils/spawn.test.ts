'use strict';

const fs = require('fs').promises;
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const nodeStream = require('stream');
const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const spawn = require('../../../../lib/utils/spawn');

const loadSpawnWithStubs = (stubs) =>
  proxyquire.noCallThru().load('../../../../lib/utils/spawn', stubs);
const loadSpawnSyncWithStubs = (stubs) =>
  proxyquire.noCallThru().load('../../../../lib/utils/spawn-sync', stubs);

const repoRoot = path.resolve(__dirname, '../../../../');

const collectJavaScriptFiles = async (directoryPath) => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScriptFiles(entryPath)));
    } else if (entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }

  return files;
};

const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for condition');
};

const createFakeOutputStream = () => {
  const outputStream = new EventEmitter();
  let paused = false;

  outputStream.pause = sinon.spy(() => {
    paused = true;
    return outputStream;
  });
  outputStream.resume = sinon.spy(() => {
    paused = false;
    return outputStream;
  });
  outputStream.isPaused = () => paused;

  return outputStream;
};

const createFakeChild = () => {
  const child = new EventEmitter();

  child.stdout = createFakeOutputStream();
  child.stderr = createFakeOutputStream();
  child.stdin = { end: sinon.spy() };

  return child;
};

const expectRejected = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
};

const expectThrownCode = (fn, code) => {
  try {
    fn();
  } catch (error) {
    expect(error).to.have.property('code', code);
    return error;
  }

  throw new Error(`Expected ${code} to be thrown`);
};

const assertRedaction = async ({ args, redacted, visible = [] }) => {
  const error = await expectRejected(
    spawn(process.execPath, ['-e', 'process.exit(7);', '--', ...args])
  );

  for (const value of redacted) {
    expect(error.message).to.not.include(value);
  }

  for (const value of visible) {
    expect(error.message).to.include(value);
  }
};

describe('spawn', () => {
  it('rejects shell-enabled spawns synchronously before spawning', () => {
    const crossSpawnStub = sinon.stub();
    const spawnWithStubs = loadSpawnWithStubs({
      'cross-spawn': crossSpawnStub,
    });

    const error = expectThrownCode(
      () => spawnWithStubs('npm', ['install'], { shell: true }),
      'UNSAFE_SHELL_SPAWN'
    );

    expect(error.message).to.include('shell enabled');
    expect(crossSpawnStub).to.not.have.been.called;
  });

  it('requires args to be an array', () => {
    const error = expectThrownCode(() => spawn('npm', 'install'), 'INVALID_SPAWN_INPUT');

    expect(error.message).to.equal('Spawn args must be an array.');
  });

  it('rejects null bytes in args', () => {
    const error = expectThrownCode(() => spawn('npm', ['a\0b']), 'INVALID_SPAWN_INPUT');

    expect(error.message).to.equal('Refusing to spawn command with null bytes.');
  });

  it('enforces spawn policy for sync spawns', () => {
    const crossSpawnStub = { sync: sinon.stub() };
    const spawnSyncWithStubs = loadSpawnSyncWithStubs({
      'cross-spawn': crossSpawnStub,
    });

    expectThrownCode(
      () => spawnSyncWithStubs('npm', ['install'], { shell: true }),
      'UNSAFE_SHELL_SPAWN'
    );
    expectThrownCode(() => spawnSyncWithStubs('npm', 'install'), 'INVALID_SPAWN_INPUT');
    expectThrownCode(() => spawnSyncWithStubs('npm', ['a\0b']), 'INVALID_SPAWN_INPUT');
    expect(crossSpawnStub.sync).to.not.have.been.called;
  });

  it('executes PATH shims through cross-platform resolution', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spawn-shim-'));
    const commandName = `spawn-shim-${crypto.randomBytes(12).toString('hex')}`;
    const commandPath = path.join(
      tempDir,
      process.platform === 'win32' ? `${commandName}.cmd` : commandName
    );
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';
    const originalPath = process.env[pathKey] || process.env.PATH || '';

    try {
      if (process.platform === 'win32') {
        await fs.writeFile(commandPath, '@echo off\r\necho shim-ok\r\n');
      } else {
        await fs.writeFile(commandPath, '#!/bin/sh\nprintf "shim-ok\\n"\n', {
          mode: 0o755,
        });
        await fs.chmod(commandPath, 0o755);
      }

      const env = {
        ...process.env,
        [pathKey]: `${tempDir}${path.delimiter}${originalPath}`,
      };

      if (process.platform === 'win32') {
        env.PATHEXT = [process.env.PATHEXT, '.CMD'].filter(Boolean).join(';');
      }

      const result = await spawn(commandName, [], { env });

      expect(String(result.stdoutBuffer).trim()).to.equal('shim-ok');
      expect(result.code).to.equal(0);
      expect(result.signal).to.equal(null);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('closes stdin when shouldCloseStdin is enabled', async () => {
    const result = await spawn(
      process.execPath,
      [
        '-e',
        'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("closed"));',
      ],
      { shouldCloseStdin: true }
    );

    expect(String(result.stdoutBuffer)).to.equal('closed');
  });

  it('exposes child, streams, std stream, buffers, code, and signal on success', async () => {
    const execution = spawn(process.execPath, [
      '-e',
      'setTimeout(() => { process.stdout.write("out"); process.stderr.write("err"); }, 25);',
    ]);
    const stdChunks = [];

    expect(execution.child).to.exist;
    expect(execution.stdout).to.exist;
    expect(execution.stderr).to.exist;
    expect(execution.std).to.exist;

    execution.std.on('data', (chunk) => stdChunks.push(chunk));

    const result = await execution;

    expect(result.child).to.equal(execution.child);
    expect(String(result.stdoutBuffer)).to.equal('out');
    expect(String(result.stderrBuffer)).to.equal('err');
    expect(String(result.stdBuffer)).to.include('out');
    expect(String(result.stdBuffer)).to.include('err');
    expect(String(Buffer.concat(stdChunks))).to.include('out');
    expect(String(Buffer.concat(stdChunks))).to.include('err');
    expect(result.code).to.equal(0);
    expect(result.signal).to.equal(null);
  });

  it('buffers output without concatenating on each chunk or retaining unread std', async () => {
    const child = createFakeChild();
    const spawnWithStubs = loadSpawnWithStubs({
      'cross-spawn': () => child,
    });
    const concatSpy = sinon.spy(Buffer, 'concat');

    try {
      const execution = spawnWithStubs('fake-command');

      child.stdout.emit('data', Buffer.from('out-'));
      child.stdout.emit('data', Buffer.from('more'));
      child.stderr.emit('data', Buffer.from('-err'));

      expect(concatSpy.called).to.equal(false);
      expect(execution.std.readableLength).to.equal(0);

      child.emit('close', 0, null);
      const result = await execution;

      expect(String(result.stdoutBuffer)).to.equal('out-more');
      expect(String(result.stderrBuffer)).to.equal('-err');
      expect(String(result.stdBuffer)).to.equal('out-more-err');
      expect(result.std).to.exist;
      expect(result.std.readableLength).to.equal(0);
      expect(concatSpy.callCount).to.be.at.most(3);
    } finally {
      concatSpy.restore();
    }
  });

  it('treats std as live while stdBuffer preserves history', async () => {
    const execution = spawn(process.execPath, [
      '-e',
      'process.stdout.write("early"); setTimeout(() => process.stdout.write("late"), 25);',
    ]);

    await waitFor(() => String(execution.stdoutBuffer).includes('early'));

    const stdChunks = [];
    execution.std.on('data', (chunk) => stdChunks.push(Buffer.from(chunk)));

    const result = await execution;

    expect(String(result.stdBuffer)).to.equal('earlylate');
    expect(String(Buffer.concat(stdChunks))).to.equal('late');
  });

  it('pauses child output while consumed std applies backpressure', async () => {
    const child = createFakeChild();
    let stdStream;

    class BackpressurePassThrough extends nodeStream.PassThrough {
      constructor(...args) {
        super(...args);
        stdStream = this;
      }

      write(chunk) {
        this.emit('data', Buffer.from(chunk));
        return false;
      }
    }

    const spawnWithStubs = loadSpawnWithStubs({
      'cross-spawn': () => child,
      'stream': { PassThrough: BackpressurePassThrough },
    });
    const execution = spawnWithStubs('fake-command');
    const stdChunks = [];

    execution.std.on('data', (chunk) => stdChunks.push(Buffer.from(chunk)));
    child.stdout.emit('data', Buffer.from('out'));

    expect(child.stdout.pause.calledOnce).to.equal(true);
    expect(child.stderr.pause.calledOnce).to.equal(true);

    stdStream.emit('drain');

    expect(child.stdout.resume.calledOnce).to.equal(true);
    expect(child.stderr.resume.calledOnce).to.equal(true);

    child.stderr.emit('data', Buffer.from('err'));
    child.emit('close', 0, null);
    const result = await execution;

    expect(String(result.stdBuffer)).to.equal('outerr');
    expect(String(Buffer.concat(stdChunks))).to.equal('outerr');
  });

  it('rejects nonzero exits with buffers and redacted command arguments', async () => {
    const error = await expectRejected(
      spawn(process.execPath, [
        '-e',
        'process.stdout.write("out"); process.stderr.write("err"); process.exit(7);',
        '--',
        '--password',
        'super-secret',
        '--token=secret-token',
      ])
    );

    expect(error.code).to.equal(7);
    expect(error.signal).to.equal(null);
    expect(String(error.stdoutBuffer)).to.equal('out');
    expect(String(error.stderrBuffer)).to.equal('err');
    expect(error.message).to.include('Exited with code 7');
    expect(error.message).to.not.include('super-secret');
    expect(error.message).to.not.include('secret-token');
    expect(error.message).to.include('--password <redacted>');
    expect(error.message).to.include('--token=<redacted>');
  });

  it('redacts sensitive option values in generated error messages', async () => {
    await assertRedaction({
      args: [
        '--authorization',
        'Bearer abc',
        '--credential',
        'profile',
        '--api-key',
        'key-value',
        '--access_key',
        'access-value',
        '--pwd',
        'pwd-value',
        '--SECRET',
        'secret-value',
        '--secret=inline-secret',
        '--monkey',
        'visible-value',
        '--tokenizer',
        'visible-tokenizer',
      ],
      redacted: [
        'Bearer abc',
        'profile',
        'key-value',
        'access-value',
        'pwd-value',
        'secret-value',
        'inline-secret',
      ],
      visible: ['--monkey', 'visible-value', '--tokenizer', 'visible-tokenizer'],
    });
  });

  it('preserves spawn error codes such as ENOENT', async () => {
    const error = await expectRejected(spawn(`missing-command-${process.pid}`, []));

    expect(error.code).to.equal('ENOENT');
    expect(error.stdoutBuffer).to.deep.equal(Buffer.alloc(0));
    expect(Buffer.isBuffer(error.stderrBuffer)).to.equal(true);
    expect(Buffer.isBuffer(error.stdBuffer)).to.equal(true);

    if (error.stderrBuffer.length) {
      expect(error.stdBuffer.equals(error.stderrBuffer)).to.equal(true);
    } else {
      expect(error.stdBuffer).to.deep.equal(Buffer.alloc(0));
    }
  });

  it('handles stdio inherit with null streams on success', async () => {
    const result = await spawn(process.execPath, ['-e', 'process.exit(0);'], {
      stdio: 'inherit',
    });

    expect(result.stdout).to.equal(null);
    expect(result.stderr).to.equal(null);
    expect(result.std).to.equal(null);
    expect(result.stdoutBuffer).to.deep.equal(Buffer.alloc(0));
    expect(result.stderrBuffer).to.deep.equal(Buffer.alloc(0));
    expect(result.stdBuffer).to.deep.equal(Buffer.alloc(0));
    expect(result.code).to.equal(0);
  });

  it('handles stdio inherit with null streams on nonzero exit', async () => {
    const error = await expectRejected(
      spawn(process.execPath, ['-e', 'process.exit(3);'], { stdio: 'inherit' })
    );

    expect(error.code).to.equal(3);
    expect(error.stdout).to.equal(null);
    expect(error.stderr).to.equal(null);
    expect(error.std).to.equal(null);
    expect(error.stdoutBuffer).to.deep.equal(Buffer.alloc(0));
    expect(error.stderrBuffer).to.deep.equal(Buffer.alloc(0));
    expect(error.stdBuffer).to.deep.equal(Buffer.alloc(0));
  });

  it('does not use raw child process APIs in production command or lib files', async () => {
    const prohibitedPattern =
      /require\(['"]child_process['"]\)|child_process\.exec|cp\.exec|shell:\s*true/;
    const files = (
      await Promise.all(
        ['commands', 'lib'].map((directoryName) =>
          collectJavaScriptFiles(path.join(repoRoot, directoryName))
        )
      )
    ).flat();
    const violations = [];

    for (const filePath of files) {
      const contents = await fs.readFile(filePath, 'utf8');
      contents.split(/\n/).forEach((line, index) => {
        if (prohibitedPattern.test(line)) {
          violations.push(`${path.relative(repoRoot, filePath)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).to.deep.equal([]);
  });
});
