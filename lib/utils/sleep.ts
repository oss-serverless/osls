'use strict';

const maxTimeout = 2 ** 31 - 1;

const normalizeTimeout = (value) => {
  const number = Number(value);
  const timeout = Number.isNaN(number) ? 0 : Math.trunc(number);

  if (timeout > maxTimeout) {
    throw new TypeError(`${timeout} exceeds maximum possible timeout`);
  }

  return Math.max(0, timeout);
};

module.exports = (timeout) => {
  if (timeout == null) {
    return new Promise((resolve) => process.nextTick(resolve));
  }

  const normalizedTimeout = normalizeTimeout(timeout);
  return new Promise((resolve) => setTimeout(resolve, normalizedTimeout));
};
