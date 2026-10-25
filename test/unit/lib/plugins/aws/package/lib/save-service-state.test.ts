'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const path = require('path');
const saveServiceState = require('../../../../../../../lib/plugins/aws/package/lib/save-service-state');

describe('#saveServiceState()', () => {
  let awsPackage;
  let getServiceStateFileNameStub;
  let writeFileSyncStub;

  beforeEach(() => {
    getServiceStateFileNameStub = sinon.stub().returns('service-state.json');
    writeFileSyncStub = sinon.stub();
    awsPackage = {
      ...saveServiceState,
      provider: {
        naming: {
          getServiceStateFileName: getServiceStateFileNameStub,
        },
      },
      serverless: {
        serviceDir: 'my-service',
        service: {
          provider: {
            compiledCloudFormationTemplate: 'compiled content',
          },
          package: {
            individually: false,
            artifactDirectoryName: 'artifact-directory',
            artifact: 'service.zip',
          },
        },
        utils: {
          writeFileSync: writeFileSyncStub,
        },
      },
    };
  });

  it('should write the service state file template to disk', async () => {
    const filePath = path.join(
      awsPackage.serverless.serviceDir,
      '.serverless',
      'service-state.json'
    );

    await awsPackage.saveServiceState();
    const expectedStateFileContent = {
      service: {
        provider: {
          compiledCloudFormationTemplate: 'compiled content',
        },
      },
      package: {
        individually: false,
        artifactDirectoryName: 'artifact-directory',
        artifact: 'service.zip',
      },
    };

    expect(getServiceStateFileNameStub.calledOnce).to.equal(true);
    expect(writeFileSyncStub.calledWithExactly(filePath, expectedStateFileContent, true)).to.equal(
      true
    );
  });
});
