import path from 'node:path';
import { removeSync } from '../../../../utils/fs/remove.ts';

export default {
  async cleanupTempDir() {
    if (this.serverless.serviceDir) {
      const serverlessTmpDirPath = path.join(this.serverless.serviceDir, '.serverless');

      if (this.serverless.utils.dirExistsSync(serverlessTmpDirPath)) {
        removeSync(serverlessTmpDirPath);
      }
    }
  },
};
