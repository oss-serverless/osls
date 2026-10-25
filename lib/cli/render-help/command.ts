import { writeText } from '../../utils/serverless-utils/log.ts';
import resolveInput from '../resolve-input.ts';
import renderOptionsHelp from './options.ts';
import generateCommandUsage from './generate-command-usage.ts';

export default (commandName, resolvedInput = resolveInput()) => {
  const { commandsSchema } = resolvedInput;
  const commandSchema = commandsSchema.get(commandName);

  if (commandSchema) {
    writeText(generateCommandUsage(commandName, commandSchema));
  }
  for (const [subCommandName, subCommandSchema] of commandsSchema) {
    if (!subCommandName.startsWith(`${commandName} `)) continue;
    writeText(generateCommandUsage(subCommandName, subCommandSchema));
  }
  if (commandSchema) renderOptionsHelp(Object.assign({}, commandSchema.options));

  writeText();
};
