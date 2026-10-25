'use strict';

const path = require('path');
const { removeSync } = require('../../../../utils/fs/remove');

module.exports = {
  async cleanupTempDir() {
    if (this.serverless.serviceDir) {
      const serverlessTmpDirPath = path.join(this.serverless.serviceDir, '.serverless');

      if (this.serverless.utils.dirExistsSync(serverlessTmpDirPath)) {
        removeSync(serverlessTmpDirPath);
      }
    }
  },
};
