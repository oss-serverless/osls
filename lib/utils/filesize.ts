'use strict';

const ensureNaturalNumber = require('type/natural-number/ensure');

const base = 1000;
const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

const resolveSignificant = (size) => {
  return size >= base ? resolveSignificant(Math.floor(size / base)) : size;
};

module.exports = (size) => {
  const ensuredSize = ensureNaturalNumber(size, { name: 'size' });

  if (Number(size) < 0) {
    throw new TypeError(`Expected a natural number for size, received ${size}`);
  }

  const round = resolveSignificant(ensuredSize) >= 9 ? 0 : 1;
  const number = ensuredSize;
  let exponent = number === 0 ? 0 : Math.floor(Math.log(number) / Math.log(base));

  if (exponent > units.length - 1) exponent = units.length - 1;

  let value = 0;

  if (number !== 0) {
    const precision = Math.pow(10, exponent > 0 ? round : 0);
    value = Math.round((number / Math.pow(base, exponent)) * precision) / precision;

    if (value === base && exponent < units.length - 1) {
      value = 1;
      exponent += 1;
    }
  }

  return `${value} ${units[exponent]}`;
};
