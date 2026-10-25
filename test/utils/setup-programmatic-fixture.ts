'use strict';

const fs = require('node:fs');
const path = require('node:path');
const setupFixturesEngine = require('../lib/setup-fixtures-engine');

const fixturesEngine = setupFixturesEngine(path.resolve(__dirname, '../fixtures/programmatic'));

const resolveInsideService = (servicePath, relativePath) => {
  const filePath = path.resolve(servicePath, relativePath);
  const relative = path.relative(servicePath, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Expected path inside fixture service, received ${relativePath}`);
  }
  return filePath;
};

module.exports = async (fixtureName, options = {}) => {
  const { configExt, serviceName, files = [] } = options;
  if (serviceName && configExt && Object.hasOwn(configExt, 'service')) {
    throw new Error('Use either `serviceName` or `configExt.service`, not both');
  }

  const fixtureData = await fixturesEngine.setup(fixtureName, { configExt });
  if (serviceName) await fixtureData.updateConfig({ service: serviceName });

  const writeFile = async (to, contents) => {
    const filePath = resolveInsideService(fixtureData.servicePath, to);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, contents);
    return filePath;
  };

  for (const file of files) await writeFile(file.to, file.contents);

  return { ...fixtureData, writeFile };
};
