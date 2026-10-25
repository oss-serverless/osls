'use strict';

const { Readable } = require('stream');
const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const resolveMeta = require('../../../../../../../lib/configuration/variables/resolve-meta');
const resolve = require('../../../../../../../lib/configuration/variables/resolve');
const selfSource = require('../../../../../../../lib/configuration/variables/sources/self');

describe('test/unit/lib/configuration/variables/sources/instance-dependent/get-s3.test.js', () => {
  let configuration;
  let variablesMeta;
  let sends;
  let clientInstances;
  let getAwsSdkV3Config;
  let credentials;

  class GetObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }

  function loadSource(handler) {
    sends = [];
    clientInstances = [];
    credentials = sinon.stub();
    getAwsSdkV3Config = sinon.stub().callsFake(async ({ region }) => ({
      region,
      credentials,
    }));

    class S3Client {
      constructor(config) {
        this.config = config;
        clientInstances.push(this);
      }

      async send(command) {
        sends.push({ config: this.config, input: command.input });
        return handler(command.input, this.config);
      }
    }

    const getS3Source = proxyquire
      .noCallThru()
      .load('../../../../../../../lib/configuration/variables/sources/instance-dependent/get-s3', {
        '@aws-sdk/client-s3': { S3Client, GetObjectCommand },
      });

    return getS3Source({
      getProvider: () => ({ getRegion: () => 'us-east-1', getAwsSdkV3Config }),
    });
  }

  before(async () => {
    configuration = {
      service: 'foo',
      provider: { name: 'aws' },
      custom: {
        existing: '${s3:existing/someKey}',
        existingAgain: '${s3:existing/someKey}',
        emptyBody: '${s3:existing/emptyKey}',
        streamBody: '${s3:existing/streamKey}',
        streamBodyAgain: '${s3:existing/streamKey}',
        noKeyByName: '${s3:existing/noKeyByName, null}',
        noKeyByCode: '${s3:existing/noKeyByCode, null}',
        inheritedNoKeyCode: '${s3:existing/inheritedNoKeyCode}',
        inheritedNoKeyName: '${s3:existing/inheritedNoKeyName}',
        noBucket: '${s3:notExisting/someKey, null}',
        badBody: '${s3:existing/badBody}',
        missingAddress: '${s3:}',
        invalidAddress: '${s3:invalid}',
        nonStringAddress: '${s3:${self:custom.someObject}}',
        someObject: {},
      },
    };
    variablesMeta = resolveMeta(configuration);

    const source = loadSource(({ Bucket, Key }) => {
      if (Bucket === 'existing') {
        if (Key === 'someKey') return { Body: 'foo' };
        if (Key === 'emptyKey') return { Body: '' };
        if (Key === 'streamKey') return { Body: Readable.from(['fo', 'o']) };
        if (Key === 'noKeyByName') {
          throw Object.assign(new Error('The specified key does not exist.'), {
            name: 'NoSuchKey',
          });
        }
        if (Key === 'noKeyByCode') {
          throw Object.assign(new Error('The specified key does not exist.'), {
            Code: 'NoSuchKey',
          });
        }
        if (Key === 'inheritedNoKeyCode') {
          const error = new Error('The specified key does not exist.');
          Object.setPrototypeOf(
            error,
            Object.assign(Object.create(Object.getPrototypeOf(error)), { Code: 'NoSuchKey' })
          );
          throw error;
        }
        if (Key === 'inheritedNoKeyName') {
          const error = new Error('The specified key does not exist.');
          Object.setPrototypeOf(
            error,
            Object.assign(Object.create(Object.getPrototypeOf(error)), { name: 'NoSuchKey' })
          );
          throw error;
        }
        if (Key === 'badBody') return { Body: { unsupported: true } };
      }
      throw Object.assign(new Error('The specified bucket does not exist.'), {
        name: 'NoSuchBucket',
      });
    });

    await resolve({
      serviceDir: process.cwd(),
      configuration,
      variablesMeta,
      sources: { self: selfSource, s3: source },
      options: {},
      fulfilledSources: new Set(['s3', 'self']),
    });
  });

  function getSendsByBucketAndKey(bucket, key) {
    return sends.filter(({ input }) => input.Bucket === bucket && input.Key === key);
  }

  it('should resolve existing output', () => {
    if (variablesMeta.get('custom\0existing')) throw variablesMeta.get('custom\0existing').error;
    expect(configuration.custom.existing).to.equal('foo');
    expect(configuration.custom.existingAgain).to.equal('foo');
  });

  it('should use AWS SDK v3 config and preserve credential providers', () => {
    expect(getAwsSdkV3Config).to.have.been.calledWith({
      region: 'us-east-1',
      followRegionRedirects: true,
    });
    expect(clientInstances[0].config.credentials).to.equal(credentials);
  });

  it('should not request S3 acceleration config for variable reads', () => {
    for (const call of getAwsSdkV3Config.getCalls()) {
      expect(call.firstArg).to.not.have.property('service');
      expect(call.firstArg).to.not.have.property('useAccelerateEndpoint');
    }
    for (const { config } of sends) {
      expect(config).to.not.have.property('useAccelerateEndpoint');
    }
  });

  it('should cache repeated object lookups', () => {
    expect(getSendsByBucketAndKey('existing', 'someKey')).to.have.length(1);
  });

  it('should resolve empty object bodies as empty strings', () => {
    if (variablesMeta.get('custom\0emptyBody')) throw variablesMeta.get('custom\0emptyBody').error;
    expect(configuration.custom.emptyBody).to.equal('');
  });

  it('should convert stream bodies to strings', () => {
    if (variablesMeta.get('custom\0streamBody'))
      throw variablesMeta.get('custom\0streamBody').error;
    if (variablesMeta.get('custom\0streamBodyAgain'))
      throw variablesMeta.get('custom\0streamBodyAgain').error;
    expect(configuration.custom.streamBody).to.equal('foo');
    expect(configuration.custom.streamBodyAgain).to.equal('foo');
    expect(getSendsByBucketAndKey('existing', 'streamKey')).to.have.length(1);
  });

  it('should resolve null on missing key', () => {
    if (variablesMeta.get('custom\0noKeyByName'))
      throw variablesMeta.get('custom\0noKeyByName').error;
    if (variablesMeta.get('custom\0noKeyByCode'))
      throw variablesMeta.get('custom\0noKeyByCode').error;
    expect(configuration.custom.noKeyByName).to.equal(null);
    expect(configuration.custom.noKeyByCode).to.equal(null);
  });

  it('should not treat inherited NoSuchKey codes as missing keys', () => {
    expect(variablesMeta.get('custom\0inheritedNoKeyCode').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
    expect(variablesMeta.get('custom\0inheritedNoKeyCode').error.message).to.include(
      'The specified key does not exist.'
    );
  });

  it('should not treat inherited NoSuchKey names as missing keys', () => {
    expect(variablesMeta.get('custom\0inheritedNoKeyName').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
    expect(variablesMeta.get('custom\0inheritedNoKeyName').error.message).to.include(
      'The specified key does not exist.'
    );
  });

  it('should report with an error missing bucket', () =>
    expect(variablesMeta.get('custom\0noBucket').error.code).to.equal('VARIABLE_RESOLUTION_ERROR'));

  it('should report with an error unsupported body', () => {
    expect(variablesMeta.get('custom\0badBody').error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    expect(variablesMeta.get('custom\0badBody').error.message).to.include(
      'Unsupported S3 GetObject Body type'
    );
  });

  it('should report with an error missing address', () =>
    expect(variablesMeta.get('custom\0missingAddress').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    ));

  it('should report with an error invalid address', () =>
    expect(variablesMeta.get('custom\0invalidAddress').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    ));

  it('should report with an error a non-string address', () =>
    expect(variablesMeta.get('custom\0nonStringAddress').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    ));
});
