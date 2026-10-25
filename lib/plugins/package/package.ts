'use strict';

const path = require('path');
const ServerlessError = require('../../serverless-error');
const cliCommandsSchema = require('../../cli/commands-schema');
const zipService = require('./lib/zip-service');
const packageService = require('./lib/package-service');

class Package {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.servicePath = this.serverless.serviceDir || '';
    this.packagePath =
      this.options.package ||
      this.serverless.service.package.path ||
      path.join(this.servicePath || '.', '.serverless');

    Object.assign(this, packageService, zipService);

    this.commands = {
      package: {
        ...cliCommandsSchema.get('package'),
        commands: {
          function: {
            type: 'entrypoint',
            lifecycleEvents: ['package'],
          },
        },
      },
    };

    this.hooks = {
      'package:createDeploymentArtifacts': async () => this.packageService(),

      'package:function:package': async () => {
        if (this.options.function) {
          return this.packageFunction(this.options.function);
        }
        throw new ServerlessError('Function name must be set', 'PACKAGE_MISSING_FUNCTION_OPTION');
      },
    };
  }
}

module.exports = Package;
