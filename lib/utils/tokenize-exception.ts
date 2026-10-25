'use strict';

const { inspect } = require('util');
const isError = require('type/error/is');
const { hasOwn } = require('./safe-object');

const userErrorNames = new Set(['ServerlessError']);

// AWS SDK v3 service errors carry response metadata in `$metadata`
const isAwsSdkV3ServiceError = (exception) =>
  Boolean(hasOwn(exception, '$metadata') && exception.$metadata && exception.name);

const toConstantCase = (name) =>
  name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();

module.exports = (exception) => {
  if (isError(exception)) {
    const isAwsServiceError = isAwsSdkV3ServiceError(exception);
    return {
      title: exception.name.replace(/([A-Z])/g, ' $1').trim(),
      name: exception.name,
      stack: exception.stack,
      message: exception.message,
      // AWS service errors (access denied, throttling exhaustion, ...) reflect the user's
      // account or environment, not framework bugs - render them without a stack trace
      isUserError: userErrorNames.has(exception.name) || isAwsServiceError,
      code:
        exception.code ?? (isAwsServiceError ? `AWS_${toConstantCase(exception.name)}` : undefined),
      decoratedMessage: exception.decoratedMessage,
    };
  }
  return {
    title: 'Exception',
    message: inspect(exception),
    isUserError: false,
  };
};
