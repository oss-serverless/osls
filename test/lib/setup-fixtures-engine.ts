'use strict';

const path = require('path');
const ensureString = require('type/string/ensure');
const ensurePlainObject = require('type/plain-object/ensure');
const ensurePlainFunction = require('type/plain-function/ensure');
const fs = require('fs');
const fsp = fs.promises;
const wait = require('../../lib/utils/sleep');
const spawn = require('../../lib/utils/spawn');
const memoizee = require('memoizee');
const log = require('log').get('serverless:test');
const { load: loadYaml, dump: saveYaml } = require('js-yaml');
const cloudformationSchema = require('../../lib/utils/serverless-utils/cloudformation-schema');
const mergePlainObjects = require('../../lib/utils/merge-plain-objects');
const provisionTmpDir = require('./provision-tmp-dir');

const isFixtureConfigured = memoizee((fixturePath) => {
  let stats;
  try {
    stats = fs.statSync(fixturePath);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  return Boolean(stats.isDirectory());
});

const isFile = (filename) =>
  fsp.lstat(filename).then(
    (stats) => {
      if (!stats.isFile()) return false;
      return true;
    },
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  );

const npmInstall = async (cwd, attempt = 0) => {
  if (attempt) {
    try {
      await fsp.rm(path.resolve(cwd, 'node_modules'), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  try {
    await spawn('npm', ['install'], { cwd });
  } catch (error) {
    if (attempt < 3) {
      const { code, stdoutBuffer } = error;
      if (code === 1) {
        if (String(stdoutBuffer).includes('cb() never called!')) {
          await wait(2000);
          await npmInstall(cwd, attempt + 1);
          return;
        }
      }
    }
    throw error;
  }
};

const setupFixture = memoizee(
  async (fixturePath) => {
    const [hasSetupScript, hasNpmDependencies] = await Promise.all([
      isFile(path.resolve(fixturePath, '_setup.js')),
      isFile(path.resolve(fixturePath, 'package.json')),
    ]);
    if (!hasSetupScript && !hasNpmDependencies) return fixturePath;
    const setupFixturePath = await provisionTmpDir();
    await fsp.cp(fixturePath, setupFixturePath, { recursive: true });
    if (hasNpmDependencies) {
      log.notice(
        'install dependencies for %s (at %s)',
        path.basename(fixturePath),
        setupFixturePath
      );
      await npmInstall(setupFixturePath);
    }
    if (!hasSetupScript) return setupFixturePath;
    log.notice('run setup for %s (at %s)', path.basename(fixturePath), setupFixturePath);
    const setupScriptPath = path.resolve(setupFixturePath, '_setup.js');
    await ensurePlainFunction(require(setupScriptPath))(fixturePath);
    await fsp.unlink(setupScriptPath);
    return setupFixturePath;
  },
  { promise: true }
);

const nameTimeBase = new Date(2020, 8, 7).getTime();

module.exports = memoizee((fixturesPath) => {
  return {
    setup: async (fixtureName, options = {}) => {
      const baseFixturePath = path.join(fixturesPath, ensureString(fixtureName));
      if (!isFixtureConfigured(baseFixturePath)) {
        throw new Error(`No fixture configured at ${fixtureName}`);
      }
      if (!options) options = {};

      const [fixturePath, setupFixturePath] = await Promise.all([
        provisionTmpDir(),
        setupFixture(baseFixturePath),
      ]);
      let configObject;
      const [configContent] = await Promise.all([
        fsp.readFile(path.join(setupFixturePath, 'serverless.yml')).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        }),
        fsp.cp(setupFixturePath, fixturePath, { recursive: true }),
      ]);
      configObject =
        configContent &&
        (() => {
          try {
            return loadYaml(configContent, { schema: cloudformationSchema });
          } catch {
            return null;
          }
        })();
      let isConfigUpdated = false;
      if (configObject && configObject.service) {
        configObject.service = `test-${fixtureName}-${(Date.now() - nameTimeBase).toString(32)}`;
        isConfigUpdated = true;
      }
      if (options.configExt) {
        configObject = mergePlainObjects(configObject || {}, options.configExt);
        isConfigUpdated = true;
      }
      if (isConfigUpdated) {
        await fsp.writeFile(path.join(fixturePath, 'serverless.yml'), saveYaml(configObject));
      }
      log.info('setup %s fixture at %s', fixtureName, fixturePath);
      return {
        servicePath: fixturePath,
        serviceConfig: configObject,
        updateConfig: (configExt) => {
          ensurePlainObject(configExt);
          mergePlainObjects(configObject, configExt);
          return fsp.writeFile(path.join(fixturePath, 'serverless.yml'), saveYaml(configObject));
        },
      };
    },
  };
});
