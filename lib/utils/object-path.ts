'use strict';

const isObject = require('type/object/is');

const PATH_TOKEN_RE = /[^.[\]]+|\[(?:(\d+)|(["'])(.*?)\2|([^[\]]+))\]/g;
const UNSAFE_PROPERTY_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const hasOwnProperty = Object.prototype.hasOwnProperty;

const isUnsafePropertyKey = (key) => UNSAFE_PROPERTY_KEYS.has(String(key));
const isIndexSegment = (segment) => /^[0-9]+$/.test(String(segment));

const tokenizePath = (path) => {
  if (Array.isArray(path)) return path.map((segment) => String(segment));
  if (path == null) return [];

  return Array.from(String(path).matchAll(PATH_TOKEN_RE), (match) => {
    return match[1] ?? match[3] ?? match[4] ?? match[0];
  });
};

const hasUnsafePathSegment = (path) => tokenizePath(path).some(isUnsafePropertyKey);

const getByPath = (source, path) => {
  let current = source;

  for (const segment of tokenizePath(path)) {
    if (isUnsafePropertyKey(segment)) return undefined;
    if (current == null) return undefined;
    current = current[segment];
  }

  return current;
};

const setByPath = (source, path, value, { arrays = false } = {}) => {
  const segments = tokenizePath(path);

  if (!segments.length) return false;
  if (segments.some(isUnsafePropertyKey)) return false;
  if (!isObject(source)) return false;

  let current = source;

  segments.slice(0, -1).forEach((segment, index) => {
    const nextSegment = segments[index + 1];
    const hasOwnObjectBranch = hasOwnProperty.call(current, segment) && isObject(current[segment]);

    if (!hasOwnObjectBranch) {
      current[segment] = arrays && isIndexSegment(nextSegment) ? [] : {};
    }

    current = current[segment];
  });

  current[segments.at(-1)] = value;
  return true;
};

const unsetByPath = (source, path) => {
  const segments = tokenizePath(path);

  if (!segments.length) return false;
  if (segments.some(isUnsafePropertyKey)) return false;
  if (!isObject(source)) return false;

  let current = source;

  for (const segment of segments.slice(0, -1)) {
    if (!isObject(current) || !hasOwnProperty.call(current, segment)) return false;
    current = current[segment];
  }

  if (!isObject(current)) return false;
  return delete current[segments.at(-1)];
};

module.exports = {
  getByPath,
  hasUnsafePathSegment,
  isUnsafePropertyKey,
  setByPath,
  tokenizePath,
  unsetByPath,
};
