import fs from 'node:fs';
import path from 'node:path';
import setupFixturesEngine from '../lib/setup-fixtures-engine.ts';

const fixturesEngine = setupFixturesEngine(
  path.resolve(import.meta.dirname, '../fixtures/programmatic')
);

const resolveInsideService = (servicePath, relativePath) => {
  const filePath = path.resolve(servicePath, relativePath);
  const relative = path.relative(servicePath, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Expected path inside fixture service, received ${relativePath}`);
  }
  return filePath;
};

export default async (fixtureName, options = {}) => {
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
