import ensureString from 'type/string/ensure.js';
import ensureIterable from 'type/iterable/ensure.js';
import ensurePlainObject from 'type/plain-object/ensure.js';
import ensurePlainFunction from 'type/plain-function/ensure.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { resetModuleStubs, setModuleStubs } from '../mocha/module-stubs.ts';
import { overrideEnv, overrideCwd, overrideArgv } from '../utils/process.ts';
import * as sinon from 'sinon';
import resolveEnv from './resolve-env.ts';
import observeOutput from './observe-output.ts';
import provisionTmpDir from './provision-tmp-dir.ts';
import configureAwsSdkV3Stub from './configure-aws-sdk-v3-stub.ts';
import { writeJsonFile } from '../utils/fs.ts';

const importDefault = async (modulePath) => (await import(pathToFileURL(modulePath).href)).default;

// Module stubs apply for the duration of the run (see test/mocha/module-stubs.ts)
const resolveServerless = async (serverlessPath, modulesCacheStub, callback) => {
  if (modulesCacheStub) await setModuleStubs(modulesCacheStub);
  try {
    return await callback(await importDefault(path.resolve(serverlessPath, 'lib/serverless.ts')));
  } finally {
    if (modulesCacheStub) resetModuleStubs();
  }
};

const resolveCwd = async ({ cwd, config }) => {
  if (cwd) return cwd;
  const tmpDirPath = await provisionTmpDir();
  await writeJsonFile(path.join(tmpDirPath, 'serverless.json'), config);
  return tmpDirPath;
};

export default async (
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
  if (!fs.existsSync(path.resolve(serverlessPath, 'lib/serverless.ts'))) {
    throw new TypeError(
      `Provided 'serverlessPath' (${serverlessPath}) doesn't point an osls package root`
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
    modulesCacheStub[path.resolve(serverlessPath, 'lib/utils/spawn.ts')] = sinon
      .stub()
      .resolves({});
  }
  const confirmedCwd = await resolveCwd({ cwd, config });

  const resolveConfigurationPath = await importDefault(
    path.resolve(serverlessPath, 'lib/cli/resolve-configuration-path.ts')
  );
  const readConfiguration = await importDefault(
    path.resolve(serverlessPath, 'lib/configuration/read.ts')
  );
  const resolveVariables = await importDefault(
    path.resolve(serverlessPath, 'lib/configuration/variables/index.ts')
  );
  const resolveInput = await importDefault(
    path.resolve(serverlessPath, 'lib/cli/resolve-input.ts')
  );
  const commandsSchema = await importDefault(
    path.resolve(serverlessPath, 'lib/cli/commands-schema/index.ts')
  );

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
            () => resolveInput(commandsSchema)
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
