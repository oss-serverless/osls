'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const resolveMeta = require('../../../../../../../lib/configuration/variables/resolve-meta');
const resolve = require('../../../../../../../lib/configuration/variables/resolve');
const selfSource = require('../../../../../../../lib/configuration/variables/sources/self');
const mergePlainObjects = require('../../../../../../../lib/utils/merge-plain-objects');

describe('test/unit/lib/configuration/variables/sources/instance-dependent/get-aws.test.js', () => {
  let configuration;
  let variablesMeta;
  let sends;
  let clientInstances;
  let getAwsSdkV3Config;
  let credentials;

  class GetCallerIdentityCommand {
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

    class STSClient {
      constructor(config) {
        this.config = config;
        clientInstances.push(this);
      }

      async send(command) {
        sends.push({ config: this.config, input: command.input });
        return handler(command.input, this.config);
      }
    }

    return proxyquire
      .noCallThru()
      .load('../../../../../../../lib/configuration/variables/sources/instance-dependent/get-aws', {
        '@aws-sdk/client-sts': { STSClient, GetCallerIdentityCommand },
      });
  }

  const createServerlessInstance = () => ({
    getProvider: () => ({
      getRegion: () => 'us-east-1',
      getAwsSdkV3Config,
    }),
  });

  const initializeServerless = async ({ configExt, options, custom, handler } = {}) => {
    configuration = {
      service: 'foo',
      provider: {
        name: 'aws',
      },
      custom: custom || {
        region: '${aws:region}',
        accountId: '${aws:accountId}',
        accountIdAgain: '${aws:accountId}',
        missingAddress: '${aws:}',
        invalidAddress: '${aws:invalid}',
        nonStringAddress: '${aws:${self:custom.someObject}}',
        someObject: {},
      },
    };
    if (configExt) configuration = mergePlainObjects(configuration, configExt);
    variablesMeta = resolveMeta(configuration);
    const serverlessInstance = createServerlessInstance();
    const getAwsSource = loadSource(handler || (() => ({ Account: '1234567890' })));

    await resolve({
      serviceDir: process.cwd(),
      configuration,
      variablesMeta,
      sources: { self: selfSource, aws: getAwsSource(serverlessInstance) },
      options: options || {},
      fulfilledSources: new Set(['self', 'aws']),
    });
  };

  it('should resolve `accountId` with STS', async () => {
    await initializeServerless();

    expect(configuration.custom.accountId).to.equal('1234567890');
    expect(configuration.custom.accountIdAgain).to.equal('1234567890');
    expect(getAwsSdkV3Config).to.have.been.calledOnceWithExactly({
      region: 'us-east-1',
    });
    expect(clientInstances).to.have.length(1);
    expect(clientInstances[0].config.credentials).to.equal(credentials);
    expect(sends).to.have.length(1);
    expect(sends[0].input).to.deep.equal({});
  });

  it('should surface STS errors', async () => {
    await initializeServerless({
      custom: { accountId: '${aws:accountId}' },
      handler: () => {
        throw new Error('SSO session has expired');
      },
    });

    expect(variablesMeta.get('custom\0accountId').error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    expect(variablesMeta.get('custom\0accountId').error.message).to.include(
      'SSO session has expired'
    );
  });

  it('should report with an error missing address', async () => {
    await initializeServerless();
    expect(variablesMeta.get('custom\0missingAddress').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
  });

  it('should report with an error invalid address', async () => {
    await initializeServerless();
    expect(variablesMeta.get('custom\0invalidAddress').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
  });

  it('should report with an error a non-string address', async () => {
    await initializeServerless();
    expect(variablesMeta.get('custom\0nonStringAddress').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
  });

  it('should resolve ${aws:region}', async () => {
    await initializeServerless({ custom: { region: '${aws:region}' } });
    expect(configuration.custom.region).to.equal('us-east-1');
    expect(clientInstances).to.have.length(0);

    await initializeServerless({
      custom: { region: '${aws:region}' },
      configExt: {
        provider: {
          region: 'eu-west-1',
        },
      },
    });
    expect(configuration.custom.region).to.equal('eu-west-1');
    expect(clientInstances).to.have.length(0);

    await initializeServerless({
      custom: { region: '${aws:region}' },
      configExt: {
        provider: {
          region: 'eu-west-1',
        },
      },
      options: {
        region: 'eu-central-1',
      },
    });
    expect(configuration.custom.region).to.equal('eu-central-1');
    expect(clientInstances).to.have.length(0);
  });

  it('should ignore inherited region from options', async () => {
    const getAwsSource = loadSource(() => ({ Account: '1234567890' }));
    const source = getAwsSource(createServerlessInstance());
    const result = await source.resolve({
      address: 'region',
      options: Object.create({ region: 'eu-central-1' }),
      resolveConfigurationProperty: async () => 'eu-west-1',
    });

    expect(result.value).to.equal('eu-west-1');
    expect(clientInstances).to.have.length(0);
  });

  it('should treat null region in options as absent', async () => {
    await initializeServerless({
      custom: { region: '${aws:region}' },
      configExt: {
        provider: {
          region: 'eu-west-1',
        },
      },
      options: {
        region: null,
      },
    });

    expect(configuration.custom.region).to.equal('eu-west-1');
    expect(clientInstances).to.have.length(0);
  });

  it('should treat empty string region in options as absent', async () => {
    await initializeServerless({
      custom: { region: '${aws:region}' },
      configExt: {
        provider: {
          region: 'eu-west-1',
        },
      },
      options: {
        region: '',
      },
    });

    expect(configuration.custom.region).to.equal('eu-west-1');
    expect(clientInstances).to.have.length(0);
  });
});
