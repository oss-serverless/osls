'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const resolveMeta = require('../../../../../../../lib/configuration/variables/resolve-meta');
const resolve = require('../../../../../../../lib/configuration/variables/resolve');
const selfSource = require('../../../../../../../lib/configuration/variables/sources/self');

describe('test/unit/lib/configuration/variables/sources/instance-dependent/get-cf.test.js', () => {
  let configuration;
  let variablesMeta;
  let sends;
  let clientInstances;
  let getAwsSdkV3Config;
  let credentials;

  class DescribeStacksCommand {
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

    class CloudFormationClient {
      constructor(config) {
        this.config = config;
        clientInstances.push(this);
      }

      async send(command) {
        sends.push({ config: this.config, input: command.input });
        return handler(command.input, this.config);
      }
    }

    const getCfSource = proxyquire
      .noCallThru()
      .load('../../../../../../../lib/configuration/variables/sources/instance-dependent/get-cf', {
        '@aws-sdk/client-cloudformation': {
          CloudFormationClient,
          DescribeStacksCommand,
        },
      });

    return getCfSource({
      getProvider: () => ({ getRegion: () => 'us-east-1', getAwsSdkV3Config }),
    });
  }

  before(async () => {
    configuration = {
      service: 'foo',
      provider: { name: 'aws' },
      custom: {
        existing: '${cf:existing.someOutput}',
        existingAgain: '${cf:existing.someOutput}',
        existingInRegion: '${cf(eu-west-1):existing.someOutput}',
        noOutput: '${cf:existing.unrecognizedOutput, null}',
        noOutputs: '${cf:noOutputs.someOutput, null}',
        noStack: '${cf:notExisting.someOutput, null}',
        badValidation: '${cf:badValidation.someOutput}',
        inheritedValidationCode: '${cf:inheritedValidationCode.someOutput}',
        inheritedValidationName: '${cf:inheritedValidationName.someOutput}',
        missingAddress: '${cf:}',
        invalidAddress: '${cf:invalid}',
        nonStringAddress: '${cf:${self:custom.someObject}}',
        someObject: {},
      },
    };
    variablesMeta = resolveMeta(configuration);

    const source = loadSource(({ StackName }, { region }) => {
      if (StackName === 'existing') {
        return {
          Stacks: [
            {
              Outputs: [
                {
                  OutputKey: 'someOutput',
                  OutputValue: region === 'eu-west-1' ? region : 'someValue',
                },
              ],
            },
          ],
        };
      }
      if (StackName === 'noOutputs') {
        return { Stacks: [{}] };
      }
      if (StackName === 'notExisting') {
        throw Object.assign(new Error('Stack with id not-existing does not exist'), {
          name: 'ValidationError',
        });
      }
      if (StackName === 'badValidation') {
        throw Object.assign(new Error('Template validation failed'), { name: 'ValidationError' });
      }
      if (StackName === 'inheritedValidationCode') {
        const error = new Error('Stack with id inheritedValidationCode does not exist');
        Object.setPrototypeOf(
          error,
          Object.assign(Object.create(Object.getPrototypeOf(error)), { Code: 'ValidationError' })
        );
        throw error;
      }
      if (StackName === 'inheritedValidationName') {
        const error = new Error('Stack with id inheritedValidationName does not exist');
        Object.setPrototypeOf(
          error,
          Object.assign(Object.create(Object.getPrototypeOf(error)), { name: 'ValidationError' })
        );
        throw error;
      }
      throw new Error(`Unexpected CloudFormation call: ${StackName}`);
    });

    await resolve({
      serviceDir: process.cwd(),
      configuration,
      variablesMeta,
      sources: { self: selfSource, cf: source },
      options: {},
      fulfilledSources: new Set(['cf', 'self']),
    });
  });

  function getSendsByStack(stackName) {
    return sends.filter(({ input }) => input.StackName === stackName);
  }

  it('should resolve existing output', () => {
    if (variablesMeta.get('custom\0existing')) throw variablesMeta.get('custom\0existing').error;
    expect(configuration.custom.existing).to.equal('someValue');
    expect(configuration.custom.existingAgain).to.equal('someValue');
  });

  it('should use AWS SDK v3 config and preserve credential providers', () => {
    expect(getAwsSdkV3Config).to.have.been.calledWith({
      region: 'us-east-1',
    });
    expect(clientInstances[0].config.credentials).to.equal(credentials);
  });

  it('should cache repeated stack lookups in the same region', () => {
    expect(
      getSendsByStack('existing').filter(({ config }) => config.region === 'us-east-1')
    ).to.have.length(1);
  });

  it('should resolve existing output in specific region', () => {
    if (variablesMeta.get('custom\0existingInRegion')) {
      throw variablesMeta.get('custom\0existingInRegion').error;
    }
    expect(configuration.custom.existingInRegion).to.equal('eu-west-1');
    expect(getAwsSdkV3Config).to.have.been.calledWith({
      region: 'eu-west-1',
    });
  });

  it('should resolve null on missing output', () => {
    if (variablesMeta.get('custom\0noOutput')) throw variablesMeta.get('custom\0noOutput').error;
    expect(configuration.custom.noOutput).to.equal(null);
  });

  it('should resolve null when stack has no outputs', () => {
    if (variablesMeta.get('custom\0noOutputs')) {
      throw variablesMeta.get('custom\0noOutputs').error;
    }
    expect(configuration.custom.noOutputs).to.equal(null);
  });

  it('should resolve null on missing stack', () => {
    if (variablesMeta.get('custom\0noStack')) throw variablesMeta.get('custom\0noStack').error;
    expect(configuration.custom.noStack).to.equal(null);
  });

  it('should surface non-missing ValidationError errors', () => {
    expect(variablesMeta.get('custom\0badValidation').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
    expect(variablesMeta.get('custom\0badValidation').error.message).to.include(
      'Template validation failed'
    );
  });

  it('should not treat inherited ValidationError codes as missing stacks', () => {
    expect(variablesMeta.get('custom\0inheritedValidationCode').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
    expect(variablesMeta.get('custom\0inheritedValidationCode').error.message).to.include(
      'does not exist'
    );
  });

  it('should not treat inherited ValidationError names as missing stacks', () => {
    expect(variablesMeta.get('custom\0inheritedValidationName').error.code).to.equal(
      'VARIABLE_RESOLUTION_ERROR'
    );
    expect(variablesMeta.get('custom\0inheritedValidationName').error.message).to.include(
      'does not exist'
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
