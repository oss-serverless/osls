import { expect } from 'chai';
import resolveProviderName from '../../../../lib/configuration/resolve-provider-name.ts';
import ServerlessError from '../../../../lib/serverless-error.ts';

describe('test/unit/lib/configuration/resolve-provider-name.test.ts', () => {
  it('should read name from "provider"', () => {
    expect(resolveProviderName({ provider: 'foo' })).to.equal('foo');
  });
  it('should read name from "provider.name"', () => {
    expect(resolveProviderName({ provider: { name: 'foo' } })).to.equal('foo');
  });
  it('should reject missing "provider.name"', () => {
    expect(() => resolveProviderName({ provider: {} }))
      .to.throw(ServerlessError)
      .with.property('code', 'INVALID_CONFIGURATION_PROVIDER_NAME_MISSING');
  });
  it('should reject invalid "provider.name"', () => {
    expect(() => resolveProviderName({ provider: { name: {} } }))
      .to.throw(ServerlessError)
      .with.property('code', 'INVALID_CONFIGURATION_PROVIDER_NAME_MISSING');
  });
  it('should reject missing "provider"', () => {
    expect(() => resolveProviderName({}))
      .to.throw(ServerlessError)
      .with.property('code', 'INVALID_CONFIGURATION_PROVIDER_NAME_MISSING');
  });
});
