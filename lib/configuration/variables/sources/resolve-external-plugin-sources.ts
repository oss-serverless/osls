'use strict';

const ensurePlainObject = require('type/plain-object/ensure');
const ensurePlainFunction = require('type/plain-function/ensure');
const ServerlessError = require('../../../serverless-error');

module.exports = (configuration, resolverConfiguration, externalPlugins) => {
  for (const externalPlugin of externalPlugins) {
    const pluginName = externalPlugin.constructor.name;
    if (externalPlugin.configurationVariablesSources != null) {
      ensurePlainObject(externalPlugin.configurationVariablesSources, {
        errorMessage:
          'Invalid "configurationVariablesSources" ' +
          `configuration on "${pluginName}", expected object, got: %v"`,
        Error: ServerlessError,
        errorCode: 'INVALID_VARIABLE_SOURCES_CONFIGURATION',
      });

      for (const [sourceName, sourceConfig] of Object.entries(
        externalPlugin.configurationVariablesSources
      )) {
        if (resolverConfiguration.sources[sourceName]) {
          throw new ServerlessError(
            `Cannot add "${sourceName}" configuration variable source ` +
              `(through "${pluginName}" plugin) as resolution rules ` +
              'for this source name are already configured',
            'DUPLICATE_VARIABLE_SOURCE_CONFIGURATION'
          );
        }
        ensurePlainFunction(
          ensurePlainObject(sourceConfig, {
            errorMessage:
              `Invalid "configurationVariablesSources.${sourceName}" ` +
              `configuration on "${pluginName}", expected object, got: %v"`,
            Error: ServerlessError,
            errorCode: 'INVALID_VARIABLE_SOURCE_CONFIGURATION',
          }).resolve,
          {
            errorMessage:
              `Invalid "configurationVariablesSources.${sourceName}.resolve" ` +
              `value on "${pluginName}", expected function, got: %v"`,
            Error: ServerlessError,
            errorCode: 'INVALID_VARIABLE_SOURCE_RESOLVER_CONFIGURATION',
          }
        );

        resolverConfiguration.sources[sourceName] = sourceConfig;
        resolverConfiguration.fulfilledSources.add(sourceName);
      }
    } else if (externalPlugin.variableResolvers) {
      throw new ServerlessError(
        `Plugin "${pluginName}" attempts to extend the old variables resolver. Use "configurationVariablesSources" instead.`,
        'OLD_VARIABLE_RESOLVER_NOT_SUPPORTED'
      );
    }
  }
};
