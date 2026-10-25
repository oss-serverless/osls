import { hasOwn } from './safe-object.ts';
import validateStage from './validate-stage.ts';

const resolveStage = ({ configuration, options }) => {
  if (hasOwn(options, 'stage')) return validateStage(options.stage);
  if (configuration && configuration.provider && hasOwn(configuration.provider, 'stage')) {
    return validateStage(configuration.provider.stage);
  }
  return 'dev';
};

export default resolveStage;
