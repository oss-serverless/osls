// CLI params parser, to be used before we have deducted what commands and options are supported in given context

'use strict';

const ensureMap = require('type/map/ensure');
const parseArgs = require('./parse-args');

const isParamName = RegExp.prototype.test.bind(require('./param-reg-exp'));

let cachedResult;

const resolveArgsSchema = (commandOptionsSchema) => {
  const options = { boolean: new Set(), string: new Set(), alias: new Map(), multiple: new Set() };
  for (const [name, optionSchema] of Object.entries(commandOptionsSchema)) {
    switch (optionSchema.type) {
      case 'boolean':
        options.boolean.add(name);
        break;
      case 'multiple':
        options.multiple.add(name);
        break;
      case 'string':
        options.string.add(name);
        break;
      default:
    }
    if (optionSchema.shortcut) options.alias.set(optionSchema.shortcut, name);
  }
  return options;
};

const resolveInput = function (commandsSchema, argv = process.argv.slice(2)) {
  if (arguments.length === 0 && cachedResult !== undefined) return cachedResult;

  commandsSchema = ensureMap(
    commandsSchema === undefined ? require('./commands-schema') : commandsSchema
  );
  const firstParamIndex = argv.findIndex(isParamName);

  const commands = argv.slice(0, firstParamIndex === -1 ? Infinity : firstParamIndex);
  const command = commands.join(' ');
  const commandSchema = commandsSchema.get(command);
  const options = parseArgs(
    argv.slice(firstParamIndex === -1 ? Infinity : firstParamIndex),
    resolveArgsSchema(commandSchema ? commandSchema.options : commandsSchema.commonOptions)
  );
  delete options._;

  const result = { commands, options, command, commandSchema, commandsSchema };
  if (!commandSchema) {
    result.isContainerCommand = Array.from(commandsSchema.keys()).some((commandName) =>
      commandName.startsWith(`${command} `)
    );
    if (result.isContainerCommand) {
      result.isHelpRequest = true;
    }
  }

  if (options.help || options.version || command === 'help') {
    result.isHelpRequest = true;
  }

  cachedResult = result;
  return result;
};

resolveInput.clear = () => {
  cachedResult = undefined;
};

module.exports = resolveInput;
