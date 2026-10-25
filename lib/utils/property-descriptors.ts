'use strict';

const methodDescriptor = (value, options = {}) =>
  Object.assign(Object.create(null), options, {
    value,
    configurable: true,
    enumerable: false,
    writable: true,
  });

const getterDescriptor = (get, options = {}) =>
  Object.assign(Object.create(null), options, {
    get,
    set: undefined,
    configurable: true,
    enumerable: false,
  });

module.exports = { getterDescriptor, methodDescriptor };
