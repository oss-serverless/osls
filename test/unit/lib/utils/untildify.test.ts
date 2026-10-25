'use strict';

const proxyquire = require('proxyquire').noCallThru().noPreserveCache();
const sinon = require('sinon');

const { expect } = require('chai');

const loadUntildify = ({
  homeDirectory = '/home/test-user',
  username = 'test-user',
  homedirError,
  userInfoError,
} = {}) => {
  const osStub = {
    homedir: sinon.stub(),
    userInfo: sinon.stub(),
  };
  if (homedirError) osStub.homedir.throws(homedirError);
  else osStub.homedir.returns(homeDirectory);
  if (userInfoError) osStub.userInfo.throws(userInfoError);
  else osStub.userInfo.returns({ username });

  const untildify = proxyquire('../../../../lib/utils/untildify', {
    os: osStub,
  });

  return { untildify, osStub };
};

const expectErrorCode = (fn, code) => {
  try {
    fn();
  } catch (error) {
    expect(error).to.have.property('code', code);
    return error;
  }

  throw new Error(`Expected ${code} error`);
};

describe('test/unit/lib/utils/untildify.test.js', () => {
  it('throws on non-string input', () => {
    const { untildify, osStub } = loadUntildify();

    expect(() => untildify()).to.throw(TypeError, 'Expected a string, got undefined');
    expect(() => untildify(null)).to.throw(TypeError, 'Expected a string, got object');
    expect(() => untildify(1)).to.throw(TypeError, 'Expected a string, got number');

    expect(osStub.homedir).to.not.have.been.called;
    expect(osStub.userInfo).to.not.have.been.called;
  });

  it('expands regular home-relative paths', () => {
    const { untildify, osStub } = loadUntildify();

    expect(untildify('~')).to.equal('/home/test-user');
    expect(untildify('~/service')).to.equal('/home/test-user/service');
    expect(untildify('~\\service')).to.equal('/home/test-user\\service');

    expect(osStub.homedir).to.have.been.calledOnce;
    expect(osStub.userInfo).to.not.have.been.called;
  });

  it('returns paths unchanged when they do not start with an expandable tilde', () => {
    const { untildify, osStub } = loadUntildify();

    expect(untildify('service')).to.equal('service');
    expect(untildify('/tmp/~service')).to.equal('/tmp/~service');
    expect(untildify('./~service')).to.equal('./~service');

    expect(osStub.homedir).to.not.have.been.called;
    expect(osStub.userInfo).to.not.have.been.called;
  });

  it('rejects another user home path', () => {
    const { untildify, osStub } = loadUntildify({ username: 'current-user' });

    expectErrorCode(() => untildify('~other-user/service'), 'UNSUPPORTED_HOME_DIRECTORY_EXPANSION');

    expect(osStub.homedir).to.not.have.been.called;
    expect(osStub.userInfo).to.have.been.calledOnce;
  });

  it('expands current user home paths', () => {
    const { untildify, osStub } = loadUntildify({
      homeDirectory: '/Users/current-user',
      username: 'current-user',
    });

    expect(untildify('~current-user')).to.equal('/Users/current-user');
    expect(untildify('~current-user/service')).to.equal('/Users/current-user/service');
    expect(untildify('~current-user\\service')).to.equal('/Users/current-user\\service');

    expect(osStub.homedir).to.have.been.calledOnce;
    expect(osStub.userInfo).to.have.been.calledOnce;
  });

  it('caches the home directory after the first call', () => {
    const osStub = {
      homedir: sinon.stub(),
      userInfo: sinon.stub().returns({ username: 'test-user' }),
    };
    osStub.homedir.onFirstCall().returns('/home/first');
    osStub.homedir.onSecondCall().returns('/home/second');

    const untildify = proxyquire('../../../../lib/utils/untildify', {
      os: osStub,
    });

    expect(untildify('~/one')).to.equal('/home/first/one');
    expect(untildify('~/two')).to.equal('/home/first/two');

    expect(osStub.homedir).to.have.been.calledOnce;
  });

  it('caches the current username after the first user-home lookup', () => {
    const osStub = {
      homedir: sinon.stub().returns('/home/first-user'),
      userInfo: sinon.stub(),
    };
    osStub.userInfo.onFirstCall().returns({ username: 'first-user' });
    osStub.userInfo.onSecondCall().returns({ username: 'second-user' });

    const untildify = proxyquire('../../../../lib/utils/untildify', {
      os: osStub,
    });

    expect(untildify('~first-user/project')).to.equal('/home/first-user/project');
    expectErrorCode(
      () => untildify('~second-user/project'),
      'UNSUPPORTED_HOME_DIRECTORY_EXPANSION'
    );

    expect(osStub.userInfo).to.have.been.calledOnce;
  });

  it('throws for regular tilde paths when no home directory is available', () => {
    const { untildify, osStub } = loadUntildify({ homeDirectory: '' });

    expectErrorCode(() => untildify('~/service'), 'HOME_DIRECTORY_UNAVAILABLE');

    expect(osStub.homedir).to.have.been.calledOnce;
    expect(osStub.userInfo).to.not.have.been.called;
  });

  it('throws for current user home paths when no home directory is available', () => {
    const { untildify, osStub } = loadUntildify({ homeDirectory: '', username: 'test-user' });

    expectErrorCode(() => untildify('~test-user/service'), 'HOME_DIRECTORY_UNAVAILABLE');

    expect(osStub.homedir).to.have.been.calledOnce;
    expect(osStub.userInfo).to.have.been.calledOnce;
  });

  it('throws a controlled error when home directory lookup fails', () => {
    const { untildify } = loadUntildify({ homedirError: new Error('home lookup failed') });

    const error = expectErrorCode(() => untildify('~/service'), 'HOME_DIRECTORY_UNAVAILABLE');

    expect(error.message).to.include('home lookup failed');
  });

  it('throws a controlled error when current user lookup fails', () => {
    const { untildify, osStub } = loadUntildify({
      userInfoError: new Error('user lookup failed'),
    });

    const error = expectErrorCode(
      () => untildify('~test-user/service'),
      'CURRENT_USER_UNAVAILABLE'
    );

    expect(error.message).to.include('user lookup failed');
    expect(osStub.homedir).to.not.have.been.called;
  });

  it('throws a controlled error when current username is unavailable', () => {
    const { untildify, osStub } = loadUntildify({ username: '' });

    expectErrorCode(() => untildify('~test-user/service'), 'CURRENT_USER_UNAVAILABLE');

    expect(osStub.homedir).to.not.have.been.called;
    expect(osStub.userInfo).to.have.been.calledOnce;
  });

  it('expands home paths without interpreting replacement tokens in the home directory', () => {
    const { untildify } = loadUntildify({ homeDirectory: '/home/$&user' });

    expect(untildify('~/service')).to.equal('/home/$&user/service');
  });
});
