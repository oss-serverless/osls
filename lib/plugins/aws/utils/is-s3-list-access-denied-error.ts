'use strict';

const ServerlessError = require('../../../serverless-error');
const { hasOwn } = require('../../../utils/safe-object');

const getOwnValue = (object, key) =>
  object != null && hasOwn(object, key) ? object[key] : undefined;

const genericS3ListErrorCodes = new Set([
  'AWS_S3_LIST_OBJECTS_V2_ERROR',
  'AWS_S3_LIST_OBJECT_VERSIONS_ERROR',
]);

const getErrorName = (error) => {
  const name = getOwnValue(error, 'name');
  if (!name || name === 'Error' || name === ServerlessError.name) return undefined;
  return name;
};

const getErrorCode = (error) => {
  if (!error) return undefined;

  const providerError = getOwnValue(error, 'providerError');
  if (providerError) {
    const providerErrorName = getErrorName(providerError);
    if (providerErrorName) return providerErrorName;

    const providerErrorCode =
      getOwnValue(providerError, 'code') || getOwnValue(providerError, 'Code');
    if (providerErrorCode) return providerErrorCode;
  }

  return getErrorName(error) || getOwnValue(error, 'Code') || getOwnValue(error, 'code');
};

const getErrorStatusCode = (error) => {
  if (!error) return undefined;
  const providerError = getOwnValue(error, 'providerError');
  const providerMetadata = getOwnValue(providerError, '$metadata');
  const metadata = getOwnValue(error, '$metadata');
  return (
    getOwnValue(providerError, 'statusCode') ||
    getOwnValue(providerMetadata, 'httpStatusCode') ||
    getOwnValue(error, 'statusCode') ||
    getOwnValue(metadata, 'httpStatusCode')
  );
};

module.exports = (error) => {
  const errorCode = getErrorCode(error);

  return (
    errorCode === 'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED' ||
    errorCode === 'AccessDenied' ||
    ((!errorCode || genericS3ListErrorCodes.has(errorCode)) && getErrorStatusCode(error) === 403)
  );
};
