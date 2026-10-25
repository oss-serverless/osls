import path from 'node:path';
import mergePlainObjects from '../utils/merge-plain-objects.ts';

class Config {
  constructor(serverless, config) {
    this.serverless = serverless;
    this.serverlessPath = path.join(import.meta.dirname, '..');

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

export default Config;
