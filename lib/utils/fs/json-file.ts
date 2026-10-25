'use strict';

const fsp = require('fs').promises;

const stripBom = (contents) => contents.replace(/^\uFEFF/u, '');

const readJson = async (filePath) => {
  const contents = await fsp.readFile(filePath, 'utf8');
  try {
    return JSON.parse(stripBom(contents));
  } catch (error) {
    error.message = `${filePath}: ${error.message}`;
    throw error;
  }
};

const writeJson = async (filePath, value) => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError(`Converting ${typeof value} value to JSON is not supported`);
  }
  await fsp.writeFile(filePath, `${serialized}\n`);
};

module.exports = { readJson, writeJson };
