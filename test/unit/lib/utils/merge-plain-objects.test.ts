'use strict';

const { expect } = require('chai');

const mergePlainObjects = require('../../../../lib/utils/merge-plain-objects');

describe('mergePlainObjects', () => {
  afterEach(() => {
    delete Object.prototype.polluted;
  });

  it('should deeply merge nested plain objects', () => {
    const target = {
      provider: {
        name: 'aws',
        tags: {
          foo: 'bar',
        },
      },
    };

    const result = mergePlainObjects(target, {
      provider: {
        tags: {
          baz: 'qux',
        },
      },
    });

    expect(result).to.equal(target);
    expect(result).to.deep.equal({
      provider: {
        name: 'aws',
        tags: {
          foo: 'bar',
          baz: 'qux',
        },
      },
    });
  });

  it('should merge arrays by index', () => {
    const target = {
      rules: [
        {
          status: 'enabled',
        },
        {
          retries: 2,
        },
      ],
    };

    mergePlainObjects(target, {
      rules: [
        {
          event: 'create',
        },
      ],
    });

    expect(target).to.deep.equal({
      rules: [
        {
          status: 'enabled',
          event: 'create',
        },
        {
          retries: 2,
        },
      ],
    });
  });

  it('should clone source branches when assigning new nested values', () => {
    const source = {
      custom: {
        nested: {
          value: 'original',
        },
      },
    };

    const result = mergePlainObjects({}, source);
    result.custom.nested.value = 'changed';

    expect(source.custom.nested.value).to.equal('original');
  });

  it('should preserve existing values when source branches are undefined', () => {
    const target = {
      provider: {
        stage: 'dev',
      },
      items: [1, 2],
    };

    const result = mergePlainObjects(target, {
      provider: {
        stage: undefined,
      },
      items: [undefined, 3],
    });

    expect(result).to.deep.equal({
      provider: {
        stage: 'dev',
      },
      items: [1, 3],
    });
  });

  it('should ignore non-plain root sources', () => {
    expect(mergePlainObjects({ kept: true }, ['value'])).to.deep.equal({ kept: true });
  });

  it('should ignore __proto__ keys from parsed input objects', () => {
    const target = {};
    const source = JSON.parse('{"__proto__":{"polluted":"yes"},"custom":{"ok":true}}');

    mergePlainObjects(target, source);

    expect(target).to.deep.equal({
      custom: { ok: true },
    });
    expect({}.polluted).to.equal(undefined);
    expect(Object.getPrototypeOf(target)).to.equal(Object.prototype);
  });

  it('should ignore constructor and prototype keys from parsed input objects', () => {
    const target = {};
    const source = JSON.parse('{"constructor":{"prototype":{"polluted":"yes"}}}');

    mergePlainObjects(target, source);

    expect(target).to.deep.equal({});
    expect({}.polluted).to.equal(undefined);
  });

  it('does not stack-overflow on a self-cyclic source object', () => {
    const source = { a: 1 };
    source.self = source;

    const result = mergePlainObjects({}, source);

    expect(result.a).to.equal(1);
    expect(result.self).to.equal(result);
  });

  it('does not stack-overflow on cross-referencing source objects', () => {
    const a = { name: 'a' };
    const b = { name: 'b', peer: a };
    a.peer = b;

    const result = mergePlainObjects({}, a);

    expect(result.name).to.equal('a');
    expect(result.peer.name).to.equal('b');
    expect(result.peer.peer).to.equal(result);
  });

  it('does not stack-overflow on a self-cyclic source array', () => {
    const arr = [1, 2];
    arr.push(arr);

    const result = mergePlainObjects({}, { list: arr });

    expect(result.list[0]).to.equal(1);
    expect(result.list[1]).to.equal(2);
    expect(result.list[2]).to.equal(result.list);
  });

  it('creates own branch instead of writing into an inherited prototype branch', () => {
    Object.defineProperty(Object.prototype, 'branch', {
      value: { preexisting: 'yes' },
      writable: true,
      configurable: true,
      enumerable: false,
    });

    try {
      const target = {};

      mergePlainObjects(target, { branch: { safe: true } });

      expect(Object.prototype.hasOwnProperty.call(target, 'branch')).to.equal(true);
      expect(target.branch).to.deep.equal({ safe: true });
      expect(Object.prototype.branch).to.deep.equal({ preexisting: 'yes' });
    } finally {
      delete Object.prototype.branch;
    }
  });

  it('ignores __proto__ keys nested inside array elements', () => {
    const target = { items: [{}] };
    const source = { items: [JSON.parse('{"__proto__":{"polluted":"yes"}}')] };

    mergePlainObjects(target, source);

    expect({}.polluted).to.equal(undefined);
    expect(Object.getPrototypeOf(target.items[0])).to.equal(Object.prototype);
  });

  it('does not recurse forever when both target and source already contain the same cycle shape', () => {
    const target = {};
    target.self = target;

    const source = {};
    source.self = source;

    mergePlainObjects(target, source);

    expect(target.self).to.equal(target);
  });

  it('does not alias repeated source objects across sibling branches', () => {
    const shared = { nested: { value: 'x' } };

    const result = mergePlainObjects({}, { first: shared, second: shared });

    expect(result.first).to.deep.equal({ nested: { value: 'x' } });
    expect(result.second).to.deep.equal({ nested: { value: 'x' } });
    expect(result.first).to.not.equal(result.second);
    expect(result.first.nested).to.not.equal(result.second.nested);
  });
});
