import { expect } from 'chai';
import generateArtifactDirectoryName from '../../../../../../../lib/plugins/aws/package/lib/generate-artifact-directory-name.ts';

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
