import service from './commands-schema/common-options/service.ts';
import awsService from './commands-schema/common-options/aws-service.ts';

const serviceOptionsNames = Object.keys(service);
const awsServiceOptionsNames = Object.keys(awsService);

export default (options, { commandSchema, providerName }) => {
  const supportedNames = (() => {
    if (commandSchema) return Object.keys(commandSchema.options);
    return providerName === 'aws' ? awsServiceOptionsNames : serviceOptionsNames;
  })();
  const result = Object.create(null);
  for (const name of supportedNames) result[name] = options[name] == null ? null : options[name];
  return result;
};
