'use strict';

const { expect } = require('chai');

const {
  createRegistry,
  getOwnByPath,
  getReachableByPath,
  hasOwn,
  safeSet,
  safeShallowAssign,
} = require('../../../../lib/utils/safe-object');

describe('safe-object', () => {
  afterEach(() => {
    delete Object.prototype.polluted;
  });

  it('distinguishes own and inherited properties with hasOwn', () => {
    expect(hasOwn(null, 'value')).to.equal(false);
    expect(hasOwn(undefined, 'value')).to.equal(false);
    expect(hasOwn({}, 'toString')).to.equal(false);
    expect(hasOwn({ toString: 'own' }, 'toString')).to.equal(true);
    expect(hasOwn([1, 2], 'length')).to.equal(true);
    expect(hasOwn('ab', 'length')).to.equal(true);
  });

  it('preserves unsafe keys as own data properties when setting values', () => {
    const target = {};

    safeSet(target, '__proto__', { polluted: 'no' });
    safeSet(target, 'constructor', 'ctor');
    safeSet(target, 'prototype', 'proto');

    expect(Object.getPrototypeOf(target)).to.equal(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(target, '__proto__').value).to.deep.equal({
      polluted: 'no',
    });
    expect(Object.getOwnPropertyDescriptor(target, 'constructor').value).to.equal('ctor');
    expect(Object.getOwnPropertyDescriptor(target, 'prototype').value).to.equal('proto');
    expect({}.polluted).to.equal(undefined);
  });

  it('defines unsafe keys with pollution-robust own data descriptors', () => {
    const target = {};
    const originalGetDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'get');
    const originalSetDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'set');

    const definePollutingAccessor = (key) => {
      Object.defineProperty(
        Object.prototype,
        key,
        Object.assign(Object.create(null), {
          get() {
            throw new Error(`inherited descriptor ${key} was read`);
          },
          configurable: true,
        })
      );
    };

    let protoDescriptor;
    let constructorDescriptor;
    let prototypeDescriptor;

    try {
      definePollutingAccessor('get');
      definePollutingAccessor('set');

      safeSet(target, '__proto__', { polluted: 'no' });
      safeSet(target, 'constructor', 'ctor');
      safeSet(target, 'prototype', 'proto');

      protoDescriptor = Object.getOwnPropertyDescriptor(target, '__proto__');
      constructorDescriptor = Object.getOwnPropertyDescriptor(target, 'constructor');
      prototypeDescriptor = Object.getOwnPropertyDescriptor(target, 'prototype');
    } finally {
      if (originalGetDescriptor) {
        Object.defineProperty(Object.prototype, 'get', originalGetDescriptor);
      } else {
        delete Object.prototype.get;
      }

      if (originalSetDescriptor) {
        Object.defineProperty(Object.prototype, 'set', originalSetDescriptor);
      } else {
        delete Object.prototype.set;
      }
    }

    expect(Object.getPrototypeOf(target)).to.equal(Object.prototype);
    expect(protoDescriptor).to.deep.equal({
      value: { polluted: 'no' },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(constructorDescriptor).to.deep.equal({
      value: 'ctor',
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(prototypeDescriptor).to.deep.equal({
      value: 'proto',
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect({}.polluted).to.equal(undefined);
  });

  it('preserves overwrite order in safeShallowAssign', () => {
    const target = safeShallowAssign({}, { value: 'first' }, { value: 'second' });

    expect(target.value).to.equal('second');
  });

  it('preserves unsafe keys as own data when shallow assigning', () => {
    const source = JSON.parse('{"__proto__":{"value":"ok"}}');
    const target = safeShallowAssign({}, source);

    expect(Object.getPrototypeOf(target)).to.equal(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(target, '__proto__').value).to.deep.equal({
      value: 'ok',
    });
  });

  it('ignores nullish sources when shallow assigning', () => {
    const target = safeShallowAssign({}, null, { value: 'first' }, undefined, { value: 'second' });

    expect(target).to.deep.equal({ value: 'second' });
  });

  it('creates null-prototype registries', () => {
    const registry = createRegistry();

    expect(Object.getPrototypeOf(registry)).to.equal(null);
  });

  it('reads only own properties when traversing string and array paths', () => {
    const source = {
      list: ['a', 'b'],
      nested: {},
      text: 'ab',
    };
    Object.defineProperty(source.nested, '__proto__', {
      value: { value: 'own' },
      writable: true,
      enumerable: true,
      configurable: true,
    });

    expect(getOwnByPath(source, 'list.length')).to.equal(2);
    expect(getOwnByPath(source, ['list', '1'])).to.equal('b');
    expect(getOwnByPath(source, ['nested', '__proto__', 'value'])).to.equal('own');
    expect(getOwnByPath(source, ['text', 'length'])).to.equal(2);
    expect(getOwnByPath({ nested: {} }, ['nested', 'constructor', 'name'])).to.equal(undefined);
    expect(getOwnByPath({ nested: null }, 'nested.value')).to.equal(undefined);
    expect(getOwnByPath({ nested: 5 }, 'nested.value')).to.equal(undefined);
  });

  it('follows Proxy virtual properties for safe keys when traversing reachable paths', () => {
    const source = {
      proxy: new Proxy(
        { own: 'own-value' },
        {
          get(target, key) {
            if (key === 'virtual') return { nested: 'proxy-virtual' };
            return target[key];
          },
        }
      ),
    };

    expect(getReachableByPath(source, 'proxy.virtual.nested')).to.equal('proxy-virtual');
    expect(getReachableByPath(source, ['proxy', 'own'])).to.equal('own-value');
    expect(getReachableByPath(source, 'proxy.missing')).to.equal(undefined);
    expect(getReachableByPath(source, ['proxy', 'constructor', 'name'])).to.equal(undefined);
    expect(getReachableByPath({ nested: {} }, ['nested', 'constructor', 'name'])).to.equal(
      undefined
    );
    expect(getReachableByPath({ nested: null }, 'nested.value')).to.equal(undefined);
  });
});
