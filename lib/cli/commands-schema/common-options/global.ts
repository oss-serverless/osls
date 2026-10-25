const options = {
  help: { usage: 'Show this message', shortcut: 'h', type: 'boolean' },
  version: { usage: 'Show version info', shortcut: 'v', type: 'boolean' },
  verbose: { usage: 'Show verbose logs', type: 'boolean' },
  debug: { usage: 'Namespace of debug logs to expose (use "*" to display all)', type: 'string' },
};

for (const optionSchema of Object.values(options)) {
  if (!optionSchema.type) optionSchema.type = 'string';
}

export default options;
