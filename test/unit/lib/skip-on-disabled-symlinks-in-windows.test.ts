'use strict';

const sinon = require('sinon');
const { expect } = require('chai');

const skipOnDisabledSymlinksInWindows = require('../../lib/skip-on-disabled-symlinks-in-windows');

describe('test/unit/lib/skip-on-disabled-symlinks-in-windows.test.js', () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

  const setPlatform = (platform) => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: platform,
    });
  };

  beforeEach(() => {
    setPlatform('win32');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  });

  it('skips Windows EPERM symlink failures and runs the cleanup callback', () => {
    const context = { skip: sinon.stub() };
    const afterCallback = sinon.stub();

    skipOnDisabledSymlinksInWindows({ code: 'EPERM' }, context, afterCallback);

    expect(afterCallback).to.have.been.calledOnce;
    expect(context.skip).to.have.been.calledOnce;
  });

  it('skips Windows EPERM symlink failures without a cleanup callback', () => {
    const context = { skip: sinon.stub() };

    skipOnDisabledSymlinksInWindows({ code: 'EPERM' }, context);

    expect(context.skip).to.have.been.calledOnce;
  });

  it('does nothing for non-Windows EPERM errors', () => {
    const context = { skip: sinon.stub() };
    const afterCallback = sinon.stub();
    setPlatform('linux');

    skipOnDisabledSymlinksInWindows({ code: 'EPERM' }, context, afterCallback);

    expect(afterCallback).to.not.have.been.called;
    expect(context.skip).to.not.have.been.called;
  });

  it('does nothing for Windows non-EPERM errors', () => {
    const context = { skip: sinon.stub() };
    const afterCallback = sinon.stub();

    skipOnDisabledSymlinksInWindows({ code: 'ENOENT' }, context, afterCallback);

    expect(afterCallback).to.not.have.been.called;
    expect(context.skip).to.not.have.been.called;
  });

  it('rejects invalid Mocha contexts for Windows EPERM errors', () => {
    expect(() => skipOnDisabledSymlinksInWindows({ code: 'EPERM' }, {})).to.throw(
      TypeError,
      'Passed context is not a valid Mocha context'
    );
  });
});
