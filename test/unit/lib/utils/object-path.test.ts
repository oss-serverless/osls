'use strict';

const { expect } = require('chai');

const {
  getByPath,
  hasUnsafePathSegment,
  setByPath,
  tokenizePath,
  unsetByPath,
} = require('../../../../lib/utils/object-path');

describe('object-path', () => {
  afterEach(() => {
    delete Object.prototype.polluted;
  });

  it('tokenizes dot and bracket paths', () => {
    expect(tokenizePath('users[1]["profile.name"].first')).to.deep.equal([
      'users',
      '1',
      'profile.name',
      'first',
    ]);
  });

  it('detects unsafe path segments', () => {
    expect(hasUnsafePathSegment('__proto__.x')).to.equal(true);
    expect(hasUnsafePathSegment(['provider', 'constructor', 'prototype', 'x'])).to.equal(true);
    expect(hasUnsafePathSegment('custom.value')).to.equal(false);
  });

  it('creates arrays for numeric path segments when requested', () => {
    const target = {};

    setByPath(target, 'users[0].name', 'Jane', { arrays: true });

    expect(target).to.deep.equal({
      users: [{ name: 'Jane' }],
    });
  });

  it('does not descend into inherited branches when setting', () => {
    const target = {};

    setByPath(target, 'toString.value', 'safe');

    expect(target).to.deep.equal({
      toString: {
        value: 'safe',
      },
    });
    expect(Object.prototype.toString.value).to.equal(undefined);
  });

  it('returns undefined for unsafe get paths', () => {
    expect(getByPath({}, '__proto__.polluted')).to.equal(undefined);
  });

  it('refuses unsafe set and unset paths', () => {
    const target = {};

    expect(setByPath(target, '__proto__.polluted', 'yes')).to.equal(false);
    expect(unsetByPath(target, '__proto__.polluted')).to.equal(false);
    expect({}.polluted).to.equal(undefined);
  });

  it('refuses bracket-notation unsafe paths for setByPath', () => {
    expect(setByPath({}, '["__proto__"].polluted', 'yes')).to.equal(false);
    expect({}.polluted).to.equal(undefined);
  });

  it('refuses bracket-notation unsafe paths for getByPath', () => {
    expect(getByPath({}, '["__proto__"].polluted')).to.equal(undefined);
  });

  it('refuses bracket-notation unsafe paths for unsetByPath', () => {
    expect(unsetByPath({}, '["__proto__"].polluted')).to.equal(false);
  });

  it('refuses bracket-notation with single-quoted unsafe segments', () => {
    expect(setByPath({}, "['constructor']['prototype'].polluted", 'yes')).to.equal(false);
    expect({}.polluted).to.equal(undefined);
  });

  it('refuses constructor.prototype paths for set/get/unset', () => {
    const target = {};
    expect(setByPath(target, 'constructor.prototype.polluted', 'yes')).to.equal(false);
    expect(getByPath(target, 'constructor.prototype')).to.equal(undefined);
    expect(unsetByPath(target, 'constructor.prototype.polluted')).to.equal(false);
    expect({}.polluted).to.equal(undefined);
  });

  it('refuses constructor at depth inside the path', () => {
    expect(setByPath({}, 'safe.constructor.prototype.polluted', 'yes')).to.equal(false);
    expect(getByPath({ safe: {} }, 'safe.constructor.prototype.polluted')).to.equal(undefined);
    expect({}.polluted).to.equal(undefined);
  });

  it('refuses bracket-notation __proto__ and constructor segments with double quotes', () => {
    expect(setByPath({}, 'safe["__proto__"].x', 'y')).to.equal(false);
    expect(setByPath({}, 'safe["constructor"].x', 'y')).to.equal(false);
    expect({}.x).to.equal(undefined);
  });
});
