import spawn from '../lib/utils/spawn.ts';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import isPlainObject from 'type/plain-object/is.js';
import * as yaml from 'js-yaml';
import cloudformationSchema from '../lib/utils/serverless-utils/cloudformation-schema.ts';
import { log, progress, style } from '../lib/utils/serverless-utils/log.ts';
import ServerlessError from '../lib/serverless-error.ts';
import yamlAstParser from '../lib/utils/yaml-ast-parser.ts';
import npmCommandDeferred from '../lib/utils/npm-command-deferred.ts';
import { readJson, writeJson } from '../lib/utils/fs/json-file.ts';
import pluginManagement from '../lib/commands/plugin-management.ts';

const { getServerlessFilePath, parsePluginInstallSpec, validate } = pluginManagement;

const mainProgress = progress.get('main');

export default async ({ configuration, serviceDir, configurationFilename, options }) => {
  const commandRunStartTime = Date.now();
  validate({ serviceDir });

  const pluginInfo = parsePluginInstallSpec(options.name);
  const pluginName = pluginInfo.name;
  const pluginVersion = pluginInfo.version;
  const configurationFilePath = getServerlessFilePath({ serviceDir, configurationFilename });

  const context = {
    configuration,
    serviceDir,
    configurationFilePath,
    pluginName,
    pluginVersion,
    installSpec: pluginInfo.installSpec,
    allowInstallScripts: Boolean(options['allow-install-scripts']),
  };
  mainProgress.notice(
    `Installing plugin "${pluginName}${pluginVersion === 'latest' ? '' : `@${pluginVersion}`}"`,
    { isMainEvent: true }
  );
  await installPlugin(context);
  // Check if plugin is already added
  const pluginAlreadyPresentInConfig =
    (Array.isArray(configuration.plugins && configuration.plugins.modules) &&
      configuration.plugins.modules.includes(pluginName)) ||
    (Array.isArray(configuration.plugins) && configuration.plugins.includes(pluginName));
  if (!pluginAlreadyPresentInConfig) {
    await addPluginToServerlessFile(context);
  }

  log.notice();
  log.notice.success(
    `Plugin "${pluginName}${
      pluginVersion === 'latest' ? '' : `@${pluginVersion}`
    }" installed  ${style.aside(`(${Math.floor((Date.now() - commandRunStartTime) / 1000)}s)`)}`
  );
};

const installPlugin = async ({ serviceDir, installSpec, allowInstallScripts }) => {
  await npmInstall(installSpec, { serviceDir, allowInstallScripts });
};

const addPluginToServerlessFile = async ({ configurationFilePath, pluginName }) => {
  const fileExtension = path.extname(configurationFilePath);
  if (fileExtension === '.js' || fileExtension === '.ts') {
    requestManualUpdate(configurationFilePath);
    return;
  }

  const checkIsArrayPluginsObject = (pluginsObject) =>
    pluginsObject == null || Array.isArray(pluginsObject);
  // pluginsObject type determined based on the value loaded during the serverless init.
  if (fileExtension === '.json') {
    const serverlessFileObj = await readJson(configurationFilePath);
    const newServerlessFileObj = serverlessFileObj;
    const isArrayPluginsObject = checkIsArrayPluginsObject(newServerlessFileObj.plugins);
    // null modules property is not supported
    const plugins = isArrayPluginsObject
      ? newServerlessFileObj.plugins || []
      : newServerlessFileObj.plugins.modules;

    if (plugins == null) {
      throw new ServerlessError(
        'plugins modules property must be present',
        'PLUGINS_MODULES_MISSING'
      );
    }

    if (!plugins.includes(pluginName)) {
      plugins.push(pluginName);
    }

    if (isArrayPluginsObject) {
      newServerlessFileObj.plugins = plugins;
    } else {
      newServerlessFileObj.plugins.modules = plugins;
    }

    await writeJson(configurationFilePath, newServerlessFileObj);
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
  await yamlAstParser.addNewArrayItem(
    configurationFilePath,
    checkIsArrayPluginsObject(serverlessFileObj.plugins) ? 'plugins' : 'plugins.modules',
    pluginName
  );
};

const npmInstall = async (name, { serviceDir, allowInstallScripts }) => {
  const { command, args } = await npmCommandDeferred;
  const installArgs = ['install', '--save-dev'];

  if (!allowInstallScripts) {
    installArgs.push('--ignore-scripts');
  }

  try {
    await spawn(command, [...args, ...installArgs, '--', name], {
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
    `Can't automatically add plugin into "${path.basename(
      configurationFilePath
    )}" file. Please add it manually.`
  );
};
