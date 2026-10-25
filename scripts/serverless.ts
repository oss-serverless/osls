#!/usr/bin/env node
// Setup log writing
import '../lib/utils/serverless-utils/log-reporters/node.ts';

import { log, progress } from '../lib/utils/serverless-utils/log.ts';
import handleError from '../lib/cli/handle-error.ts';
import logDeprecation from '../lib/utils/log-deprecation.ts';
import paramRegExp from '../lib/cli/param-reg-exp.ts';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import clear from 'ext/object/clear.js';

Error.stackTraceLimit = Infinity;

const processLog = log.get('process');

let command;
let isHelpRequest;
let options;
let commandSchema;
let serviceDir = null;
let configuration = null;
let serverless;

// Inquirer async operations do not keep node process alive
// We need to issue a keep alive timer so process does not die
// to properly handle e.g. `SIGINT` interrupt
const keepAliveTimer = setTimeout(() => {}, 60 * 60 * 1000);

let hasBeenFinalized = false;
const finalize = async ({ error, shouldBeSync } = {}) => {
  processLog.debug('finalize %o', { error, shouldBeSync });
  if (hasBeenFinalized) {
    if (error) {
      // Programmer error in finalize handling, ensure to expose
      process.nextTick(() => {
        throw error;
      });
    }
    return null;
  }
  hasBeenFinalized = true;
  clearTimeout(keepAliveTimer);
  progress.clear();
  if (error) handleError(error, { serverless });
  if (!shouldBeSync) {
    await logDeprecation.printSummary();
  }
  return null;
};

process.once('uncaughtException', (error) => {
  log.error('Uncaught exception');
  finalize({ error }).then(() => process.exit());
});

(async () => {
  try {
    const wait = (await import('../lib/utils/sleep.ts')).default;
    await wait(); // Ensure access to "processSpanPromise"

    const { signals } = await import('signal-exit/signals');

    signals.forEach((signal) => {
      process.once(signal, () => {
        processLog.debug('exit signal %s', signal);
        // If there's another listener (e.g. we're in daemon context or reading stdin input)
        // then let the other listener decide how process will exit
        const isOtherSigintListener = Boolean(process.listenerCount(signal));
        finalize({
          shouldBeSync: true,
        });
        if (isOtherSigintListener) return;
        // Follow recommendation from signal-exit:
        // https://github.com/tapjs/signal-exit/blob/654117d6c9035ff6a805db4d4acf1f0c820fcb21/index.js#L97-L98
        if (process.platform === 'win32' && signal === 'SIGHUP') signal = 'SIGINT';
        process.kill(process.pid, signal);
      });
    });

    const humanizePropertyPathKeys = (
      await import('../lib/configuration/variables/humanize-property-path-keys.ts')
    ).default;

    (() => {
      // Rewrite eventual `sls deploy -f` into `sls deploy function -f`
      // Also rewrite `serverless dev` to `serverless --dev``
      const isParamName = RegExp.prototype.test.bind(paramRegExp);

      const args = process.argv.slice(2);
      const firstParamIndex = args.findIndex(isParamName);
      const commands = args.slice(0, firstParamIndex === -1 ? Infinity : firstParamIndex);

      if (commands.join('') === 'dev') {
        process.argv[2] = '--dev';
        return;
      }

      if (commands.join(' ') !== 'deploy') return;
      if (!args.includes('-f') && !args.includes('--function')) return;
      process.argv.splice(3, 0, 'function');
    })();

    const resolveInput = (await import('../lib/cli/resolve-input.ts')).default;

    let commands;
    let cliInput;
    const setCliInput = (resolvedInput) => {
      cliInput = {
        ...resolvedInput,
        isContainerCommand: Boolean(resolvedInput.isContainerCommand),
        isHelpRequest: Boolean(resolvedInput.isHelpRequest),
      };
      ({ command, commands, options, isHelpRequest, commandSchema } = cliInput);
    };
    processLog.debug('resolve CLI input (no service schema)');
    // Parse args against schemas of commands which do not require to be run in service context
    setCliInput(resolveInput((await import('../lib/cli/commands-schema/no-service.ts')).default));

    // If version number request, show it and abort
    if (options.version) {
      processLog.debug('render version');
      await (await import('../lib/cli/render-version.ts')).default();
      await finalize();
      return;
    }

    const ServerlessError = (await import('../lib/serverless-error.ts')).default;

    // Abort if command is not supported in this environment
    if (commandSchema && commandSchema.isHidden && commandSchema.noSupportNotice) {
      throw new ServerlessError(
        `Cannot run \`${command}\` command: ${commandSchema.noSupportNotice}`,
        'NOT_SUPPORTED_COMMAND'
      );
    }

    const Serverless = (await import('../lib/serverless.ts')).default;
    const { safeShallowAssign } = (await import('../lib/utils/safe-object.ts')).default;
    const resolveVariables = (await import('../lib/configuration/variables/resolve.ts')).default;
    const deferIrrelevantStageParams = (
      await import('../lib/configuration/variables/defer-irrelevant-stage-params.ts')
    ).default;
    const isPropertyResolved = (
      await import('../lib/configuration/variables/is-property-resolved.ts')
    ).default;
    const eventuallyReportVariableResolutionErrors = (
      await import('../lib/configuration/variables/eventually-report-resolution-errors.ts')
    ).default;
    const filterSupportedOptions = (await import('../lib/cli/filter-supported-options.ts')).default;

    let configurationPath = null;
    let providerName;
    let variablesMeta;
    let resolverConfiguration;

    const ensureResolvedProperty = (propertyPath) => {
      if (isPropertyResolved(variablesMeta, propertyPath)) return true;
      variablesMeta = null;
      if (isHelpRequest) return false;
      const humanizedPropertyPath = humanizePropertyPathKeys(propertyPath.split('\0'));
      throw new ServerlessError(
        `Cannot resolve ${path.basename(
          configurationPath
        )}: "${humanizedPropertyPath}" property is not accessible ` +
          '(configured behind variables which cannot be resolved at this stage)',
        'INACCESSIBLE_CONFIGURATION_PROPERTY'
      );
    };
    const eventuallyReportVariableResolutionErrorsForCliInput = (
      serviceConfigurationPath,
      serviceConfiguration,
      serviceVariablesMeta
    ) =>
      eventuallyReportVariableResolutionErrors(
        serviceConfigurationPath,
        serviceConfiguration,
        serviceVariablesMeta,
        { isHelpRequest }
      );

    if (!commandSchema || commandSchema.serviceDependencyMode) {
      // Command is potentially service specific, follow up with resolution of service config

      // Parse args again, taking account schema of service-specific flags
      // as they may influence configuration resolution
      processLog.debug('resolve CLI input (service schema)');
      resolveInput.clear();
      setCliInput(resolveInput((await import('../lib/cli/commands-schema/service.ts')).default));

      processLog.debug('resolve eventual service configuration');
      const resolveConfigurationPath = (await import('../lib/cli/resolve-configuration-path.ts'))
        .default;
      const readConfiguration = (await import('../lib/configuration/read.ts')).default;
      const resolveProviderName = (await import('../lib/configuration/resolve-provider-name.ts'))
        .default;
      const resolveProviderNameForCliInput = (serviceConfiguration) =>
        resolveProviderName(serviceConfiguration, { isHelpRequest });

      // Resolve eventual service configuration path
      configurationPath = await resolveConfigurationPath({ options: { ...options } });
      if (configurationPath) {
        processLog.debug('service configuration found at %s', configurationPath);
      } else processLog.debug('no service configuration found');

      // If service configuration file is found, load its content
      configuration = configurationPath
        ? await (async () => {
            try {
              return await readConfiguration(configurationPath);
            } catch (error) {
              // Configuration syntax error should not prevent help from being displayed
              // (if possible configuration should be read for help request as registered
              // plugins may introduce new commands to be listed in help output)
              if (isHelpRequest) return null;
              throw error;
            }
          })()
        : null;

      if (configuration) {
        processLog.debug('service configuration file successfully parsed');
        serviceDir = process.cwd();

        // IIFE for maintenance convenience
        await (async () => {
          processLog.debug('resolve variables meta');
          const resolveVariablesMeta = (
            await import('../lib/configuration/variables/resolve-meta.ts')
          ).default;

          variablesMeta = resolveVariablesMeta(configuration);

          if (
            eventuallyReportVariableResolutionErrorsForCliInput(
              configurationPath,
              configuration,
              variablesMeta
            )
          ) {
            // Variable syntax errors, abort
            variablesMeta = null;
            return;
          }

          if (!ensureResolvedProperty('disabledDeprecations')) return;
          if (!ensureResolvedProperty('deprecationNotificationMode')) return;

          if (isPropertyResolved(variablesMeta, 'provider\0name')) {
            providerName = resolveProviderNameForCliInput(configuration);
            if (providerName == null) {
              variablesMeta = null;
              return;
            }
          }
          if (!commandSchema && providerName === 'aws') {
            // If command was not recognized in previous resolution phases
            // parse args again also against schemas commands which require AWS service context
            processLog.debug('resolve CLI input (AWS service schema)');
            resolveInput.clear();
            setCliInput(
              resolveInput((await import('../lib/cli/commands-schema/aws-service.ts')).default)
            );
          }

          let envVarNamesNeededForDotenvResolution;
          if (variablesMeta.size) {
            processLog.debug('resolve variables in core properties');
            // Some properties are configured with variables

            // Resolve eventual variables in `provider.stage` and `useDotEnv`
            // (required for reliable .env resolution)
            resolverConfiguration = {
              serviceDir,
              configuration,
              variablesMeta,
              sources: {
                env: (await import('../lib/configuration/variables/sources/env.ts')).default,
                file: (await import('../lib/configuration/variables/sources/file.ts')).default,
                opt: (await import('../lib/configuration/variables/sources/opt.ts')).default,
                self: (await import('../lib/configuration/variables/sources/self.ts')).default,
                strToBool: (await import('../lib/configuration/variables/sources/str-to-bool.ts'))
                  .default,
                sls: (
                  await import('../lib/configuration/variables/sources/instance-dependent/get-sls.ts')
                ).default(),
              },
              options: filterSupportedOptions(options, { commandSchema, providerName }),
              fulfilledSources: new Set(['file', 'self', 'strToBool']),
              propertyPathsToResolve: new Set(['provider\0name', 'provider\0stage', 'useDotenv']),
            };
            // Assigned after the literal, as the predicate reads `resolverConfiguration` live
            resolverConfiguration.isPropertyDeferred = deferIrrelevantStageParams(
              configuration,
              resolverConfiguration
            );

            await resolveVariables(resolverConfiguration);

            if (
              eventuallyReportVariableResolutionErrorsForCliInput(
                configurationPath,
                configuration,
                variablesMeta
              )
            ) {
              // Unrecoverable resolution errors, abort
              variablesMeta = null;
              return;
            }

            if (!providerName && isPropertyResolved(variablesMeta, 'provider\0name')) {
              providerName = resolveProviderNameForCliInput(configuration);
              if (providerName == null) {
                variablesMeta = null;
                return;
              }
              if (!commandSchema && providerName === 'aws') {
                // If command was not recognized in previous resolution phases
                // Parse args again also against schemas of commands which work in context of an AWS
                // service
                processLog.debug('resolve CLI input (AWS service schema)');
                resolveInput.clear();
                setCliInput(
                  resolveInput((await import('../lib/cli/commands-schema/aws-service.ts')).default)
                );

                if (commandSchema) {
                  processLog.debug('resolve variables in core properties #2');
                  resolverConfiguration.options = filterSupportedOptions(options, {
                    commandSchema,
                    providerName,
                  });
                  await resolveVariables(resolverConfiguration);
                  if (
                    eventuallyReportVariableResolutionErrorsForCliInput(
                      configurationPath,
                      configuration,
                      variablesMeta
                    )
                  ) {
                    variablesMeta = null;
                    return;
                  }
                }
              }
            }

            resolverConfiguration.fulfilledSources.add('env');
            if (
              !isPropertyResolved(variablesMeta, 'provider\0stage') ||
              !isPropertyResolved(variablesMeta, 'useDotenv')
            ) {
              // Assume "env" source fulfilled for `provider.stage` and `useDotenv` resolution.
              // To pick eventual resolution conflict, track what env variables were reported
              // missing when applying this resolution
              processLog.debug('resolve variables in stage related properties');
              const envSource = (await import('../lib/configuration/variables/sources/env.ts'))
                .default;
              envSource.missingEnvVariables.clear();
              await resolveVariables({
                ...resolverConfiguration,
                propertyPathsToResolve: new Set(['provider\0stage', 'useDotenv']),
              });
              if (
                eventuallyReportVariableResolutionErrorsForCliInput(
                  configurationPath,
                  configuration,
                  variablesMeta
                )
              ) {
                // Unrecoverable resolution errors, abort
                variablesMeta = null;
                return;
              }

              if (
                !ensureResolvedProperty('provider\0stage', {
                  shouldSilentlyReturnIfLegacyMode: true,
                })
              ) {
                return;
              }

              if (!ensureResolvedProperty('useDotenv')) return;

              envVarNamesNeededForDotenvResolution = envSource.missingEnvVariables;
            }
          }

          // Load eventual environment variables from .env files
          if (
            await (
              await import('../lib/cli/conditionally-load-dotenv.ts')
            ).default(options, configuration)
          ) {
            if (envVarNamesNeededForDotenvResolution) {
              for (const envVarName of envVarNamesNeededForDotenvResolution) {
                if (process.env[envVarName]) {
                  throw new ServerlessError(
                    'Cannot reliably resolve "env" variables due to resolution conflict.\n' +
                      `Environment variable "${envVarName}" which influences resolution of ` +
                      '".env" file were found to be defined in resolved ".env" file.' +
                      'DOTENV_ENV_VAR_RESOLUTION_CONFLICT'
                  );
                }
              }
            }
            if (!isPropertyResolved(variablesMeta, 'provider\0name')) {
              processLog.debug('resolve variables in "provider.name"');
              await resolveVariables(resolverConfiguration);
              if (
                eventuallyReportVariableResolutionErrorsForCliInput(
                  configurationPath,
                  configuration,
                  variablesMeta
                )
              ) {
                variablesMeta = null;
                return;
              }
            }
          }

          if (!variablesMeta.size) return; // No properties configured with variables

          if (!providerName) {
            if (!ensureResolvedProperty('provider\0name')) return;
            providerName = resolveProviderNameForCliInput(configuration);
            if (providerName == null) {
              variablesMeta = null;
              return;
            }
            if (!commandSchema && providerName === 'aws') {
              processLog.debug('resolve CLI input (AWS service schema)');
              resolveInput.clear();
              setCliInput(
                resolveInput((await import('../lib/cli/commands-schema/aws-service.ts')).default)
              );
              if (commandSchema) {
                resolverConfiguration.options = filterSupportedOptions(options, {
                  commandSchema,
                  providerName,
                });
              }
            }
          }
          if (isHelpRequest || commands[0] === 'plugin') {
            processLog.debug('resolve variables in "plugins"');
            // We do not need full config resolved, we just need to know what
            // provider is service setup with, and with what eventual plugins osls is extended
            // as that influences what CLI commands and options could be used,
            resolverConfiguration.propertyPathsToResolve.add('plugins');
          } else {
            processLog.debug('resolve variables in all properties');
            delete resolverConfiguration.propertyPathsToResolve;
          }

          await resolveVariables(resolverConfiguration);
          if (
            eventuallyReportVariableResolutionErrorsForCliInput(
              configurationPath,
              configuration,
              variablesMeta
            )
          ) {
            variablesMeta = null;
            return;
          }

          if (!variablesMeta.size) return; // All properties successfully resolved

          if (!ensureResolvedProperty('plugins')) return;

          // At this point we have all properties needed for `plugin install/uninstall` commands
          if (commands[0] === 'plugin') {
            return;
          }

          if (!ensureResolvedProperty('package\0path')) return;

          if (!ensureResolvedProperty('frameworkVersion')) return;
          if (!ensureResolvedProperty('service')) return;
        })();

        // Ensure to have full AWS commands schema loaded if we're in context of AWS provider
        // It's not the case if not AWS service specific command was resolved
        if (configuration && resolveProviderNameForCliInput(configuration) === 'aws') {
          processLog.debug('resolve CLI input (AWS service schema)');
          resolveInput.clear();
          setCliInput(
            resolveInput((await import('../lib/cli/commands-schema/aws-service.ts')).default)
          );
        }
      } else {
        // In non-service context we recognize all AWS service commands
        processLog.debug('parsing of configuration file failed');
        processLog.debug('resolve CLI input (AWS service schema)');
        resolveInput.clear();
        setCliInput(
          resolveInput((await import('../lib/cli/commands-schema/aws-service.ts')).default)
        );

        // Validate result command and options
        (await import('../lib/cli/ensure-supported-command.ts')).default(null, cliInput);
      }
    } else {
      (await import('../lib/cli/ensure-supported-command.ts')).default(null, cliInput);
    }

    const configurationFilename = configuration && configurationPath.slice(serviceDir.length + 1);

    // Names of the commands which are configured independently in root `commands` folder
    // and not in Serverless class internals
    const notIntegratedCommands = new Map([
      ['doctor', () => import('../commands/doctor.ts')],
      ['plugin install', () => import('../commands/plugin-install.ts')],
      ['plugin uninstall', () => import('../commands/plugin-uninstall.ts')],
    ]);
    const isStandaloneCommand = notIntegratedCommands.has(command);

    if (!isHelpRequest) {
      if (isStandaloneCommand) {
        processLog.debug('run standalone command');
        if (configuration)
          (await import('../lib/cli/ensure-supported-command.ts')).default(configuration, cliInput);
        await (
          await notIntegratedCommands.get(command)()
        ).default({
          configuration,
          serviceDir,
          configurationFilename,
          options,
        });
        await finalize({});
        return;
      }
    }

    processLog.debug('construct Serverless instance');
    serverless = new Serverless({
      configuration,
      serviceDir,
      configurationFilename,
      ...cliInput,
      variablesMeta,
    });

    try {
      serverless.invocationId = randomUUID();
      processLog.debug('initialize Serverless instance');
      await serverless.init();

      // IIFE for maintenance convenience
      await (async () => {
        if (!configuration) return;

        let hasFinalCommandSchema = false;
        if (configuration.plugins) {
          // After plugins are loaded, re-resolve CLI command and options schema as plugin
          // might have defined extra commands and options

          if (serverless.pluginManager.externalPlugins.size) {
            processLog.debug('resolve CLI input (+ plugins schema)');
            const commandsSchema = (
              await import('../lib/cli/commands-schema/resolve-final.ts')
            ).default(serverless.pluginManager.externalPlugins, {
              providerName: providerName || 'aws',
              configuration,
            });
            resolveInput.clear();
            setCliInput(resolveInput(commandsSchema));
            hasFinalCommandSchema = true;
          }
        }
        if (!providerName && !hasFinalCommandSchema) {
          // Invalid configuration, ensure to recognize all AWS commands
          processLog.debug('resolve CLI input (AWS service schema)');
          resolveInput.clear();
          setCliInput(
            resolveInput((await import('../lib/cli/commands-schema/aws-service.ts')).default)
          );
        }
        hasFinalCommandSchema = true;

        Object.assign(serverless.processedInput, cliInput);
        serverless.pluginManager.cliCommands = commands;
        safeShallowAssign(clear(serverless.pluginManager.cliOptions), options);

        // Validate result command and options
        if (hasFinalCommandSchema)
          (await import('../lib/cli/ensure-supported-command.ts')).default(configuration, cliInput);
        if (isHelpRequest) return;
        if (!(variablesMeta && variablesMeta.size)) return;
        if (!resolverConfiguration) {
          // There were no variables in the initial configuration, yet it was extended by
          // the plugins with ones.
          // In this case we need to ensure `resolverConfiguration` which initially was not setup
          resolverConfiguration = {
            serviceDir,
            configuration,
            variablesMeta,
            sources: {
              env: (await import('../lib/configuration/variables/sources/env.ts')).default,
              file: (await import('../lib/configuration/variables/sources/file.ts')).default,
              opt: (await import('../lib/configuration/variables/sources/opt.ts')).default,
              self: (await import('../lib/configuration/variables/sources/self.ts')).default,
              strToBool: (await import('../lib/configuration/variables/sources/str-to-bool.ts'))
                .default,
              sls: (
                await import('../lib/configuration/variables/sources/instance-dependent/get-sls.ts')
              ).default(),
              param: (
                await import('../lib/configuration/variables/sources/instance-dependent/param.ts')
              ).default(),
            },
            options: filterSupportedOptions(options, { commandSchema, providerName }),
            fulfilledSources: new Set(['env', 'file', 'self', 'strToBool']),
            propertyPathsToResolve:
              commands[0] === 'plugin'
                ? new Set(['plugins', 'provider\0name', 'provider\0stage', 'useDotenv'])
                : null,
          };
          // Assigned after the literal, as the predicate reads `resolverConfiguration` live
          // (when set up above instead, `resolverConfiguration` already carries its predicate)
          resolverConfiguration.isPropertyDeferred = deferIrrelevantStageParams(
            configuration,
            resolverConfiguration
          );
        }

        if (commandSchema) {
          resolverConfiguration.options = filterSupportedOptions(options, {
            commandSchema,
            providerName,
          });
        }
        resolverConfiguration.fulfilledSources.add('opt');

        // Register serverless instance specific variable sources
        resolverConfiguration.sources.sls = (
          await import('../lib/configuration/variables/sources/instance-dependent/get-sls.ts')
        ).default(serverless);
        resolverConfiguration.fulfilledSources.add('sls');

        resolverConfiguration.sources.param = (
          await import('../lib/configuration/variables/sources/instance-dependent/param.ts')
        ).default(serverless);
        resolverConfiguration.fulfilledSources.add('param');

        // Register AWS provider specific variable sources
        if (providerName === 'aws') {
          // Pre-resolve to eventually pick not yet resolved AWS auth related properties
          processLog.debug('resolve variables');
          await resolveVariables(resolverConfiguration);
          if (!variablesMeta.size) return;
          if (
            eventuallyReportVariableResolutionErrorsForCliInput(
              configurationPath,
              configuration,
              variablesMeta
            )
          ) {
            return;
          }

          // Ensure properties which are crucial to some variable source resolvers
          // are actually resolved.
          if (
            !ensureResolvedProperty('provider\0credentials') ||
            !ensureResolvedProperty('provider\0deploymentBucket\0serverSideEncryption') ||
            !ensureResolvedProperty('provider\0profile') ||
            !ensureResolvedProperty('provider\0region')
          ) {
            return;
          }
          Object.assign(resolverConfiguration.sources, {
            cf: (
              await import('../lib/configuration/variables/sources/instance-dependent/get-cf.ts')
            ).default(serverless),
            s3: (
              await import('../lib/configuration/variables/sources/instance-dependent/get-s3.ts')
            ).default(serverless),
            ssm: (
              await import('../lib/configuration/variables/sources/instance-dependent/get-ssm.ts')
            ).default(serverless),
            aws: (
              await import('../lib/configuration/variables/sources/instance-dependent/get-aws.ts')
            ).default(serverless),
          });
          resolverConfiguration.fulfilledSources.add('cf').add('s3').add('ssm').add('aws');
        }

        // Register variable source resolvers provided by external plugins
        const resolverExternalPluginSources = (
          await import('../lib/configuration/variables/sources/resolve-external-plugin-sources.ts')
        ).default;
        resolverExternalPluginSources(
          configuration,
          resolverConfiguration,
          serverless.pluginManager.externalPlugins
        );

        // Having all source resolvers configured, resolve variables
        processLog.debug('resolve all variables');
        await resolveVariables(resolverConfiguration);

        // Drop entries deliberately left unresolved (params of irrelevant stages), so they're not
        // reported as resolution errors or unrecognized sources; their raw values remain in the
        // configuration. Errored entries (e.g. syntax errors in resolved objects) are kept to be
        // reported below. Must not run while a resolution pass is in progress
        for (const propertyPath of Array.from(variablesMeta.keys())) {
          if (!resolverConfiguration.isPropertyDeferred(propertyPath)) continue;
          if (variablesMeta.get(propertyPath).error) continue;
          variablesMeta.delete(propertyPath);
        }

        if (!variablesMeta.size) return;
        if (
          eventuallyReportVariableResolutionErrorsForCliInput(
            configurationPath,
            configuration,
            variablesMeta
          )
        ) {
          return;
        }

        // Do not confirm on unresolved sources with partially resolved configuration
        if (resolverConfiguration.propertyPathsToResolve) return;

        processLog.debug('uresolved variables meta: %o', variablesMeta);
        // Report unrecognized variable sources found in variables configured in service config
        const unresolvedSources = (
          await import('../lib/configuration/variables/resolve-unresolved-source-types.ts')
        ).default(variablesMeta);
        const recognizedSourceNames = new Set(Object.keys(resolverConfiguration.sources));

        const unrecognizedSourceNames = Array.from(unresolvedSources.keys()).filter(
          (sourceName) => !recognizedSourceNames.has(sourceName)
        );

        throw new ServerlessError(
          `Unrecognized configuration variable sources: "${unrecognizedSourceNames.join('", "')}"`,
          'UNRECOGNIZED_VARIABLE_SOURCES'
        );
      })();

      if (isHelpRequest && serverless.pluginManager.externalPlugins) {
        // Show help
        processLog.debug('render help');
        (await import('../lib/cli/render-help/index.ts')).default(
          serverless.pluginManager.externalPlugins,
          cliInput
        );
      } else {
        processLog.debug('run Serverless instance');
        // Run command
        await serverless.run();
      }
      await finalize({});
    } catch (error) {
      processLog.debug('handle error');
      throw error;
    }
  } catch (error) {
    await finalize({ error });
  }
})();
