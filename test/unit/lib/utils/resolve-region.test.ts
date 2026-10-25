import * as chai from 'chai';
import resolveRegion from '../../../../lib/utils/resolve-region.ts';

const expect = chai.expect;

describe('test/unit/lib/utils/resolve-region.test.ts', () => {
  it('should return `region` from options first if it is present', () => {
    const result = resolveRegion({
      configuration: { provider: { region: 'fromprovider' } },
      options: { region: 'fromoptions' },
    });
    expect(result).to.equal('fromoptions');
  });

  it('should return `region` from configuration if region is not passed in options', () => {
    const result = resolveRegion({
      configuration: { provider: { region: 'fromprovider' } },
      options: {},
    });
    expect(result).to.equal('fromprovider');
  });

  it('should return default region if both options and configuration do not have it defined', () => {
    const result = resolveRegion({ configuration: {}, options: {} });
    expect(result).to.equal('us-east-1');
  });
});
