'use strict';

const isPlainObject = require('type/plain-object/is');

// NUL-prefixed tags cannot collide with a real (JSON-sourced) param value.
const nul = String.fromCharCode(0);

// Stable per-process identity for opaque, identity-by-reference values (SDK
// clients, credentials, HTTP agents) so we never serialize their internals.
let nextIdentityId = 0;
const identityIds = new WeakMap();

const identityToken = (value) => {
  let token = identityIds.get(value);
  if (token === undefined) {
    token = `${nul}ref:${(nextIdentityId += 1)}`;
    identityIds.set(value, token);
  }
  return token;
};

const canonicalize = (value, ancestors) => {
  if (value === null) return null;

  const type = typeof value;
  if (type !== 'object') {
    if (type === 'function') return identityToken(value);
    if (type === 'bigint') return `${nul}bigint:${value}`;
    return value;
  }

  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) return identityToken(value);

  // Tokenize cyclic references instead of recursing into them.
  if (ancestors.has(value)) return identityToken(value);
  ancestors.add(value);
  const canonical = isArray
    ? value.map((item) => canonicalize(item, ancestors))
    : Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonicalize(item, ancestors)])
      );
  ancestors.delete(value);
  return canonical;
};

const toCacheKey = (value) => {
  const json = JSON.stringify(canonicalize(value, new WeakSet()));
  return json === undefined ? '' : json;
};

module.exports = { toCacheKey, canonicalize, identityToken };
