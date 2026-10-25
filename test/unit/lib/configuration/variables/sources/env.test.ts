import { expect } from 'chai';
import resolveMeta from '../../../../../../lib/configuration/variables/resolve-meta.ts';
import resolve from '../../../../../../lib/configuration/variables/resolve.ts';
import selfSource from '../../../../../../lib/configuration/variables/sources/self.ts';
import envSource from '../../../../../../lib/configuration/variables/sources/env.ts';

describe('test/unit/lib/configuration/variables/sources/env.test.ts', () => {
  let configuration;
  let variablesMeta;
  before(async () => {
    process.env.ENV_SOURCE_TEST = 'foobar';
    process.env.ENV_SOURCE_TEST_EMPTY = '';
    configuration = {
      env: '${env:ENV_SOURCE_TEST}',
      envMissing: "${env:ENV_SOURCE_TEST_MISSING, 'fallback'}",
      envEmpty: '${env:ENV_SOURCE_TEST_EMPTY}',
      noAddress: '${env:}',
      nonStringAddress: '${env:${self:someObject}}',
      someObject: {},
    };
    variablesMeta = resolveMeta(configuration);
    await resolve({
      serviceDir: process.cwd(),
      configuration,
      variablesMeta,
      sources: { env: envSource, self: selfSource },
      options: {},
      fulfilledSources: new Set(['env']),
    });
  });

  it('should resolve environment variable', () => expect(configuration.env).to.equal('foobar'));
  it('should resolve null on missing environment variable', () =>
    expect(configuration.envMissing).to.equal('fallback'));

  it('should resolve environment variable that is empty', () =>
    expect(configuration.envEmpty).to.equal(''));

  it('should report with an error missing address argument', () =>
    expect(variablesMeta.get('noAddress').error.code).to.equal('VARIABLE_RESOLUTION_ERROR'));

  it('should report with an error a non-string address argument', () =>
    expect(variablesMeta.get('nonStringAddress').error.code).to.equal('VARIABLE_RESOLUTION_ERROR'));
});
