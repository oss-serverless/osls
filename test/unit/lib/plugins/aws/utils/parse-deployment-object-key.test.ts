'use strict';

const { expect } = require('chai');
const parseDeploymentObjectKey = require('../../../../../../lib/plugins/aws/utils/parse-deployment-object-key');

describe('test/unit/lib/plugins/aws/utils/parse-deployment-object-key.test.js', () => {
  it('parses a valid deployment object key', () => {
    expect(
      parseDeploymentObjectKey(
        'serverless/test/dev/151224711231-2016-08-18T15:43:00/artifact.zip',
        'serverless',
        'test',
        'dev'
      )
    ).to.deep.equal({
      directory: '151224711231-2016-08-18T15:43:00',
      file: 'artifact.zip',
    });
  });

  it('preserves nested file paths after the deployment directory', () => {
    expect(
      parseDeploymentObjectKey(
        'serverless/test/dev/151224711231-2016-08-18T15:43:00/nested/artifact.zip',
        'serverless',
        'test',
        'dev'
      )
    ).to.deep.equal({
      directory: '151224711231-2016-08-18T15:43:00',
      file: 'nested/artifact.zip',
    });
  });

  for (const [description, key, prefix, service, stage] of [
    [
      'wrong prefix',
      'other/test/dev/151224711231-2016-08-18T15:43:00/artifact.zip',
      'serverless',
      'test',
      'dev',
    ],
    [
      'wrong service',
      'serverless/other/dev/151224711231-2016-08-18T15:43:00/artifact.zip',
      'serverless',
      'test',
      'dev',
    ],
    [
      'wrong stage',
      'serverless/test/prod/151224711231-2016-08-18T15:43:00/artifact.zip',
      'serverless',
      'test',
      'dev',
    ],
    [
      'missing file',
      'serverless/test/dev/151224711231-2016-08-18T15:43:00/',
      'serverless',
      'test',
      'dev',
    ],
    [
      'non deployment directory',
      'serverless/test/dev/not-a-deployment/artifact.zip',
      'serverless',
      'test',
      'dev',
    ],
  ]) {
    it(`returns null for ${description}`, () => {
      expect(parseDeploymentObjectKey(key, prefix, service, stage)).to.equal(null);
    });
  }

  it('returns null when key is empty or missing', () => {
    expect(parseDeploymentObjectKey('', 'serverless', 'test', 'dev')).to.equal(null);
    expect(parseDeploymentObjectKey(null, 'serverless', 'test', 'dev')).to.equal(null);
  });
});
