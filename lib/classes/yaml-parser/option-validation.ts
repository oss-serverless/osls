'use strict';

const isPlainObject = require('type/plain-object/is');
const { throwOptionsError } = require('./external-ref-errors');

const getOptionLabel = (optionName) =>
  optionName === 'options' ? 'YAML parser options' : `YAML parser option ${optionName}`;

const assertOptionsObject = (value, optionName) => {
  if (value == null || !isPlainObject(value)) {
    throwOptionsError(`${getOptionLabel(optionName)} must be an object.`);
  }
};

const assertKnownOptions = (options, optionName, allowedOptions) => {
  for (const key of Object.keys(options)) {
    if (!allowedOptions.includes(key)) {
      const optionPath = optionName === 'options' ? key : `${optionName}.${key}`;
      throwOptionsError(`YAML parser option ${optionPath} is not supported.`);
    }
  }
};

module.exports = {
  assertKnownOptions,
  assertOptionsObject,
};
