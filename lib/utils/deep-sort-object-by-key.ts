'use strict';

const isPlainObject = require('type/plain-object/is');

const deepSortObjectByKey = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(deepSortObjectByKey);
  }

  if (isPlainObject(obj)) {
    return Object.fromEntries(
      Object.entries(obj)
        .sort(([key], [otherKey]) => key.localeCompare(otherKey))
        .map(([key, value]) => [key, deepSortObjectByKey(value)])
    );
  }

  return obj;
};

module.exports = deepSortObjectByKey;
