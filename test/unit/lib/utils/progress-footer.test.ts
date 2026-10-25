import childProcess from 'node:child_process';
import * as sinon from 'sinon';
import { expect } from 'chai';
import esmock from 'esmock';

const modulePath = '../../../../lib/utils/progress-footer.ts';
const moveUp = '\x1b[1A';
const clearLine = '\x1b[2K';
const clearProgressLine = `${moveUp}${clearLine}`;

const stringifyChunk = (chunk) => {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString();
  return String(chunk);
};

// Loads a fresh module instance, which reads `process.platform` when it is evaluated
const loadProgressFooter = async (platform = process.platform) => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });

  try {
    return (await esmock(modulePath)).default;
  } finally {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
};

const createMockStream = (options = {}) => {
  const writes = [];
  const stream = {
    columns: options.columns || 80,
    write(chunk, encoding, callback) {
      writes.push(chunk);
      if (typeof encoding === 'function') encoding();
      if (callback) callback();
      return true;
    },
  };

  return {
    stream,
    get output() {
      return writes.map(stringifyChunk).join('');
    },
    get chunks() {
      return writes.map(stringifyChunk);
    },
    clear() {
      writes.length = 0;
    },
  };
};

const createFooter = async (options = {}) => {
  const stdout = createMockStream({ columns: options.columns });
  const stderr = createMockStream({ columns: options.columns });
  const createProgressFooter = await loadProgressFooter(options.platform);
  const footer = createProgressFooter({ stdout: stdout.stream, stderr: stderr.stream });

  return { footer, stdout, stderr };
};

describe('test/unit/lib/utils/progress-footer.test.ts', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('writes array progress rows', async () => {
    const { footer, stdout } = await createFooter();

    footer.updateProgress(['first', 'second']);

    expect(stdout.output).to.equal('\nfirst\nsecond\n');
  });

  it('splits string progress rows', async () => {
    const { footer, stdout } = await createFooter();

    footer.updateProgress('first\nsecond');

    expect(stdout.output).to.equal('\nfirst\nsecond\n');
  });

  it('adds animation prefix when enabled', async () => {
    const clock = sinon.useFakeTimers();
    const { footer, stdout } = await createFooter();
    const interval = process.platform === 'win32' ? 100 : 80;

    footer.progressAnimationPrefixFrames = ['a', 'b'];
    footer.shouldAddProgressAnimationPrefix = true;
    footer.updateProgress(['row']);

    expect(stdout.output).to.equal('\na row\n');

    stdout.clear();
    clock.tick(interval);

    expect(stdout.output).to.equal(`${clearProgressLine}${clearProgressLine}\nb row\n`);
    footer.updateProgress();
  });

  it('uses the platform default animation interval', async () => {
    const intervals = [];
    sinon.stub(global, 'setInterval').callsFake((callback, interval) => {
      intervals.push(interval);
      return { unref: sinon.stub() };
    });
    sinon.stub(global, 'clearInterval');

    for (const [platform, expectedInterval] of [
      ['linux', 80],
      ['win32', 100],
    ]) {
      const stdout = createMockStream();
      const stderr = createMockStream();
      const createProgressFooter = await loadProgressFooter(platform);
      const footer = createProgressFooter({ stdout: stdout.stream, stderr: stderr.stream });

      footer.shouldAddProgressAnimationPrefix = true;
      footer.updateProgress('row');
      footer.updateProgress();

      expect(intervals.pop()).to.equal(expectedInterval);
    }
  });

  it('restores process.platform descriptor after platform-specific loading', async () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

    await loadProgressFooter('win32');

    expect(Object.getOwnPropertyDescriptor(process, 'platform')).to.deep.equal(
      originalPlatformDescriptor
    );
  });

  it('accepts null options like the upstream footer', async () => {
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    process.stdout.write = () => true;
    process.stderr.write = () => true;

    try {
      const createProgressFooter = await loadProgressFooter();
      expect(() => createProgressFooter(null)).to.not.throw();
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }
  });

  it('clears rendered rows when progress is cleared', async () => {
    const { footer, stdout } = await createFooter();
    footer.updateProgress(['row']);
    stdout.clear();

    footer.updateProgress();

    expect(stdout.output).to.equal(`${clearProgressLine}${clearProgressLine}`);
  });

  it('clears and redraws progress around stdout writes without recursion', async () => {
    const { footer, stdout } = await createFooter();
    footer.updateProgress('progress');
    stdout.clear();

    stdout.stream.write('log\n');

    expect(stdout.output).to.equal(`${clearProgressLine}${clearProgressLine}log\n\nprogress\n`);
  });

  it('redirects stderr writes through stdout while active', async () => {
    const { footer, stdout, stderr } = await createFooter();
    footer.updateProgress('progress');
    stdout.clear();
    stderr.clear();

    stderr.stream.write('warn\n');

    expect(stderr.output).to.equal('');
    expect(stdout.output).to.equal(`${clearProgressLine}${clearProgressLine}warn\n\nprogress\n`);
  });

  it('tracks partial stdout writes before first progress update', async () => {
    const { footer, stdout } = await createFooter();

    stdout.stream.write('partial');
    footer.updateProgress('progress');

    expect(stdout.output).to.equal('partial\n\nprogress\n');
  });

  it('tracks partial stderr writes before first progress update', async () => {
    const { footer, stdout, stderr } = await createFooter();

    stderr.stream.write('partial');
    footer.updateProgress('progress');

    expect(stderr.output).to.equal('partial');
    expect(stdout.output).to.equal('\n\nprogress\n');
  });

  it('continues tracking partial stdout writes after progress is cleared', async () => {
    const { footer, stdout } = await createFooter();
    footer.updateProgress('progress');
    footer.updateProgress();
    stdout.clear();

    stdout.stream.write('later');
    footer.updateProgress('progress');

    expect(stdout.output).to.equal('later\n\nprogress\n');
  });

  it('continues tracking partial stderr writes after progress is cleared', async () => {
    const { footer, stdout, stderr } = await createFooter();
    footer.updateProgress('progress');
    footer.updateProgress();
    stdout.clear();
    stderr.clear();

    stderr.stream.write('later');
    footer.updateProgress('progress');

    expect(stderr.output).to.equal('later');
    expect(stdout.output).to.equal('\n\nprogress\n');
  });

  it('preserves the upstream leading spacer on first clean progress render', async () => {
    const { footer, stdout } = await createFooter();

    footer.updateProgress('progress');

    expect(stdout.output).to.equal('\nprogress\n');
  });

  it('keeps a blank spacer after partial stdout writes', async () => {
    const { footer, stdout } = await createFooter();
    stdout.stream.write('partial');
    stdout.clear();

    footer.updateProgress('progress');

    expect(stdout.output).to.equal('\n\nprogress\n');
  });

  it('keeps a blank spacer after newline-terminated stdout writes', async () => {
    const { footer, stdout } = await createFooter();
    stdout.stream.write('line\n');
    stdout.clear();

    footer.updateProgress('progress');

    expect(stdout.output).to.equal('\nprogress\n');
  });

  it('does not add an extra spacer after an already empty line', async () => {
    const { footer, stdout } = await createFooter();
    stdout.stream.write('\n\n');
    stdout.clear();

    footer.updateProgress('progress');

    expect(stdout.output).to.equal('progress\n');
  });

  it('preserves split stdout writes without inserting logical newlines', async () => {
    const { footer, stdout } = await createFooter();
    footer.updateProgress('progress');
    stdout.clear();

    stdout.stream.write('he');
    stdout.stream.write('llo\n');

    expect(stdout.chunks).to.include('he');
    expect(stdout.chunks).to.include('llo\n');
    expect(stdout.chunks).to.not.include('he\n');
    expect(stdout.chunks).to.not.include('\nllo\n');
  });

  it('counts multiline and wrapped rows when clearing', async () => {
    const { footer, stdout } = await createFooter({ columns: 3 });
    footer.updateProgress(['abcdef', 'x\ny']);
    stdout.clear();

    footer.updateProgress();

    expect(stdout.output).to.equal(clearProgressLine.repeat(5));
  });

  it('supports write callbacks, Buffer chunks, and Uint8Array chunks', async () => {
    const { footer, stdout } = await createFooter();
    let callbackCalled = false;
    footer.updateProgress('progress');
    stdout.clear();

    stdout.stream.write(Buffer.from('buffer\n'), () => {
      callbackCalled = true;
    });
    stdout.stream.write(new Uint8Array(Buffer.from('bytes\n')));

    expect(callbackCalled).to.equal(true);
    expect(stdout.output).to.include('buffer\n');
    expect(stdout.output).to.include('bytes\n');
  });

  it('does not patch child_process APIs', async () => {
    const originalMethods = {
      exec: childProcess.exec,
      execFile: childProcess.execFile,
      fork: childProcess.fork,
      spawn: childProcess.spawn,
    };
    const { footer } = await createFooter();

    footer.updateProgress('progress');
    footer.updateProgress();

    expect(childProcess.exec).to.equal(originalMethods.exec);
    expect(childProcess.execFile).to.equal(originalMethods.execFile);
    expect(childProcess.fork).to.equal(originalMethods.fork);
    expect(childProcess.spawn).to.equal(originalMethods.spawn);
  });

  it('does not discard stdin, hide the cursor, or install stdin SIGINT forwarding', async () => {
    const stdinDataListeners = process.stdin.listeners('data');
    const stdinSigintListeners = process.stdin.listeners('SIGINT');
    const { footer, stdout } = await createFooter();

    footer.updateProgress('progress');
    footer.updateProgress();

    expect(process.stdin.listeners('data')).to.deep.equal(stdinDataListeners);
    expect(process.stdin.listeners('SIGINT')).to.deep.equal(stdinSigintListeners);
    expect(stdout.output).to.not.include('\x1b[?25l');
    expect(stdout.output).to.not.include('\x1b[?25h');
  });
});
