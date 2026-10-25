import ServerlessError from '../serverless-error.ts';
import STAGE_NAME_PATTERN from './stage-pattern.ts';

const stageNamePattern = new RegExp(STAGE_NAME_PATTERN);

const validateStage = (stage) => {
  if (typeof stage !== 'string' || !stageNamePattern.test(stage)) {
    throw new ServerlessError(
      'Invalid stage name. Stage names may contain only ASCII letters, numbers, and hyphens.',
      'INVALID_STAGE'
    );
  }

  return stage;
};

export default validateStage;
module.exports.STAGE_NAME_PATTERN = STAGE_NAME_PATTERN;
