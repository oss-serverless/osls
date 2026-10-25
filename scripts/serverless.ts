#!/usr/bin/env node

'use strict';

Error.stackTraceLimit = Infinity;

// Setup log writing
require('../lib/utils/serverless-utils/log-reporters/node');
const { log, progress } = require('../lib/utils/serverless-utils/log');

const processLog = log.get('process');

const handleError = require('../lib/cli/handle-error');
const logDeprecation = require('../lib/utils/log-deprecation');

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
    const wait = require('../lib/utils/sleep');
    await wait(); // Ensure access to "processSpanPromise"

    const { signals } = require('signal-exit/signals');

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

    const humanizePropertyPathKeys = require('../lib/configuration/variables/humanize-property-path-keys');

    (() => {
      // Rewrite eventual `sls deploy -f` into `sls deploy function -f`
      // Also rewrite `serverless dev` to `serverless --dev``
      const isParamName = RegExp.prototype.test.bind(require('../lib/cli/param-reg-exp'));

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

    const resolveInput = require('../lib/cli/resolve-input');

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
    setCliInput(resolveInput(require('../lib/cli/commands-schema/no-service')));

    // If version number request, show it and abort
    if (options.version) {
      processLog.debug('render version');
      await require('../lib/cli/render-version')();
      await finalize();
      return;
    }

    const ServerlessError = require('../lib/serverless-error');

    // Abort if command is not supported in this environment
    if (commandSchema && commandSchema.isHidden && commandSchema.noSupportNotice) {
      throw new ServerlessError(
        `Cannot run \`${command}\` command: ${commandSchema.noSupportNotice}`,
        'NOT_SUPPORTED_COMMAND'
      );
    }

    const path = require('path');
    const { randomUUID } = require('node:crypto');
    const clear = require('ext/object/clear');
    const Serverless = require('../lib/serverless');
    const { safeShallowAssign } = require('../lib/utils/safe-object');
    const resolveVariables = require('../lib/configuration/variables/resolve');
    const deferIrrelevantStageParams = require('../lib/configuration/variables/defer-irrelevant-stage-params');
    const isPropertyResolved = require('../lib/configuration/variables/is-property-resolved');
    const eventuallyReportVariableResolutionErrors = require('../lib/configuration/variables/eventually-report-resolution-errors');
    const filterSupportedOptions = require('../lib/cli/filter-supported-options');

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
      setCliInput(resolveInput(require('../lib/cli/commands-schema/service')));

      processLog.debug('resolve eventual service configuration');
      const resolveConfigurationPath = require('../lib/cli/resolve-configuration-path');
      const readConfiguration = require('../lib/configuration/read');
      const resolveProviderName = require('../lib/configuration/resolve-provider-name');
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
          const resolveVariablesMeta = require('../lib/configuration/variables/resolve-meta');

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
            setCliInput(resolveInput(require('../lib/cli/commands-schema/aws-service')));
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
                env: require('../lib/configuration/variables/sources/env'),
                file: require('../lib/configuration/variables/sources/file'),
                opt: require('../lib/configuration/variables/sources/opt'),
                self: require('../lib/configuration/variables/sources/self'),
                strToBool: require('../lib/configuration/variables/sources/str-to-bool'),
                sls: require('../lib/configuration/variables/sources/instance-dependent/get-sls')(),
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
                setCliInput(resolveInput(require('../lib/cli/commands-schema/aws-service')));

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
              const envSource = require('../lib/configuration/variables/sources/env');
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
          if (await require('../lib/cli/conditionally-load-dotenv')(options, configuration)) {
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
              setCliInput(resolveInput(require('../lib/cli/commands-schema/aws-service')));
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
          setCliInput(resolveInput(require('../lib/cli/commands-schema/aws-service')));
        }
      } else {
        // In non-service context we recognize all AWS service commands
        processLog.debug('parsing of configuration file failed');
        processLog.debug('resolve CLI input (AWS service schema)');
        resolveInput.clear();
        setCliInput(resolveInput(require('../lib/cli/commands-schema/aws-service')));

        // Validate result command and options
        require('../lib/cli/ensure-supported-command')(null, cliInput);
      }
    } else {
      require('../lib/cli/ensure-supported-command')(null, cliInput);
    }

    const configurationFilename = configuration && configurationPath.slice(serviceDir.length + 1);

    // Names of the commands which are configured independently in root `commands` folder
    // and not in Serverless class internals
    const notIntegratedCommands = new Set(['doctor', 'plugin install', 'plugin uninstall']);
    const isStandaloneCommand = notIntegratedCommands.has(command);

    if (!isHelpRequest) {
      if (isStandaloneCommand) {
        processLog.debug('run standalone command');
        if (configuration) require('../lib/cli/ensure-supported-command')(configuration, cliInput);
        await require(`../commands/${commands.join('-')}`)({
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
            const commandsSchema = require('../lib/cli/commands-schema/resolve-final')(
              serverless.pluginManager.externalPlugins,
              { providerName: providerName || 'aws', configuration }
            );
            resolveInput.clear();
            setCliInput(resolveInput(commandsSchema));
            hasFinalCommandSchema = true;
          }
        }
        if (!providerName && !hasFinalCommandSchema) {
          // Invalid configuration, ensure to recognize all AWS commands
          processLog.debug('resolve CLI input (AWS service schema)');
          resolveInput.clear();
          setCliInput(resolveInput(require('../lib/cli/commands-schema/aws-service')));
        }
        hasFinalCommandSchema = true;

        Object.assign(serverless.processedInput, cliInput);
        serverless.pluginManager.cliCommands = commands;
        safeShallowAssign(clear(serverless.pluginManager.cliOptions), options);

        // Validate result command and options
        if (hasFinalCommandSchema)
          require('../lib/cli/ensure-supported-command')(configuration, cliInput);
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
              env: require('../lib/configuration/variables/sources/env'),
              file: require('../lib/configuration/variables/sources/file'),
              opt: require('../lib/configuration/variables/sources/opt'),
              self: require('../lib/configuration/variables/sources/self'),
              strToBool: require('../lib/configuration/variables/sources/str-to-bool'),
              sls: require('../lib/configuration/variables/sources/instance-dependent/get-sls')(),
              param: require('../lib/configuration/variables/sources/instance-dependent/param')(),
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
        resolverConfiguration.sources.sls =
          require('../lib/configuration/variables/sources/instance-dependent/get-sls')(serverless);
        resolverConfiguration.fulfilledSources.add('sls');

        resolverConfiguration.sources.param =
          require('../lib/configuration/variables/sources/instance-dependent/param')(serverless);
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
            cf: require('../lib/configuration/variables/sources/instance-dependent/get-cf')(
              serverless
            ),
            s3: require('../lib/configuration/variables/sources/instance-dependent/get-s3')(
              serverless
            ),
            ssm: require('../lib/configuration/variables/sources/instance-dependent/get-ssm')(
              serverless
            ),
            aws: require('../lib/configuration/variables/sources/instance-dependent/get-aws')(
              serverless
            ),
          });
          resolverConfiguration.fulfilledSources.add('cf').add('s3').add('ssm').add('aws');
        }

        // Register variable source resolvers provided by external plugins
        const resolverExternalPluginSources = require('../lib/configuration/variables/sources/resolve-external-plugin-sources');
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
        const unresolvedSources =
          require('../lib/configuration/variables/resolve-unresolved-source-types')(variablesMeta);
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
        require('../lib/cli/render-help')(serverless.pluginManager.externalPlugins, cliInput);
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
