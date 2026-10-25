'use strict';

const { pathToFileURL } = require('url');

module.exports = async (modPath) => {
  try {
    const mod = require(modPath);
    return mod && mod.default ? mod.default : mod;
  } catch (error) {
    if (error.code === 'ERR_REQUIRE_ESM') {
      return (await import(pathToFileURL(modPath).href)).default;
    }
    throw error;
  }
};
