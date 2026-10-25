'use strict';

const os = require('os');
const isObject = require('type/object/is');
const jc = require('json-cycle');
const yaml = require('js-yaml');
const ServerlessError = require('../serverless-error');
const cliCommandsSchema = require('../cli/commands-schema');
const { getReachableByPath } = require('../utils/safe-object');
const { writeText } = require('../utils/serverless-utils/log');

class Print {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.cache = {};

    this.commands = {
      print: {
        ...cliCommandsSchema.get('print'),
      },
    };
    this.hooks = {
      'print:print': this.print.bind(this),
    };
  }

  async print() {
    let conf = this.serverless.configurationInput;

    // dig into the object
    if (this.options.path) {
      const steps = this.options.path.split('.');
      conf = getReachableByPath(conf, steps);

      if (conf === undefined) {
        throw new ServerlessError(`Path "${this.options.path}" not found`, 'INVALID_PATH_ARGUMENT');
      }
    }

    // apply an optional filter
    if (this.options.transform) {
      if (this.options.transform === 'keys') {
        conf = Object.keys(conf);
      } else {
        throw new ServerlessError('Transform can only be "keys"', 'INVALID_TRANSFORM');
      }
    }

    // print configuration in the specified format
    const format = this.options.format || 'yaml';
    let out;

    if (format === 'text') {
      if (Array.isArray(conf)) {
        out = conf.join(os.EOL);
      } else {
        if (isObject(conf)) {
          throw new ServerlessError(
            'Cannot print an object as "text"',
            'PRINT_INVALID_OBJECT_AS_TEXT'
          );
        }

        out = String(conf);
      }
    } else if (format === 'json') {
      out = jc.stringify(conf, null, '  ');
    } else if (format === 'yaml') {
      out = yaml.dump(JSON.parse(jc.stringify(conf)), { noRefs: true });
    } else {
      throw new ServerlessError('Format must be "yaml", "json" or "text"', 'PRINT_INVALID_FORMAT');
    }

    writeText(out);
  }
}

module.exports = Print;
