import { expect } from 'chai';
import resolveMeta from '../../../../../../lib/configuration/variables/resolve-meta.ts';
import resolve from '../../../../../../lib/configuration/variables/resolve.ts';
import strToBoolSource from '../../../../../../lib/configuration/variables/sources/str-to-bool.ts';

describe('test/unit/lib/configuration/variables/sources/str-to-bool.test.ts', () => {
  let configuration;
  let variablesMeta;
  before(async () => {
    configuration = {
      truthy: "${strToBool('true')}",
      falsy: "${strToBool('false')}",
      truthyUppercase: "${strToBool('TRUE')}",
      falsyMixedCase: "${strToBool('False')}",
      noParam: '${strToBool:}',
      invalid: '${strToBool(foo)}',
    };
    variablesMeta = resolveMeta(configuration);
    await resolve({
      serviceDir: process.cwd(),
      configuration,
      variablesMeta,
      sources: { strToBool: strToBoolSource },
      options: {},
      fulfilledSources: new Set(['strToBool']),
    });
  });

  it('should resolve truthy input', () => expect(configuration.truthy).to.equal(true));
  it('should resolve falsy input', () => expect(configuration.falsy).to.equal(false));
  it('should resolve uppercase truthy input', () =>
    expect(configuration.truthyUppercase).to.equal(true));
  it('should resolve mixed case falsy input', () =>
    expect(configuration.falsyMixedCase).to.equal(false));

  it('should report with an error missing input', () =>
    expect(variablesMeta.get('noParam').error.code).to.equal('VARIABLE_RESOLUTION_ERROR'));

  it('should report with an error a unexpected string input', () =>
    expect(variablesMeta.get('invalid').error.code).to.equal('VARIABLE_RESOLUTION_ERROR'));
});
