'use strict';

const chai = require('chai');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { toCacheKey, canonicalize } = require('../../../../lib/utils/to-cache-key');

const expect = chai.expect;

describe('test/unit/lib/utils/to-cache-key.test.js', () => {
  it('is stable regardless of key ordering', () => {
    expect(toCacheKey({ b: 1, a: { d: 4, c: 3 } })).to.equal(
      toCacheKey({ a: { c: 3, d: 4 }, b: 1 })
    );
  });

  it('compares plain objects and arrays structurally', () => {
    expect(toCacheKey({ x: [1, { y: 2 }] })).to.equal(toCacheKey({ x: [1, { y: 2 }] }));
    expect(toCacheKey({ x: 1 })).to.not.equal(toCacheKey({ x: 2 }));
  });

  it('keys non-plain instances by reference identity, without traversing them', () => {
    class Credentials {
      constructor(id) {
        this.accessKeyId = id;
        Object.defineProperty(this, 'boom', {
          enumerable: true,
          get() {
            throw new Error('must not be traversed');
          },
        });
      }
    }
    const a = new Credentials('AKIA');
    const b = new Credentials('AKIA'); // equal content, different reference

    expect(() => toCacheKey({ credentials: a })).to.not.throw();
    expect(toCacheKey({ credentials: a })).to.equal(toCacheKey({ credentials: a }));
    expect(toCacheKey({ credentials: a })).to.not.equal(toCacheKey({ credentials: b }));
  });

  it('does not throw on the proxy-agent socket cycle', () => {
    const agent = new HttpsProxyAgent('http://proxy.example.com:3128');
    const socket = { _httpMessage: {} };
    socket._httpMessage.agent = agent; // close the cycle
    agent.sockets = { 'host:443:': [socket] };

    class Credentials {}
    const credentials = Object.assign(new Credentials(), {
      client: { config: { httpOptions: { agent } } },
    });
    const service = { name: 'CloudFormation', params: { region: 'us-east-1', credentials } };

    expect(() => toCacheKey(service)).to.not.throw();
    expect(toCacheKey(service)).to.equal(toCacheKey(service));
  });

  it('neutralises cycles among plain objects instead of throwing', () => {
    const node = { name: 'a' };
    node.self = node;
    expect(() => toCacheKey(node)).to.not.throw();
  });

  it('serialises shared, non-cyclic subtrees by value', () => {
    const shared = { k: 1 };
    expect(toCacheKey({ a: shared, b: shared })).to.equal(toCacheKey({ a: { k: 1 }, b: { k: 1 } }));
  });

  it('is total over bigint and undefined', () => {
    expect(() => toCacheKey({ n: 10n, u: undefined })).to.not.throw();
    expect(toCacheKey(undefined)).to.equal('');
  });

  it('does not conflate a bigint with its string form', () => {
    expect(toCacheKey({ v: 10n })).to.not.equal(toCacheKey({ v: '10' }));
  });

  it('canonicalize sorts plain object keys', () => {
    expect(canonicalize({ b: 1, a: 2 }, new WeakSet())).to.deep.equal({ a: 2, b: 1 });
  });
});
