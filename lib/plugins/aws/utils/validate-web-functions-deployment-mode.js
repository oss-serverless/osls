'use strict';

const ServerlessError = require('../../../serverless-error');

module.exports = (provider) => {
  if (provider.deploymentMode === 'express' && provider.disableRollback) {
    throw new ServerlessError(
      'Web functions cannot be deployed with "provider.deploymentMode: express" together with "provider.disableRollback: true", because CloudFormation then rejects the replacement of the revision that a change to the code or most settings of a web function makes. Remove "disableRollback" or use the default deployment mode.',
      'WEB_FUNCTIONS_EXPRESS_MODE_WITHOUT_ROLLBACK_UNSUPPORTED'
    );
  }
};
