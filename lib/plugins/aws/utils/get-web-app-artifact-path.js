'use strict';

const path = require('path');

/**
 * @param packagePath {string}
 * @param webAppName {string}
 * @param service
 * @param naming
 * @returns {string}
 */
module.exports = (packagePath, webAppName, service, naming) => {
  const webAppObject = service.getWebApp(webAppName);
  if (webAppObject.package && webAppObject.package.artifact) {
    return webAppObject.package.artifact;
  }
  return path.join(packagePath, naming.getWebAppArtifactName(webAppName));
};
