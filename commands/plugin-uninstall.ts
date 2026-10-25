import spawn from '../lib/utils/spawn.ts';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import isPlainObject from 'type/plain-object/is.js';
import * as yaml from 'js-yaml';
import cloudformationSchema from '../lib/utils/serverless-utils/cloudformation-schema.ts';
import { log, progress, style } from '../lib/utils/serverless-utils/log.ts';
import yamlAstParser from '../lib/utils/yaml-ast-parser.ts';
import npmCommandDeferred from '../lib/utils/npm-command-deferred.ts';
import { readJson, writeJson } from '../lib/utils/fs/json-file.ts';
import pluginManagement from '../lib/commands/plugin-management.ts';

const { getServerlessFilePath, parsePluginUninstallSpec, validate } = pluginManagement;

const mainProgress = progress.get('main');

export default async ({ configuration, serviceDir, configurationFilename, options }) => {
  const commandRunStartTime = Date.now();
  validate({ serviceDir });

  const pluginInfo = parsePluginUninstallSpec(options.name);
  const pluginName = pluginInfo.name;
  const configurationFilePath = getServerlessFilePath({ serviceDir, configurationFilename });

  const context = { configuration, serviceDir, configurationFilePath, pluginName };
  mainProgress.notice(`Uninstalling plugin "${pluginName}"`, { isMainEvent: true });
  await uninstallPlugin(context);
  await removePluginFromServerlessFile(context);

  log.notice();
  log.notice.success(
    `Plugin "${pluginName}" uninstalled ${style.aside(
      `(${Math.floor((Date.now() - commandRunStartTime) / 1000)}s)`
    )}`
  );
};

const uninstallPlugin = async ({ serviceDir, pluginName }) => {
  await npmUninstall(pluginName, { serviceDir });
};

const removePluginFromServerlessFile = async ({ configurationFilePath, pluginName }) => {
  const fileExtension = path.extname(configurationFilePath);
  if (fileExtension === '.js' || fileExtension === '.ts') {
    requestManualUpdate(configurationFilePath);
    return;
  }

  if (fileExtension === '.json') {
    const serverlessFileObj = await readJson(configurationFilePath);
    const isArrayPluginsObject = Array.isArray(serverlessFileObj.plugins);
    const plugins = isArrayPluginsObject
      ? serverlessFileObj.plugins
      : serverlessFileObj.plugins && serverlessFileObj.plugins.modules;

    if (plugins) {
      for (let index = plugins.indexOf(pluginName); index !== -1;) {
        plugins.splice(index, 1);
        index = plugins.indexOf(pluginName);
      }
      if (!plugins.length) {
        if (isArrayPluginsObject) {
          delete serverlessFileObj.plugins;
        } else {
          delete serverlessFileObj.plugins.modules;
        }
      }
      await writeJson(configurationFilePath, serverlessFileObj);
    }
    return;
  }

  const serverlessFileObj = yaml.load(await fsp.readFile(configurationFilePath, 'utf8'), {
    filename: configurationFilePath,
    schema: cloudformationSchema,
  });
  if (serverlessFileObj.plugins != null) {
    // Plugins section can be behind variables, opt-out in such case
    if (isPlainObject(serverlessFileObj.plugins)) {
      if (
        serverlessFileObj.plugins.modules != null &&
        !Array.isArray(serverlessFileObj.plugins.modules)
      ) {
        requestManualUpdate(configurationFilePath);
        return;
      }
    } else if (!Array.isArray(serverlessFileObj.plugins)) {
      requestManualUpdate(configurationFilePath);
      return;
    }
  }
  await yamlAstParser.removeExistingArrayItem(
    configurationFilePath,
    Array.isArray(serverlessFileObj.plugins) ? 'plugins' : 'plugins.modules',
    pluginName
  );
};

const npmUninstall = async (name, { serviceDir }) => {
  const { command, args } = await npmCommandDeferred;
  try {
    await spawn(command, [...args, 'uninstall', '--save-dev', '--', name], {
      cwd: serviceDir,
      stdio: 'pipe',
    });
  } catch (error) {
    log.error(String(error.stderrBuffer));
    throw error;
  }
};

const requestManualUpdate = (configurationFilePath) => {
  log.notice();
  log.notice.skip(
    `Can't automatically remove plugin from "${path.basename(
      configurationFilePath
    )}" file. Please make it manually.`
  );
};
