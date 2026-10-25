'use strict';

const resolveStage = require('../utils/resolve-stage');

module.exports = async (options, configuration) => {
  if (!configuration.useDotenv) return false;
  require('./load-dotenv')(resolveStage({ configuration, options }));
  return true;
};
