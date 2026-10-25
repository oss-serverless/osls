'use strict';

const path = require('path');

module.exports = {
  async saveServiceState() {
    const serviceStateFileName = this.provider.naming.getServiceStateFileName();

    const serviceStateFilePath = path.join(
      this.serverless.serviceDir,
      '.serverless',
      serviceStateFileName
    );

    const artifact = (
      (this.serverless.service.package && this.serverless.service.package.artifact) ||
      ''
    )
      .split(path.sep)
      .at(-1);

    // TODO: Store `serverless.configurationInput` without any tweaks and strips
    // (probably should be considered as breaking change)
    const strippedService = Object.fromEntries(
      Object.entries(this.serverless.service).filter(
        ([key]) => key !== 'serverless' && key !== 'package'
      )
    );

    const state = {
      service: strippedService,
      package: {
        individually: this.serverless.service.package.individually,
        artifactDirectoryName: this.serverless.service.package.artifactDirectoryName,
        artifact,
      },
    };

    this.serverless.utils.writeFileSync(serviceStateFilePath, state, true);
  },
};
