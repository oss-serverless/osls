import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import path from 'node:path';
import ServerlessError from '../serverless-error.ts';
import validateStage from '../utils/validate-stage.ts';

const isMissingFileError = (error) => error.code === 'ENOENT';

const throwDotenvError = (error, filePath) => {
  const errorMessage = `Failed to load environment variables from "${filePath}": ${error}`;
  throw new ServerlessError(errorMessage, 'DOTENV_LOAD_ERROR');
};

const loadDotenvFrom = (envFilePath) => {
  const config = dotenv.config({ path: envFilePath, quiet: true });
  return dotenvExpand.expand(config);
};

export default (stage) => {
  stage = validateStage(stage);
  const defaultEnvFilePath = path.join(process.cwd(), '.env');
  const stageEnvFilePath = path.join(process.cwd(), `.env.${stage}`);

  const { error: stageEnvResultError } = loadDotenvFrom(stageEnvFilePath);

  if (!stageEnvResultError) return;

  if (!isMissingFileError(stageEnvResultError)) {
    throwDotenvError(stageEnvResultError, stageEnvFilePath);
  }

  const { error: defaultEnvResultError } = loadDotenvFrom(defaultEnvFilePath);

  if (defaultEnvResultError && !isMissingFileError(defaultEnvResultError)) {
    throwDotenvError(defaultEnvResultError, defaultEnvFilePath);
  }
};
