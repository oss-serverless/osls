'use strict';

const { hasOwn } = require('./safe-object');
const validateStage = require('./validate-stage');

const resolveStage = ({ configuration, options }) => {
  if (hasOwn(options, 'stage')) return validateStage(options.stage);
  if (configuration && configuration.provider && hasOwn(configuration.provider, 'stage')) {
    return validateStage(configuration.provider.stage);
  }
  return 'dev';
};

module.exports = resolveStage;
