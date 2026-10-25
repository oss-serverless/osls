'use strict';

const p = require('path');
const os = require('os');
const fs = require('fs');
const { randomUUID } = require('node:crypto');

const isObject = require('type/object/is');
const mergePlainObjects = require('../merge-plain-objects');
const { getByPath, setByPath, unsetByPath } = require('../object-path');
const writeFileAtomic = require('write-file-atomic');
const { log } = require('./log');

const logDebug = log.get('config').debug;

let baseFilename = 'serverless';
if (process.env.SERVERLESS_PLATFORM_STAGE && process.env.SERVERLESS_PLATFORM_STAGE !== 'prod') {
  baseFilename = `serverless${process.env.SERVERLESS_PLATFORM_STAGE.toLowerCase()}`;
  baseFilename = baseFilename.trim();
}
baseFilename = `.${baseFilename}rc`;

const getLocalConfigPath = () => p.join(process.cwd(), baseFilename);
const getDefaultGlobalConfigPath = () => p.join(os.homedir(), baseFilename);
const getHomeConfigGlobalConfigPath = () => p.join(os.homedir(), '.config', baseFilename);

const getGlobalConfigPath = () => {
  const homeConfigGlobalConfigPath = getHomeConfigGlobalConfigPath();
  const defaultGlobalConfigPath = getDefaultGlobalConfigPath();
  const homeConfigGlobalConfigExists = fs.existsSync(homeConfigGlobalConfigPath);
  const defaultGlobalConfigExists = fs.existsSync(defaultGlobalConfigPath);

  if (homeConfigGlobalConfigExists && defaultGlobalConfigExists) {
    log.warning(`Found two global configuration files. Using: ${defaultGlobalConfigPath}`);
    return defaultGlobalConfigPath;
  }

  if (homeConfigGlobalConfigExists) {
    return homeConfigGlobalConfigPath;
  }

  return defaultGlobalConfigPath;
};

function storeConfig(config, configPath) {
  config.meta = config.meta || {};
  config.meta.updated_at = Math.round(Date.now() / 1000);

  const jsonConfig = JSON.stringify(config, null, 2);

  try {
    writeFileAtomic.sync(configPath, jsonConfig);
  } catch (error) {
    logDebug(
      `Unable to store serverless config: ${configPath} due to ${error.code} error`,
      error.stack
    );
    return;
  }
  logDebug('Stored config at %s', configPath);
}

function createDefaultGlobalConfig() {
  const defaultConfig = {
    frameworkId: randomUUID(),
    meta: {
      created_at: Math.round(Date.now() / 1000), // config file creation date
      updated_at: null, // config file updated date
    },
  };
  storeConfig(defaultConfig, getDefaultGlobalConfigPath());
  return defaultConfig;
}

function getLocalConfig() {
  const localConfigPath = getLocalConfigPath();
  try {
    return JSON.parse(fs.readFileSync(localConfigPath));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    log.warning(`Cannot resolve local config file.\nError: ${error.message}`);
    try {
      // try/catch to account for very unlikely race condition where file existed
      // during readFileSync but no longer exists during rename
      const backupServerlessrcPath = `${localConfigPath}.bak`;
      fs.renameSync(localConfigPath, backupServerlessrcPath);
      log.warning(
        `Your previous local config was renamed to ${backupServerlessrcPath} for debugging.`
      );
    } catch {
      // Ignore
    }
  }

  return {};
}

function getGlobalConfig() {
  const globalConfigPath = getGlobalConfigPath();
  try {
    return JSON.parse(fs.readFileSync(globalConfigPath));
  } catch (error) {
    // If the file does not exist, we want to recreate default global configuration
    if (error.code !== 'ENOENT') {
      log.warning(
        `Cannot resolve global config file: ${globalConfigPath} \nError: ${error.message}`
      );
      try {
        // try/catch to account for very unlikely race condition where file existed
        // during readFileSync but no longer exists during rename
        const backupServerlessrcPath = `${globalConfigPath}.bak`;
        fs.renameSync(globalConfigPath, backupServerlessrcPath);
        log.warning(
          `Your previous global config was renamed to ${backupServerlessrcPath} for debugging. ` +
            `Default global config will be recreated under ${getDefaultGlobalConfigPath()}`
        );
      } catch {
        // Ignore
      }
    }
  }

  return createDefaultGlobalConfig();
}

function getConfig() {
  const localConfig = getLocalConfig();
  const globalConfig = getGlobalConfig();
  logDebug('Retrieved config from %s and %s', getGlobalConfigPath(), getLocalConfigPath());
  return mergePlainObjects({}, globalConfig, localConfig);
}

function getConfigForUpdate() {
  const localConfigPath = getLocalConfigPath();
  const localConfigExists = fs.existsSync(localConfigPath);
  if (localConfigExists) {
    const result = {
      config: getLocalConfig(),
      configPath: localConfigPath,
    };
    logDebug('Retrieved local config for update at %s', localConfigPath);
    return result;
  }

  const result = {
    config: getGlobalConfig(),
    configPath: getGlobalConfigPath(),
  };
  logDebug('Retrieved global config for update at %s', result.configPath);
  return result;
}

function set(key, value) {
  const configForUpdate = getConfigForUpdate();
  let { config } = configForUpdate;
  const { configPath } = configForUpdate;
  if (key && typeof key === 'string' && typeof value !== 'undefined') {
    setByPath(config, key, value, { arrays: true });
  } else if (isObject(key)) {
    config = mergePlainObjects(config, key);
  } else if (typeof value !== 'undefined') {
    config = mergePlainObjects(config, value);
  }
  storeConfig(config, configPath);
  return getConfig();
}

function deleteValue(key) {
  const configForUpdate = getConfigForUpdate();
  const config = structuredClone(configForUpdate.config);
  const { configPath } = configForUpdate;
  if (key && typeof key === 'string') {
    unsetByPath(config, key);
  } else if (key && Array.isArray(key)) {
    key.forEach((propertyPath) => unsetByPath(config, propertyPath));
  }
  storeConfig(config, configPath);
  return getConfig();
}

function get(path) {
  if (path == null) return undefined;

  const config = getConfig();
  return getByPath(config, path);
}

module.exports = {
  set,
  get,
  delete: deleteValue,
  getConfig,
  CONFIG_FILE_NAME: baseFilename,
};
