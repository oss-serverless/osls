'use strict';

const ServerlessError = require('../serverless-error');
const cliCommandsSchema = require('../cli/commands-schema');
const renderCommandHelp = require('../cli/render-help/command');

// class wide constants
const validProviders = new Set(['aws']);

// TODO: update to look like the list in the "create" plugin
// once more than one provider is supported
const humanReadableProvidersList = `"${Array.from(validProviders)}"`;

class Config {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {
      config: {
        ...cliCommandsSchema.get('config'),
        commands: {
          credentials: {
            // Command defined in AWS context
            validProviders,
          },
        },
      },
    };

    this.hooks = {
      'config:config': async () => this.updateConfig(),
      'before:config:credentials:config': () => this.validate(),
    };
  }

  validate() {
    const provider = this.options.provider.toLowerCase();

    if (!validProviders.has(provider)) {
      const errorMessage = [
        `Provider "${provider}" is not supported.`,
        ` Supported providers are: ${humanReadableProvidersList}.`,
      ].join('');
      throw new ServerlessError(errorMessage, 'INVALID_PROVIDER');
    }
  }

  async updateConfig() {
    renderCommandHelp(
      this.serverless.processedInput.commands.join(' '),
      this.serverless.processedInput
    );
  }
}

module.exports = Config;
