'use strict';

const { log } = require('../../../utils/serverless-utils/log');
const { ECRClient, DescribeRepositoriesCommand } = require('@aws-sdk/client-ecr');
const {
  isEcrRepositoryNotFoundError,
  isEcrAccessDeniedError,
} = require('../../../aws/aws-sdk-v3-error');

function getEcrClient(context) {
  context.ecrClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new ECRClient(config));
  return context.ecrClientPromise;
}

module.exports = {
  async checkIfEcrRepositoryExists() {
    const registryId = await this.provider.getAccountId();
    const repositoryName = this.provider.naming.getEcrRepositoryName();
    try {
      const ecr = await getEcrClient(this);
      await ecr.send(
        new DescribeRepositoriesCommand({
          repositoryNames: [repositoryName],
          registryId,
        })
      );
      return true;
    } catch (err) {
      if (isEcrRepositoryNotFoundError(err)) {
        return false;
      }
      if (isEcrAccessDeniedError(err)) {
        if (this.serverless.service.provider.ecr && this.serverless.service.provider.ecr.images) {
          log.warning(
            'Could not access ECR repository due to denied access, but there are images defined in "provider.ecr". ECR repository removal will be skipped.'
          );
        }
        // Check if user has images defined and issue warning that we could not
        return false;
      }
      throw err;
    }
  },
};
