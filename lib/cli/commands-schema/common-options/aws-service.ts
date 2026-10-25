import service from './service.ts';

export default {
  'region': {
    usage: 'Region of the service',
    shortcut: 'r',
  },
  'aws-profile': {
    usage: 'AWS profile to use with the command',
  },
  ...service,
};

for (const optionSchema of Object.values(module.exports)) {
  if (!optionSchema.type) optionSchema.type = 'string';
}
