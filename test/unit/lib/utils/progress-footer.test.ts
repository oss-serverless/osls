'use strict';

const childProcess = require('child_process');

const sinon = require('sinon');
const { expect } = require('chai');

const modulePath = '../../../../lib/utils/progress-footer';
const moveUp = '\x1b[1A';
const clearLine = '\x1b[2K';
const clearProgressLine = `${moveUp}${clearLine}`;

const stringifyChunk = (chunk) => {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString();
  return String(chunk);
};

const loadProgressFooter = (platform = process.platform) => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  delete require.cache[require.resolve(modulePath)];
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });

  try {
    return require(modulePath);
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

const createFooter = (options = {}) => {
  const stdout = createMockStream({ columns: options.columns });
  const stderr = createMockStream({ columns: options.columns });
  const createProgressFooter = loadProgressFooter(options.platform);
  const footer = createProgressFooter({ stdout: stdout.stream, stderr: stderr.stream });

  return { footer, stdout, stderr };
};

describe('test/unit/lib/utils/progress-footer.test.js', () => {
  afterEach(() => {
    delete require.cache[require.resolve(modulePath)];
    sinon.restore();
  });

  it('writes array progress rows', () => {
    const { footer, stdout } = createFooter();

    footer.updateProgress(['first', 'second']);

    expect(stdout.output).to.equal('\nfirst\nsecond\n');
  });

  it('splits string progress rows', () => {
    const { footer, stdout } = createFooter();

    footer.updateProgress('first\nsecond');

    expect(stdout.output).to.equal('\nfirst\nsecond\n');
  });

  it('adds animation prefix when enabled', () => {
    const clock = sinon.useFakeTimers();
    const { footer, stdout } = createFooter();
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

  it('uses the platform default animation interval', () => {
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
      const createProgressFooter = loadProgressFooter(platform);
      const footer = createProgressFooter({ stdout: stdout.stream, stderr: stderr.stream });

      footer.shouldAddProgressAnimationPrefix = true;
      footer.updateProgress('row');
      footer.updateProgress();

      expect(intervals.pop()).to.equal(expectedInterval);
      delete require.cache[require.resolve(modulePath)];
    }
  });

  it('restores process.platform descriptor after platform-specific loading', () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

    loadProgressFooter('win32');

    expect(Object.getOwnPropertyDescriptor(process, 'platform')).to.deep.equal(
      originalPlatformDescriptor
    );
  });

  it('accepts null options like the upstream footer', () => {
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    process.stdout.write = () => true;
    process.stderr.write = () => true;

    try {
      expect(() => loadProgressFooter()(null)).to.not.throw();
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }
  });

  it('clears rendered rows when progress is cleared', () => {
    const { footer, stdout } = createFooter();
    footer.updateProgress(['row']);
    stdout.clear();

    footer.updateProgress();

    expect(stdout.output).to.equal(`${clearProgressLine}${clearProgressLine}`);
  });

  it('clears and redraws progress around stdout writes without recursion', () => {
    const { footer, stdout } = createFooter();
    footer.updateProgress('progress');
    stdout.clear();

    stdout.stream.write('log\n');

    expect(stdout.output).to.equal(`${clearProgressLine}${clearProgressLine}log\n\nprogress\n`);
  });

  it('redirects stderr writes through stdout while active', () => {
    const { footer, stdout, stderr } = createFooter();
    footer.updateProgress('progress');
    stdout.clear();
    stderr.clear();

    stderr.stream.write('warn\n');

    expect(stderr.output).to.equal('');
    expect(stdout.output).to.equal(`${clearProgressLine}${clearProgressLine}warn\n\nprogress\n`);
  });

  it('tracks partial stdout writes before first progress update', () => {
    const { footer, stdout } = createFooter();

    stdout.stream.write('partial');
    footer.updateProgress('progress');

    expect(stdout.output).to.equal('partial\n\nprogress\n');
  });

  it('tracks partial stderr writes before first progress update', () => {
    const { footer, stdout, stderr } = createFooter();

    stderr.stream.write('partial');
    footer.updateProgress('progress');

    expect(stderr.output).to.equal('partial');
    expect(stdout.output).to.equal('\n\nprogress\n');
  });

  it('continues tracking partial stdout writes after progress is cleared', () => {
    const { footer, stdout } = createFooter();
    footer.updateProgress('progress');
    footer.updateProgress();
    stdout.clear();

    stdout.stream.write('later');
    footer.updateProgress('progress');

    expect(stdout.output).to.equal('later\n\nprogress\n');
  });

  it('continues tracking partial stderr writes after progress is cleared', () => {
    const { footer, stdout, stderr } = createFooter();
    footer.updateProgress('progress');
    footer.updateProgress();
    stdout.clear();
    stderr.clear();

    stderr.stream.write('later');
    footer.updateProgress('progress');

    expect(stderr.output).to.equal('later');
    expect(stdout.output).to.equal('\n\nprogress\n');
  });

  it('preserves the upstream leading spacer on first clean progress render', () => {
    const { footer, stdout } = createFooter();

    footer.updateProgress('progress');

    expect(stdout.output).to.equal('\nprogress\n');
  });

  it('keeps a blank spacer after partial stdout writes', () => {
    const { footer, stdout } = createFooter();
    stdout.stream.write('partial');
    stdout.clear();

    footer.updateProgress('progress');

    expect(stdout.output).to.equal('\n\nprogress\n');
  });

  it('keeps a blank spacer after newline-terminated stdout writes', () => {
    const { footer, stdout } = createFooter();
    stdout.stream.write('line\n');
    stdout.clear();

    footer.updateProgress('progress');

    expect(stdout.output).to.equal('\nprogress\n');
  });

  it('does not add an extra spacer after an already empty line', () => {
    const { footer, stdout } = createFooter();
    stdout.stream.write('\n\n');
    stdout.clear();

    footer.updateProgress('progress');

    expect(stdout.output).to.equal('progress\n');
  });

  it('preserves split stdout writes without inserting logical newlines', () => {
    const { footer, stdout } = createFooter();
    footer.updateProgress('progress');
    stdout.clear();

    stdout.stream.write('he');
    stdout.stream.write('llo\n');

    expect(stdout.chunks).to.include('he');
    expect(stdout.chunks).to.include('llo\n');
    expect(stdout.chunks).to.not.include('he\n');
    expect(stdout.chunks).to.not.include('\nllo\n');
  });

  it('counts multiline and wrapped rows when clearing', () => {
    const { footer, stdout } = createFooter({ columns: 3 });
    footer.updateProgress(['abcdef', 'x\ny']);
    stdout.clear();

    footer.updateProgress();

    expect(stdout.output).to.equal(clearProgressLine.repeat(5));
  });

  it('supports write callbacks, Buffer chunks, and Uint8Array chunks', () => {
    const { footer, stdout } = createFooter();
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

  it('does not patch child_process APIs', () => {
    const originalMethods = {
      exec: childProcess.exec,
      execFile: childProcess.execFile,
      fork: childProcess.fork,
      spawn: childProcess.spawn,
    };
    const { footer } = createFooter();

    footer.updateProgress('progress');
    footer.updateProgress();

    expect(childProcess.exec).to.equal(originalMethods.exec);
    expect(childProcess.execFile).to.equal(originalMethods.execFile);
    expect(childProcess.fork).to.equal(originalMethods.fork);
    expect(childProcess.spawn).to.equal(originalMethods.spawn);
  });

  it('does not discard stdin, hide the cursor, or install stdin SIGINT forwarding', () => {
    const stdinDataListeners = process.stdin.listeners('data');
    const stdinSigintListeners = process.stdin.listeners('SIGINT');
    const { footer, stdout } = createFooter();

    footer.updateProgress('progress');
    footer.updateProgress();

    expect(process.stdin.listeners('data')).to.deep.equal(stdinDataListeners);
    expect(process.stdin.listeners('SIGINT')).to.deep.equal(stdinSigintListeners);
    expect(stdout.output).to.not.include('\x1b[?25l');
    expect(stdout.output).to.not.include('\x1b[?25h');
  });
});
