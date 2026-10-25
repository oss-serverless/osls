'use strict';

const ServerlessError = require('../../serverless-error');

const YAML_REF_ACCESS_DENIED = 'YAML_REF_ACCESS_DENIED';
const YAML_REF_OPTIONS_ERROR = 'YAML_REF_OPTIONS_ERROR';

const isExternalRefAccessDeniedError = (error) => error && error.code === YAML_REF_ACCESS_DENIED;

const createExternalRefAccessDeniedError = (message) =>
  new ServerlessError(message, YAML_REF_ACCESS_DENIED);

const denyExternalRef = (message) => {
  throw createExternalRefAccessDeniedError(message);
};

const getExternalRefAccessDeniedError = (error, seenErrors = new Set()) => {
  if (error == null || typeof error !== 'object') return null;
  if (seenErrors.has(error)) return null;

  seenErrors.add(error);

  if (isExternalRefAccessDeniedError(error)) return error;

  const causeError = getExternalRefAccessDeniedError(error.cause, seenErrors);
  if (causeError) return causeError;

  if (Array.isArray(error.errors)) {
    for (const childError of error.errors) {
      const accessDeniedError = getExternalRefAccessDeniedError(childError, seenErrors);
      if (accessDeniedError) return accessDeniedError;
    }
  }

  return null;
};

const throwOptionsError = (message) => {
  throw new ServerlessError(message, YAML_REF_OPTIONS_ERROR);
};

module.exports = {
  createExternalRefAccessDeniedError,
  denyExternalRef,
  getExternalRefAccessDeniedError,
  isExternalRefAccessDeniedError,
  throwOptionsError,
  YAML_REF_ACCESS_DENIED,
  YAML_REF_OPTIONS_ERROR,
};
