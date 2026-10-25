import { expect } from 'chai';
import isSupportedNodeVersion from '../../../../lib/cli/is-supported-node-version.ts';

// The supported range is package.json `engines.node`: `^22.18.0 || ^24.0.0`
describe('test/unit/lib/cli/is-supported-node-version.test.ts', () => {
  it('rejects Node 18', () => {
    expect(isSupportedNodeVersion('v18.20.0')).to.equal(false);
  });

  it('rejects Node 20', () => {
    expect(isSupportedNodeVersion('v20.18.1')).to.equal(false);
    expect(isSupportedNodeVersion('v20.19.0')).to.equal(false);
  });

  it('rejects unsupported odd-numbered majors', () => {
    expect(isSupportedNodeVersion('v21.7.0')).to.equal(false);
    expect(isSupportedNodeVersion('v23.11.0')).to.equal(false);
  });

  it('rejects Node 22 releases before 22.18.0', () => {
    expect(isSupportedNodeVersion('v22.13.0')).to.equal(false);
    expect(isSupportedNodeVersion('v22.17.1')).to.equal(false);
  });

  it('accepts Node 22.18.0 and newer releases', () => {
    expect(isSupportedNodeVersion('v22.18.0')).to.equal(true);
    expect(isSupportedNodeVersion('v24.0.0')).to.equal(true);
  });
});
