'use strict';

const ensureString = require('type/string/ensure');
const ensureIterable = require('type/iterable/ensure');
const ensurePlainObject = require('type/plain-object/ensure');
const ensurePlainFunction = require('type/plain-function/ensure');
const { realpathSync } = require('fs');
const path = require('path');
const os = require('os');
const { overrideEnv, overrideCwd, overrideArgv } = require('../utils/process');
const sinon = require('sinon');
const resolveEnv = require('./resolve-env');
const observeOutput = require('./observe-output');
const provisionTmpDir = require('./provision-tmp-dir');
const configureAwsSdkV3Stub = require('./configure-aws-sdk-v3-stub');
const { writeJsonFile } = require('../utils/fs');

const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);

const resolveModuleRealPath = (basePath, moduleId) =>
  realpathSync(require.resolve(moduleId, { paths: [basePath] }));

const resolveServerless = async (serverlessPath, modulesCacheStub, callback) => {
  if (!modulesCacheStub) {
    return callback(require(serverlessPath));
  }

  const originalCache = Object.assign({}, require.cache);
  for (const key of Object.keys(require.cache)) delete require.cache[key];
  for (const [key, value] of Object.entries(modulesCacheStub)) {
    require.cache[path.isAbsolute(key) ? key : resolveModuleRealPath(serverlessPath, key)] = {
      exports: value,
    };
  }

  const restore = () => {
    for (const key of Object.keys(require.cache)) delete require.cache[key];
    Object.assign(require.cache, originalCache);
  };
  try {
    return await callback(require(serverlessPath));
  } finally {
    restore();
  }
};

const resolveCwd = async ({ cwd, config }) => {
  if (cwd) return cwd;
  const tmpDirPath = await provisionTmpDir();
  await writeJsonFile(path.join(tmpDirPath, 'serverless.json'), config);
  return tmpDirPath;
};

module.exports = async (
  serverlessPath,
  {
    awsSdkV3StubMap,
    command,
    options,
    config,
    cwd,
    env,
    envWhitelist,
    hooks,
    lastLifecycleHookName,
    modulesCacheStub,
    noService,
    shouldStubSpawn,
  }
) => {
  serverlessPath = path.resolve(
    ensureString(serverlessPath, {
      errorMessage: "Expected 'serverlessPath' to be a string. Received: %v",
    })
  );
  try {
    require.resolve(serverlessPath);
  } catch (error) {
    throw new TypeError(
      `Provided 'serverlessPath' (${serverlessPath}) ` +
        `doesn't point a working node module: ${error.message}`,
      { cause: error }
    );
  }
  cwd = ensureString(cwd, {
    isOptional: true,
    errorMessage: 'Expected string value for `cwd` (current working directory), received %v',
  });
  config = ensurePlainObject(config, {
    isOptional: true,
    errorMessage: 'Expected plain object value for `config`, received %v',
  });
  if (!cwd && !config && !noService) {
    throw new TypeError("Either 'cwd', 'config' or 'noService' option must be provided");
  }
  if (cwd && config) {
    throw new TypeError("Expected either 'cwd' or 'config' options, not both of them");
  }
  if (noService) {
    cwd = os.homedir();
  } else if (config) {
    // By default expose configuration errors as crashes
    if (!config.configValidationMode) config.configValidationMode = 'error';
    if (!config.frameworkVersion) config.frameworkVersion = '*';
  }
  command = ensureString(command, {
    errorMessage: 'Expected `command` to be a string, received %v',
  });
  options = ensurePlainObject(options, {
    default: {},
    errorMessage: 'Expected `options` to be a plain object, received %v',
  });
  lastLifecycleHookName = ensureString(lastLifecycleHookName, { isOptional: true });
  hooks = ensurePlainObject(hooks, {
    default: {},
    allowedKeys: ['after', 'before', 'beforeInstanceInit', 'beforeInstanceRun'],
    ensurePropertyValue: ensurePlainFunction,
    errorMessage:
      'Expected `hooks` to be a plain object with predefined supported hooks, received %v',
  });
  env = ensurePlainObject(env, {
    default: {},
    ensurePropertyValue: ensureString,
    errorMessage: 'Expected `env` to be a plain object with string property values, received %v',
  });
  envWhitelist = ensureIterable(envWhitelist, {
    isOptional: true,
    ensureItem: ensureString,
    errorMessage: 'Expected `envWhitelist` to be a var names collection, received %v',
  });
  awsSdkV3StubMap = ensurePlainObject(awsSdkV3StubMap, { isOptional: true });
  if (modulesCacheStub) modulesCacheStub = { ...modulesCacheStub };
  let awsSdkV3Stub;
  if (awsSdkV3StubMap) {
    awsSdkV3Stub = configureAwsSdkV3Stub(awsSdkV3StubMap, {
      passContextToCallbacks: true,
    });
    const sdkV3ModuleStubs = Object.entries(awsSdkV3Stub.modulesCacheStub);
    if (sdkV3ModuleStubs.length) {
      if (!modulesCacheStub) modulesCacheStub = {};
      for (const [moduleName, moduleStub] of sdkV3ModuleStubs) {
        if (modulesCacheStub[moduleName]) {
          throw new Error(`Duplicate module cache stub for ${moduleName}`);
        }
        modulesCacheStub[moduleName] = moduleStub;
      }
    }
  }
  if (shouldStubSpawn) {
    if (!modulesCacheStub) modulesCacheStub = {};
    modulesCacheStub[path.resolve(serverlessPath, 'lib/utils/spawn.js')] = sinon
      .stub()
      .resolves({});
  }
  if (modulesCacheStub) {
    const httpsProxyAgentModuleId = 'https-proxy-agent';
    const httpsProxyAgentPath = resolveModuleRealPath(serverlessPath, httpsProxyAgentModuleId);
    if (
      !hasOwn(modulesCacheStub, httpsProxyAgentModuleId) &&
      !hasOwn(modulesCacheStub, httpsProxyAgentPath)
    ) {
      modulesCacheStub[httpsProxyAgentPath] = require(httpsProxyAgentPath);
    }
  }
  const confirmedCwd = await resolveCwd({ cwd, config });

  const resolveConfigurationPath = require(
    path.resolve(serverlessPath, 'lib/cli/resolve-configuration-path')
  );
  const readConfiguration = require(path.resolve(serverlessPath, 'lib/configuration/read'));
  const resolveVariables = require(path.resolve(serverlessPath, 'lib/configuration/variables'));

  return overrideEnv(
    {
      variables: Object.assign(resolveEnv(), { SLS_AWS_MONITORING_FREQUENCY: '1' }, env),
      whitelist: envWhitelist,
    },
    () =>
      overrideCwd(confirmedCwd, () =>
        resolveServerless(serverlessPath, modulesCacheStub, async (Serverless) => {
          // Temporary patch to ensure resolveInput result matches the options
          // (to be removed once we fully remove `resolveInput` dependency from `Serverless` class)
          const resolveInput = require(path.resolve(serverlessPath, 'lib/cli/resolve-input'));
          resolveInput.clear();
          overrideArgv(
            {
              args: [
                'serverless',
                ...command.split(' '),
                ...Object.entries(options)
                  .map(([optionName, optionValue]) => {
                    if (optionValue === true) return `--${optionName}`;
                    if (optionValue === false) return `--no-${optionName}`;
                    if (optionValue === null) return null;
                    if (Array.isArray(optionValue)) {
                      return optionValue.map((optionItemValue) => [
                        `--${optionName}`,
                        optionItemValue,
                      ]);
                    }
                    return [`--${optionName}`, optionValue];
                  })
                  .flat(Infinity)
                  .filter(Boolean),
              ],
            },
            () => resolveInput(require(path.resolve(serverlessPath, 'lib/cli/commands-schema')))
          );

          if (hooks.before) await hooks.before(Serverless, { cwd: confirmedCwd });
          // Initialize serverless instances in preconfigured environment
          const configurationPath = await resolveConfigurationPath();
          const configuration = configurationPath
            ? await readConfiguration(configurationPath)
            : undefined;

          if (configuration) {
            await resolveVariables({
              servicePath: path.dirname(configurationPath),
              configuration,
              options,
            });
          }

          let serverless = new Serverless({
            configuration,
            serviceDir: configurationPath && confirmedCwd,
            configurationFilename:
              configurationPath && configurationPath.slice(confirmedCwd.length + 1),
            configurationPath,
            isConfigurationResolved: true,
            hasResolvedCommandsExternally: true,
            commands: command ? command.split(' ') : [],
            options,
          });

          if (serverless.triggeredDeprecations) {
            serverless.triggeredDeprecations.clear();
          }
          try {
            if (hooks.beforeInstanceInit) await hooks.beforeInstanceInit(serverless);
            const output = await observeOutput(async () => {
              await serverless.init();

              if (serverless.invokedInstance) serverless = serverless.invokedInstance;
              const { pluginManager } = serverless;

              if (lastLifecycleHookName) {
                let hasLastHookFinalized = null;
                if (pluginManager.getLifecycleEventsData) {
                  // Introduced in Serverless v2.60.0
                  const { getLifecycleEventsData } = pluginManager;
                  pluginManager.getLifecycleEventsData = function (lifecycleCommand) {
                    if (hasLastHookFinalized) return { lifecycleEventsData: [], hooksLength: 0 };
                    const result = getLifecycleEventsData.call(this, lifecycleCommand);
                    if (hasLastHookFinalized === false) return result;

                    let newHooksLength = 0;
                    let lastHook;
                    let shouldOverride = false;
                    for (const [
                      index,
                      {
                        hooksData: { before, at, after },
                        lifecycleEventName,
                      },
                    ] of result.lifecycleEventsData.entries()) {
                      newHooksLength += before.length;
                      if (before.length) lastHook = before[before.length - 1];
                      if (lastLifecycleHookName === `before:${lifecycleEventName}`) {
                        at.length = 0;
                        after.length = 0;
                      } else {
                        newHooksLength += at.length;
                        if (at.length) lastHook = at[at.length - 1];
                        if (lastLifecycleHookName === lifecycleEventName) {
                          after.length = 0;
                        } else {
                          newHooksLength += after.length;
                          if (after.length) lastHook = after[after.length - 1];
                          if (lastLifecycleHookName !== `after:${lifecycleEventName}`) continue;
                        }
                      }
                      shouldOverride = Boolean(lastHook);
                      result.lifecycleEventsData.length = index + 1;
                      result.hooksLength = newHooksLength;
                      hasLastHookFinalized = !newHooksLength;
                      break;
                    }
                    if (shouldOverride) {
                      const hookFunction = lastHook.hook;
                      lastHook.hook = async function () {
                        try {
                          return await hookFunction.call(this);
                        } finally {
                          hasLastHookFinalized = true;
                        }
                      };
                    }
                    return result;
                  };
                } else {
                  // TODO: Remove with next major release
                  const { getHooks } = pluginManager;
                  pluginManager.getHooks = function (events) {
                    if (hasLastHookFinalized) return [];
                    if (hasLastHookFinalized === false) {
                      return getHooks.call(this, events);
                    }
                    const lastEventIndex = events.indexOf(lastLifecycleHookName);
                    if (lastEventIndex === -1) return getHooks.call(this, events);
                    events = events.slice(0, lastEventIndex + 1);
                    const eventHooks = getHooks.call(this, events);
                    if (!eventHooks.length) {
                      hasLastHookFinalized = true;
                      return eventHooks;
                    }
                    hasLastHookFinalized = false;
                    const lastHook = eventHooks[eventHooks.length - 1];
                    const hookFunction = lastHook.hook;
                    lastHook.hook = async function () {
                      try {
                        return await hookFunction.call(this);
                      } finally {
                        hasLastHookFinalized = true;
                      }
                    };
                    return eventHooks;
                  };
                }
              }

              if (hooks.beforeInstanceRun) await hooks.beforeInstanceRun(serverless);
              // Run plugin manager hooks
              await serverless.run();
            });
            if (hooks.after) await hooks.after(serverless);
            const awsProvider = serverless.getProvider('aws');
            return {
              serverless,
              output,
              cfTemplate: serverless.service.provider.compiledCloudFormationTemplate,
              awsNaming: awsProvider && awsProvider.naming,
              awsSdkV3Stub,
            };
          } catch (error) {
            throw Object.assign(error, {
              serverless,
            });
          }
        })
      )
  );
};
