'use strict';

const path = require('path');

const runWithRestore = (callback, callbackArgs, restore) => {
  let result;

  try {
    result = callback(...callbackArgs);
  } catch (error) {
    restore();
    throw error;
  }

  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).finally(restore);
  }

  restore();
  return result;
};

const createEnv = (options = {}) => {
  if (!options || typeof options !== 'object') options = {};

  if (options.asCopy && options.whitelist) {
    throw new Error('Either `asCopy` or `whitelist` option is expected but not both');
  }

  const env = new Proxy(
    {},
    {
      set(target, key, value) {
        Object.defineProperty(target, key, {
          configurable: true,
          enumerable: true,
          value: `${value}`,
          writable: true,
        });
        return true;
      },
      defineProperty(target, key, descriptor) {
        Object.defineProperty(target, key, {
          configurable: true,
          enumerable: true,
          value: `${descriptor.value}`,
          writable: true,
        });
        return true;
      },
    }
  );

  if (options.asCopy) {
    for (const [name, value] of Object.entries(process.env)) {
      env[name] = value;
    }
  }

  if (options.whitelist) {
    for (const name of options.whitelist) {
      if (Object.prototype.hasOwnProperty.call(process.env, name)) {
        env[name] = process.env[name];
      }
    }
  }

  if (options.variables) {
    for (const [name, value] of Object.entries(options.variables)) {
      env[name] = value;
    }
  }

  return env;
};

const overrideEnv = (options = {}, callback = null) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  const originalEnv = process.env;
  process.env = createEnv(options);

  const restoreEnv = () => {
    process.env = originalEnv;
  };

  if (!callback) return { originalEnv, restoreEnv };
  return runWithRestore(callback, [originalEnv], restoreEnv);
};

const overrideCwd = (counterpart, callback = null) => {
  const originalCwd = process.cwd();
  process.chdir(path.resolve(String(counterpart)));

  const restoreCwd = () => {
    process.chdir(originalCwd);
  };

  if (!callback) return { originalCwd, restoreCwd };
  return runWithRestore(callback, [originalCwd], restoreCwd);
};

const overrideArgv = (options = {}, callback = null) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  const originalArgv = process.argv;
  const sliceAt = options.sliceAt == null ? 1 : Number(options.sliceAt);
  if (!Number.isInteger(sliceAt) || sliceAt < 0) {
    throw new TypeError('`sliceAt` expected to be a non-negative integer');
  }
  const argv = process.argv.slice(0, sliceAt);

  if (options.args) {
    argv.push(...Array.from(options.args, String));
  }

  process.argv = argv;

  const restoreArgv = () => {
    process.argv = originalArgv;
  };

  if (!callback) return { originalArgv, restoreArgv };
  return runWithRestore(callback, [originalArgv], restoreArgv);
};

const overrideStreamWrite = (stream, restoreKey, customWrite, callback = null) => {
  const originalWrite = stream.write;
  const originalStdWrite = originalWrite.bind(stream);

  stream.write = function write(data, encoding, cb) {
    return customWrite.call(this, data, originalStdWrite, encoding, cb);
  };

  const restore = () => {
    stream.write = originalWrite;
  };

  if (!callback) {
    return {
      originalWrite,
      [restoreKey.replace('restore', 'original')]: originalStdWrite,
      [restoreKey]: restore,
    };
  }

  return runWithRestore(callback, [originalStdWrite, originalWrite], restore);
};

const overrideStdoutWrite = (customWrite, callback = null) =>
  overrideStreamWrite(process.stdout, 'restoreStdoutWrite', customWrite, callback);

module.exports = {
  createEnv,
  overrideArgv,
  overrideCwd,
  overrideEnv,
  overrideStdoutWrite,
};
