import resolveStage from '../utils/resolve-stage.ts';

export default async (options, configuration) => {
  if (!configuration.useDotenv) return false;
  (await import('./load-dotenv.ts')).default(resolveStage({ configuration, options }));
  return true;
};
