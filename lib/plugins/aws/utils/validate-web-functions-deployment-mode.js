'use strict';

const ServerlessError = require('../../../serverless-error');

module.exports = (provider) => {
  // CloudFormation rejects replacements in this setup, and every change replaces the revision
  if (provider.deploymentMode === 'express' && provider.disableRollback) {
    throw new ServerlessError(
      'Web functions cannot be deployed with "provider.deploymentMode: express" together with "provider.disableRollback: true", because CloudFormation then rejects the replacement of a revision that every change to a web function makes. Remove "disableRollback" or use the default deployment mode.',
      'WEB_FUNCTIONS_EXPRESS_MODE_WITHOUT_ROLLBACK_UNSUPPORTED'
    );
  }
};
