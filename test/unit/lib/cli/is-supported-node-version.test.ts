'use strict';

const { expect } = require('chai');

const isSupportedNodeVersion = require('../../../../lib/cli/is-supported-node-version');

describe('test/unit/lib/cli/is-supported-node-version.test.js', () => {
  it('rejects Node 18', () => {
    expect(isSupportedNodeVersion('v18.20.0')).to.equal(false);
  });

  it('rejects Node 20 releases before 20.19.0', () => {
    expect(isSupportedNodeVersion('v20.18.1')).to.equal(false);
  });

  it('accepts Node 20.19.0 and newer 20.x releases', () => {
    expect(isSupportedNodeVersion('v20.19.0')).to.equal(true);
  });

  it('rejects unsupported odd-numbered majors', () => {
    expect(isSupportedNodeVersion('v21.7.0')).to.equal(false);
  });

  it('rejects Node 22 releases before 22.13.0', () => {
    expect(isSupportedNodeVersion('v22.12.0')).to.equal(false);
  });

  it('accepts Node 22.13.0 and newer releases', () => {
    expect(isSupportedNodeVersion('v22.13.0')).to.equal(true);
    expect(isSupportedNodeVersion('v24.0.0')).to.equal(true);
  });
});
