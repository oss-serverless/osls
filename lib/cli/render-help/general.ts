import { writeText, style } from '../../utils/serverless-utils/log.ts';
import { packageJson as packageModule } from '../../utils/package-root.ts';
import globalOptions from '../commands-schema/common-options/global.ts';
import resolveInput from '../resolve-input.ts';
import generateCommandUsage from './generate-command-usage.ts';
import renderOptions from './options.ts';
const { version } = packageModule;

export default (loadedPlugins, resolvedInput = resolveInput()) => {
  const { commandsSchema } = resolvedInput;

  writeText(
    `osls v${version}`,
    null,
    style.aside('Usage'),
    'serverless <command> <options>',
    'sls <command> <options>',
    null,
    style.aside('Options')
  );

  renderOptions(globalOptions, { shouldWriteModernOnly: true });

  const allCommands = new Map(
    Array.from(commandsSchema).filter(([commandName, { isHidden }]) => commandName && !isHidden)
  );
  const mainCommands = new Map(
    Array.from(allCommands).filter(([, { groupName }]) => groupName === 'main')
  );

  if (mainCommands.size) {
    writeText(null, style.aside('Main commands'));
    for (const [commandName, commandSchema] of mainCommands) {
      writeText(generateCommandUsage(commandName, commandSchema));
    }
    writeText(null, style.aside('Other commands'));
  } else {
    writeText(null, style.aside('All commands'));
  }

  const extensionCommandsSchema = new Map();

  for (const [commandName, commandSchema] of allCommands) {
    if (commandSchema.isExtension) {
      if (!extensionCommandsSchema.has(commandSchema.sourcePlugin)) {
        extensionCommandsSchema.set(commandSchema.sourcePlugin, new Map());
      }
      extensionCommandsSchema.get(commandSchema.sourcePlugin).set(commandName, commandSchema);
      continue;
    }
    if (commandSchema.groupName === 'main') continue;

    writeText(generateCommandUsage(commandName, commandSchema));
  }

  if (loadedPlugins.size) {
    if (extensionCommandsSchema.size) {
      for (const [plugin, pluginCommandsSchema] of extensionCommandsSchema) {
        writeText(null, style.aside(plugin.constructor.name));
        for (const [commandName, commandSchema] of pluginCommandsSchema) {
          writeText(generateCommandUsage(commandName, commandSchema));
        }
      }
    }
  }
  writeText();
};
