'use strict';

const expect = require('chai').expect;
const generateArtifactDirectoryName = require('../../../../../../../lib/plugins/aws/package/lib/generate-artifact-directory-name');

describe('#generateArtifactDirectoryName()', () => {
  let awsPackage;

  beforeEach(() => {
    awsPackage = {
      ...generateArtifactDirectoryName,
      provider: {
        getDeploymentPrefix: () => 'serverless',
        getStage: () => 'dev',
      },
      serverless: {
        service: {
          service: 'service',
          package: {},
        },
      },
    };
  });

  it('should generate a name for the artifact directory based on the current time', () => {
    awsPackage.generateArtifactDirectoryName();
    expect(awsPackage.serverless.service.package.artifactDirectoryName).to.match(
      /^serverless\/service\/dev\/[0-9]+-.+/
    );
  });
});
