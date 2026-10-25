'use strict';

const globalStateSymbol = Symbol.for('serverless/serverless/202110');

if (!Object.prototype.hasOwnProperty.call(globalThis, globalStateSymbol)) {
  Object.defineProperty(globalThis, globalStateSymbol, {
    value: Object.create(null),
  });
}

module.exports = globalThis[globalStateSymbol];
