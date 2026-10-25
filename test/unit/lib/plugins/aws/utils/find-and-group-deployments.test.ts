'use strict';

const expect = require('chai').expect;
const findAndGroupDeployments = require('../../../../../../lib/plugins/aws/utils/find-and-group-deployments');

describe('#findAndGroupDeployments()', () => {
  it('should return an empty result in case no S3 objects are provided', () => {
    const s3Response = {
      Contents: [],
    };

    expect(findAndGroupDeployments(s3Response, 'serverless', 'test', 'dev')).to.deep.equal([]);
  });

  it('should return an empty result when Contents is missing', () => {
    expect(findAndGroupDeployments({}, 'serverless', 'test', 'dev')).to.deep.equal([]);
  });

  it('should group stacks', () => {
    const s3Objects = [
      {
        Key: 'serverless/test/dev/1476779096930-2016-10-18T08:24:56.930Z/compiled-cloudformation-template.json',
      },
      {
        Key: 'serverless/test/dev/1476779096930-2016-10-18T08:24:56.930Z/test.zip',
      },
      {
        Key: 'serverless/test/dev/1476779278222-2016-10-18T08:27:58.222Z/compiled-cloudformation-template.json',
      },
      {
        Key: 'serverless/test/dev/1476779278222-2016-10-18T08:27:58.222Z/test.zip',
      },
      {
        Key: 'serverless/test/dev/1476781042481-2016-10-18T08:57:22.481Z/compiled-cloudformation-template.json',
      },
      {
        Key: 'serverless/test/dev/1476781042481-2016-10-18T08:57:22.481Z/test.zip',
      },
    ];
    const s3Response = {
      Contents: s3Objects,
    };

    const expected = [
      [
        {
          directory: '1476779096930-2016-10-18T08:24:56.930Z',
          file: 'compiled-cloudformation-template.json',
        },
        {
          directory: '1476779096930-2016-10-18T08:24:56.930Z',
          file: 'test.zip',
        },
      ],
      [
        {
          directory: '1476779278222-2016-10-18T08:27:58.222Z',
          file: 'compiled-cloudformation-template.json',
        },
        {
          directory: '1476779278222-2016-10-18T08:27:58.222Z',
          file: 'test.zip',
        },
      ],
      [
        {
          directory: '1476781042481-2016-10-18T08:57:22.481Z',
          file: 'compiled-cloudformation-template.json',
        },
        {
          directory: '1476781042481-2016-10-18T08:57:22.481Z',
          file: 'test.zip',
        },
      ],
    ];

    expect(findAndGroupDeployments(s3Response, 'serverless', 'test', 'dev')).to.deep.equal(
      expected
    );
  });

  it('should group deployment keys with regex-significant service, stage, and prefix values', () => {
    const s3Response = {
      Contents: [
        {
          Key: 'serverless.v1/service+name/dev.prod/1476779096930-2016-10-18T08:24:56.930Z/artifact.zip',
        },
        {
          Key: 'serverlessXv1/service+name/dev.prod/1476779096930-2016-10-18T08:24:56.930Z/ignored.zip',
        },
      ],
    };

    expect(
      findAndGroupDeployments(s3Response, 'serverless.v1', 'service+name', 'dev.prod')
    ).to.deep.equal([
      [
        {
          directory: '1476779096930-2016-10-18T08:24:56.930Z',
          file: 'artifact.zip',
        },
      ],
    ]);
  });

  it('should preserve nested object paths inside deployment directories', () => {
    const s3Response = {
      Contents: [
        {
          Key: 'serverless/test/dev/1476779096930-2016-10-18T08:24:56.930Z/nested/artifact.zip',
        },
      ],
    };

    expect(findAndGroupDeployments(s3Response, 'serverless', 'test', 'dev')).to.deep.equal([
      [
        {
          directory: '1476779096930-2016-10-18T08:24:56.930Z',
          file: 'nested/artifact.zip',
        },
      ],
    ]);
  });
});
