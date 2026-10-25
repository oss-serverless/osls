'use strict';

module.exports = (callback) => {
  const originalCache = { ...require.cache };

  const restore = () => {
    for (const moduleId of Object.keys(require.cache)) {
      delete require.cache[moduleId];
    }

    Object.assign(require.cache, originalCache);
  };

  for (const moduleId of Object.keys(require.cache)) {
    delete require.cache[moduleId];
  }

  try {
    const result = callback();

    if (result && typeof result.then === 'function') {
      return Promise.resolve(result).finally(restore);
    }

    restore();

    return result;
  } catch (error) {
    restore();
    throw error;
  }
};
