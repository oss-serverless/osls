import global from './global.ts';

const options = {
  config: {
    usage: 'Path to serverless config file',
    shortcut: 'c',
  },
  stage: {
    usage: 'Stage of the service',
    shortcut: 's',
  },
  param: {
    usage: 'Pass custom parameter values for "param" variable source (usage: --param="key=value")',
    type: 'multiple',
  },
  ...global,
};

for (const optionSchema of Object.values(options)) {
  if (!optionSchema.type) optionSchema.type = 'string';
}

export default options;
