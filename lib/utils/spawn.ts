'use strict';

const spawn = require('cross-spawn');
const { PassThrough } = require('stream');
const { validateSpawnInput } = require('./spawn-policy');

const sensitiveOptionNamePattern =
  /(?:^|[-_])(?:auth|authorization|credential|password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key)(?:$|[-_])/i;

const toBuffer = (chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

const createBufferState = () => ({
  buffer: Buffer.alloc(0),
  chunks: [],
  dirty: false,
  length: 0,
});

const appendBuffer = (state, chunk) => {
  const buffer = toBuffer(chunk);

  state.chunks.push(buffer);
  state.length += buffer.length;
  state.dirty = true;

  return buffer;
};

const getBuffer = (state) => {
  if (state.dirty) {
    state.buffer = Buffer.concat(state.chunks, state.length);
    state.dirty = false;
  }

  return state.buffer;
};

const redactArgs = (args) => {
  const redactedArgs = [];
  let redactNext = false;

  for (const arg of args) {
    const value = String(arg);

    if (redactNext) {
      redactedArgs.push('<redacted>');
      redactNext = false;
      continue;
    }

    const equalsIndex = value.indexOf('=');
    const optionName = value.replace(/^-+/, '').split('=')[0];

    if (equalsIndex !== -1 && sensitiveOptionNamePattern.test(optionName)) {
      redactedArgs.push(`${value.slice(0, equalsIndex + 1)}<redacted>`);
      continue;
    }

    if (value.startsWith('-') && sensitiveOptionNamePattern.test(optionName)) {
      redactedArgs.push(value);
      redactNext = true;
      continue;
    }

    redactedArgs.push(value);
  }

  return redactedArgs;
};

module.exports = (command, args = [], options = {}) => {
  if (args == null) args = [];
  options = options || {};
  validateSpawnInput(command, args, options);

  const normalizedCommand = String(command);
  const normalizedArgs = args.map(String);
  const { shouldCloseStdin, input, ...spawnOptions } = options;

  const child = spawn(normalizedCommand, normalizedArgs, spawnOptions);
  const result = {
    child,
    stdout: child.stdout || null,
    stderr: child.stderr || null,
    std: child.stdout || child.stderr ? new PassThrough() : null,
    code: undefined,
    signal: undefined,
  };
  if (result.std) result.std.resume();

  const stdoutState = createBufferState();
  const stderrState = createBufferState();
  const stdState = createBufferState();
  const outputStreams = [result.stdout, result.stderr].filter(Boolean);
  const discardStdData = () => {};
  let settled = false;
  let waitingForStdDrain = false;
  const pausedForStd = new Set();

  const resumeStdPausedStreams = () => {
    waitingForStdDrain = false;

    for (const stream of pausedForStd) {
      stream.resume();
    }

    pausedForStd.clear();
  };

  const hasActiveStdConsumer = () =>
    result.std &&
    (result.std.listenerCount('data') > 1 || result.std.listenerCount('readable') > 0);

  const pauseForStdBackpressure = () => {
    for (const stream of outputStreams) {
      if (!stream.isPaused || stream.isPaused()) continue;
      stream.pause();
      pausedForStd.add(stream);
    }

    if (!waitingForStdDrain) {
      waitingForStdDrain = true;
      result.std.once('drain', resumeStdPausedStreams);
    }
  };

  const writeStd = (chunk) => {
    if (!result.std || result.std.destroyed || result.std.writableEnded) return;

    if (result.std.write(chunk) === false) {
      if (hasActiveStdConsumer()) {
        pauseForStdBackpressure();
      } else {
        result.std.resume();
      }
    }
  };

  const snapshot = () => ({
    child: result.child,
    stdout: result.stdout,
    stderr: result.stderr,
    std: result.std,
    stdoutBuffer: getBuffer(stdoutState),
    stderrBuffer: getBuffer(stderrState),
    stdBuffer: getBuffer(stdState),
    code: result.code,
    signal: result.signal,
  });

  const endStd = () => {
    if (result.std && !result.std.destroyed && !result.std.writableEnded) {
      result.std.end();
    }

    resumeStdPausedStreams();
  };

  if (result.std) {
    result.std.on('data', discardStdData);
    result.std.once('close', resumeStdPausedStreams);
    result.std.once('error', resumeStdPausedStreams);
  }

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      const buffer = appendBuffer(stdoutState, chunk);
      appendBuffer(stdState, buffer);
      writeStd(buffer);
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      const buffer = appendBuffer(stderrState, chunk);
      appendBuffer(stdState, buffer);
      writeStd(buffer);
    });
  }

  const promise = new Promise((resolve, reject) => {
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      endStd();
      const metadata = snapshot();
      if (metadata.code === undefined) delete metadata.code;
      if (metadata.signal === undefined) delete metadata.signal;
      Object.assign(error, metadata);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      result.code = code;
      result.signal = signal;
      endStd();

      if (code === 0) {
        resolve(snapshot());
        return;
      }

      const reason = signal ? `signal ${signal}` : `code ${code}`;
      const error = new Error(
        `\`${[normalizedCommand, ...redactArgs(normalizedArgs)].join(' ')}\` Exited with ${reason}`
      );
      error.code = code;
      error.signal = signal;
      Object.assign(error, snapshot());
      reject(error);
    });

    if (input != null && child.stdin) {
      child.stdin.end(input);
    } else if (shouldCloseStdin && child.stdin) {
      child.stdin.end();
    }
  });

  return Object.defineProperties(promise, {
    child: { enumerable: true, get: () => result.child },
    stdout: { enumerable: true, get: () => result.stdout },
    stderr: { enumerable: true, get: () => result.stderr },
    std: { enumerable: true, get: () => result.std },
    stdoutBuffer: { enumerable: true, get: () => getBuffer(stdoutState) },
    stderrBuffer: { enumerable: true, get: () => getBuffer(stderrState) },
    stdBuffer: { enumerable: true, get: () => getBuffer(stdState) },
    code: { enumerable: true, get: () => result.code },
    signal: { enumerable: true, get: () => result.signal },
  });
};
