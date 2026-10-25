'use strict';

const { isProxy } = require('util').types;
const { isUnsafePropertyKey } = require('./object-path');

const hasOwnProperty = Object.prototype.hasOwnProperty;

const hasOwn = (object, key) => object != null && hasOwnProperty.call(object, key);

// `hasOwnProperty` does not consult Proxy "has"/"get" traps, so virtual properties
// of Proxy-backed values can only be reached via property access. Such access must
// never traverse prototype internals, unless these are claimed as own properties.
const canFollowProperty = (value, key) =>
  hasOwn(value, key) || (isProxy(value) && !isUnsafePropertyKey(key));

const dataDescriptor = (value) =>
  Object.assign(Object.create(null), {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });

const safeSet = (target, key, value) => {
  if (isUnsafePropertyKey(key)) {
    Object.defineProperty(target, key, dataDescriptor(value));
  } else {
    target[key] = value;
  }

  return target;
};

const safeShallowAssign = (target, ...sources) => {
  for (const source of sources) {
    if (source == null) continue;

    for (const [key, value] of Object.entries(source)) {
      safeSet(target, key, value);
    }
  }

  return target;
};

const createRegistry = () => Object.create(null);

const pathSegments = (path) =>
  Array.isArray(path)
    ? path.map((segment) => String(segment))
    : String(path).split('.').filter(Boolean);

const getOwnByPath = (source, path) => {
  let current = source;

  for (const segment of pathSegments(path)) {
    if (current == null || !hasOwn(current, segment)) return undefined;
    current = current[segment];
  }

  return current;
};

const getReachableByPath = (source, path) => {
  let current = source;

  for (const segment of pathSegments(path)) {
    if (current == null || !canFollowProperty(current, segment)) return undefined;
    current = current[segment];
  }

  return current;
};

module.exports = {
  canFollowProperty,
  createRegistry,
  getOwnByPath,
  getReachableByPath,
  hasOwn,
  safeSet,
  safeShallowAssign,
};
