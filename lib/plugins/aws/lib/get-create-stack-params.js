'use strict';

module.exports = {
  getCreateStackParams(options) {
    const params = this.getSharedStackActionParams(options);

    // CloudFormation rejects OnFailure in express mode
    if (this.serverless.service.provider.deploymentMode !== 'express') {
      if (this.serverless.service.provider.disableRollback) {
        params.DisableRollback = this.serverless.service.provider.disableRollback;
      } else {
        params.OnFailure = 'DELETE';
      }
    }

    return params;
  },
};
