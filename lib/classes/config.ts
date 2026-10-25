'use strict';

const path = require('path');
const mergePlainObjects = require('../utils/merge-plain-objects');

class Config {
  constructor(serverless, config) {
    this.serverless = serverless;
    this.serverlessPath = path.join(__dirname, '..');

    if (config) this.update(config);
  }

  update(config) {
    return mergePlainObjects(this, config);
  }

  get servicePath() {
    return this.serverless.serviceDir;
  }

  set servicePath(value) {
    this.serverless.serviceDir = value;
  }
}

module.exports = Config;
