'use strict';

const ServerlessError = require('../serverless-error');
const STAGE_NAME_PATTERN = require('./stage-pattern');

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

module.exports = validateStage;
module.exports.STAGE_NAME_PATTERN = STAGE_NAME_PATTERN;
