'use strict';

const { ECRClient, DeleteRepositoryCommand } = require('@aws-sdk/client-ecr');

function getEcrClient(context) {
  context.ecrClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new ECRClient(config));
  return context.ecrClientPromise;
}

module.exports = {
  async removeEcrRepository() {
    const registryId = await this.provider.getAccountId();
    const repositoryName = this.provider.naming.getEcrRepositoryName();
    const params = {
      registryId,
      repositoryName,
      force: true, // To ensure removal of non-empty repository
    };

    const ecr = await getEcrClient(this);
    await ecr.send(new DeleteRepositoryCommand(params));
  },
};
