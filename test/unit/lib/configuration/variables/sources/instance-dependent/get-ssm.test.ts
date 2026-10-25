'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const resolveMeta = require('../../../../../../../lib/configuration/variables/resolve-meta');
const resolve = require('../../../../../../../lib/configuration/variables/resolve');
const selfSource = require('../../../../../../../lib/configuration/variables/sources/self');

describe('test/unit/lib/configuration/variables/sources/instance-dependent/get-ssm.test.js', () => {
  let configuration;
  let variablesMeta;
  let sends;
  let clientInstances;
  let getAwsSdkV3Config;
  let credentials;

  class GetParameterCommand {
    constructor(input) {
      this.input = input;
    }
  }

  function loadSource(handler) {
    sends = [];
    clientInstances = [];
    credentials = sinon.stub().resolves({
      accessKeyId: 'accessKeyId',
      secretAccessKey: 'secretAccessKey',
    });
    getAwsSdkV3Config = sinon.stub().callsFake(async ({ region }) => ({
      region,
      credentials,
    }));

    class SSMClient {
      constructor(config) {
        this.config = config;
        clientInstances.push(this);
      }

      async send(command) {
        sends.push({ config: this.config, input: command.input });
        return handler(command.input, this.config);
      }
    }

    const getSsmSource = proxyquire
      .noCallThru()
      .load('../../../../../../../lib/configuration/variables/sources/instance-dependent/get-ssm', {
        '@aws-sdk/client-ssm': { SSMClient, GetParameterCommand },
      });

    return getSsmSource({
      getProvider: () => ({ getRegion: () => 'us-east-1', getAwsSdkV3Config }),
    });
  }

  before(async () => {
    configuration = {
      service: 'foo',
      provider: { name: 'aws' },
      custom: {
        existing: '${ssm:existing}',
        existingAgain: '${ssm:existing}',
        existingInRegion: '${ssm(eu-west-1):existing}',
        existingList: '${ssm:existingList}',
        existingListRaw: '${ssm(raw):existingList}',
        secretManager: '${ssm:/aws/reference/secretsmanager/existing}',
        existingEncrypted: '${ssm:/secret/existing}',
        encryptedWithSkipDecrypt: '${ssm(noDecrypt):/secret/existing}',
        encryptedWithSkipDecryptAndRegion: '${ssm(noDecrypt, eu-west-1):/secret/existing}',
        existingEncryptedDirect: '${ssm:/secret/direct}',
        existingEncryptedRaw: '${ssm(raw):/aws/reference/secretsmanager/existing}',
        notExistingByName: '${ssm:notExistingByName, null}',
        notExistingByCode: '${ssm:notExistingByCode, null}',
        inheritedNotFoundCode: '${ssm:inheritedNotFoundCode}',
        inheritedNotFoundName: '${ssm:inheritedNotFoundName}',
        expiredSso: '${ssm:expiredSso}',
        missingAddress: '${ssm:}',
        nonStringAddress: '${ssm:${self:custom.someObject}}',
        someObject: {},
      },
    };
    variablesMeta = resolveMeta(configuration);

    const source = loadSource(({ Name, WithDecryption }, { region }) => {
      if (Name === 'existing') {
        return { Parameter: { Type: 'String', Value: region === 'eu-west-1' ? region : 'value' } };
      }
      if (Name === 'existingList') {
        return { Parameter: { Type: 'StringList', Value: 'one,two,three' } };
      }
      if (Name === '/secret/existing' || Name === '/aws/reference/secretsmanager/existing') {
        return {
          Parameter: {
            Type: 'SecureString',
            Value: WithDecryption ? '{"someSecret":"someValue"}' : 'ENCRYPTED',
          },
        };
      }
      if (Name === '/secret/direct') {
        return {
          Parameter: {
            Type: 'SecureString',
            Value: WithDecryption ? '12345678901234567890' : 'ENCRYPTED',
          },
        };
      }
      if (Name === 'notExistingByName') {
        throw Object.assign(new Error('ParameterNotFound'), { name: 'ParameterNotFound' });
      }
      if (Name === 'notExistingByCode') {
        throw Object.assign(new Error('ParameterNotFound'), { Code: 'ParameterNotFound' });
      }
      if (Name === 'inheritedNotFoundCode') {
        const error = new Error('ParameterNotFound');
        Object.setPrototypeOf(
          error,
          Object.assign(Object.create(Object.getPrototypeOf(error)), { Code: 'ParameterNotFound' })
        );
        throw error;
      }
      if (Name === 'inheritedNotFoundName') {
        const error = new Error('ParameterNotFound');
        Object.setPrototypeOf(
          error,
          Object.assign(Object.create(Object.getPrototypeOf(error)), { name: 'ParameterNotFound' })
        );
        throw error;
      }
      if (Name === 'expiredSso') {
        throw new Error('SSO session has expired');
      }
      throw new Error(`Unexpected SSM call: ${Name}`);
    });

    await resolve({
      serviceDir: process.cwd(),
      configuration,
      variablesMeta,
      sources: { self: selfSource, ssm: source },
      options: {},
      fulfilledSources: new Set(['self', 'ssm']),
    });
  });

  function getSendsByName(name) {
    return sends.filter(({ input }) => input.Name === name);
  }

  it('should resolve existing string param', () => {
    if (variablesMeta.get('custom\0existing')) throw variablesMeta.get('custom\0existing').error;
    expect(configuration.custom.existing).to.equal('value');
    expect(configuration.custom.existingAgain).to.equal('value');
  });

  it('should use AWS SDK v3 config and preserve credential providers', () => {
    expect(getAwsSdkV3Config).to.have.been.calledWith({ region: 'us-east-1' });
    expect(clientInstances[0].config.credentials).to.equal(credentials);
  });

  it('should cache repeated lookups with the same name, region, and decryption setting', () => {
    expect(getSendsByName('existing')).to.have.length(2);
    expect(
      getSendsByName('existing').filter(({ config }) => config.region === 'us-east-1')
    ).to.have.length(1);
  });

  it('should resolve existing string list param', () => {
    if (variablesMeta.get('custom\0existingList')) {
      throw variablesMeta.get('custom\0existingList').error;
    }
    expect(configuration.custom.existingList).to.deep.equal(['one', 'two', 'three']);
  });

  it('should support "raw" output for list param', () => {
    if (variablesMeta.get('custom\0existingListRaw')) {
      throw variablesMeta.get('custom\0existingListRaw').error;
    }
    expect(configuration.custom.existingListRaw).to.equal('one,two,three');
  });

  it('should resolve existing encrypted AWS secret manager data', () => {
    if (variablesMeta.get('custom\0secretManager')) {
      throw variablesMeta.get('custom\0secretManager').error;
    }
    expect(configuration.custom.secretManager).to.deep.equal({ someSecret: 'someValue' });
  });

  it('should resolve existing encrypted data', () => {
    if (variablesMeta.get('custom\0existingEncrypted')) {
      throw variablesMeta.get('custom\0existingEncrypted').error;
    }
    if (variablesMeta.get('custom\0existingEncryptedDirect')) {
      throw variablesMeta.get('custom\0existingEncryptedDirect').error;
    }
    if (variablesMeta.get('custom\0encryptedWithSkipDecrypt')) {
      throw variablesMeta.get('custom\0encryptedWithSkipDecrypt').error;
    }
    if (variablesMeta.get('custom\0encryptedWithSkipDecryptAndRegion')) {
      throw variablesMeta.get('custom\0encryptedWithSkipDecryptAndRegion').error;
    }
    expect(configuration.custom.existingEncrypted).to.deep.equal({ someSecret: 'someValue' });
    expect(configuration.custom.existingEncryptedDirect).to.equal('12345678901234567890');
    expect(configuration.custom.encryptedWithSkipDecrypt).to.equal('ENCRYPTED');
    expect(configuration.custom.encryptedWithSkipDecryptAndRegion).to.equal('ENCRYPTED');
  });

  it('should support "raw" output for decrypted data', () => {
    if (variablesMeta.get('custom\0existingEncryptedRaw')) {
      throw variablesMeta.get('custom\0existingEncryptedRaw').error;
    }
    expect(configuration.custom.existingEncryptedRaw).to.equal('{"someSecret":"someValue"}');
  });

  it('should resolve existing output in specific region', () => {
    if (variablesMeta.get('custom\0existingInRegion')) {
      throw variablesMeta.get('custom\0existingInRegion').error;
    }
    expect(configuration.custom.existingInRegion).to.equal('eu-west-1');
    expect(getAwsSdkV3Config).to.have.been.calledWith({ region: 'eu-west-1' });
  });

  it('should pass decryption settings to GetParameterCommand', () => {
    expect(
      getSendsByName('/secret/existing').map(({ input }) => input.WithDecryption)
    ).to.have.members([true, false, false]);
  });

  it('should separate cache entries by decryption setting and region', () => {
    expect(getSendsByName('/secret/existing')).to.have.length(3);
  });

  it('should resolve null on missing params', () => {
    if (variablesMeta.get('custom\0notExistingByName')) {
      throw variablesMeta.get('custom\0notExistingByName').error;
    }
    if (variablesMeta.get('custom\0notExistingByCode')) {
      throw variablesMeta.get('custom\0notExistingByCode').error;
    }
    expect(configuration.custom.notExistingByName).to.equal(null);
    expect(configuration.custom.notExistingByCode).to.equal(null);
  });

  it('should not treat inherited ParameterNotFound codes as missing params', () => {
    expect(variablesMeta.get('custom\0inheritedNotFoundCode').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
    expect(variablesMeta.get('custom\0inheritedNotFoundCode').error.message).to.include(
      'ParameterNotFound'
    );
  });

  it('should not treat inherited ParameterNotFound names as missing params', () => {
    expect(variablesMeta.get('custom\0inheritedNotFoundName').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
    expect(variablesMeta.get('custom\0inheritedNotFoundName').error.message).to.include(
      'ParameterNotFound'
    );
  });

  it('should not treat SSO errors as missing params', () => {
    expect(variablesMeta.get('custom\0expiredSso').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
    expect(variablesMeta.get('custom\0expiredSso').error.message).to.include(
      'SSO session has expired'
    );
  });

  it('should report with an error missing address', () =>
    expect(variablesMeta.get('custom\0missingAddress').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    ));

  it('should report with an error a non-string address', () =>
    expect(variablesMeta.get('custom\0nonStringAddress').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    ));
});
