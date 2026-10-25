'use strict';

const ensureString = require('type/string/ensure');
const ensurePlainFunction = require('type/plain-function/ensure');
const ensurePlainObject = require('type/plain-object/ensure');
const path = require('path');
const runServerless = require('./run-serverless');
const setupFixturesEngine = require('./setup-fixtures-engine');

module.exports = (setupOptions) => {
  const fixturesDir = path.resolve(ensureString(ensurePlainObject(setupOptions).fixturesDir));
  const resolveServerlessDir = (() => {
    if (ensurePlainFunction(setupOptions.resolveServerlessDir, { isOptional: true })) {
      return setupOptions.resolveServerlessDir;
    }
    const serverlessDir = path.resolve(ensureString(setupOptions.serverlessDir));
    return () => serverlessDir;
  })();

  return async (options) => {
    const runServerlessOptions = Object.assign({}, options);
    delete runServerlessOptions.serverlessDir;
    delete runServerlessOptions.fixture;
    delete runServerlessOptions.configExt;
    let fixtureData;
    if (options.fixture) {
      fixtureData = await setupFixturesEngine(fixturesDir).setup(options.fixture, {
        configExt: options.configExt,
      });
      runServerlessOptions.cwd = fixtureData.servicePath;
    }
    try {
      const result = await runServerless(
        options.serverlessDir || (await resolveServerlessDir()),
        runServerlessOptions
      );
      result.fixtureData = fixtureData;
      return result;
    } catch (error) {
      error.fixtureData = fixtureData;
      throw error;
    }
  };
};
