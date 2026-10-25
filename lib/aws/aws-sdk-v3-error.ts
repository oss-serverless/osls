'use strict';

const ServerlessError = require('../serverless-error');
const { hasOwn } = require('../utils/safe-object');

const genericS3ListErrorCodes = new Set([
  'AWS_S3_LIST_OBJECTS_V2_ERROR',
  'AWS_S3_LIST_OBJECT_VERSIONS_ERROR',
]);

const alreadyNormalizedErrorCodePattern = /^[A-Z0-9_]+$/;
const acronymBoundaryPattern = /([A-Z]+)([A-Z][a-z])/g;
const camelCaseBoundaryPattern = /([a-z0-9])([A-Z])/g;

function getOwnValue(object, key) {
  return object != null && hasOwn(object, key) ? object[key] : undefined;
}

function getAwsErrorName(error) {
  const name = getOwnValue(error, 'name');
  if (!name || name === 'Error' || name === ServerlessError.name) return undefined;
  return name;
}

function getAwsErrorMessage(error) {
  const message = getOwnValue(error, 'message');
  return typeof message === 'string' ? message : undefined;
}

function getAwsErrorCode(error) {
  if (!error) return undefined;

  const providerError = getOwnValue(error, 'providerError');
  if (providerError) {
    const providerErrorName = getAwsErrorName(providerError);
    if (providerErrorName) return providerErrorName;

    const providerErrorCode =
      getOwnValue(providerError, 'code') || getOwnValue(providerError, 'Code');
    if (providerErrorCode) return providerErrorCode;
  }

  const name = getAwsErrorName(error);
  if (name) return name;

  const upperCode = getOwnValue(error, 'Code');
  if (upperCode) return upperCode;
  return getOwnValue(error, 'code');
}

function getAwsErrorStatusCode(error) {
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
}

function isAwsErrorCode(error, ...codes) {
  return codes.includes(getAwsErrorCode(error));
}

function isAwsErrorStatusCode(error, ...statusCodes) {
  return statusCodes.includes(getAwsErrorStatusCode(error));
}

function isAwsCredentialProviderError(error) {
  return getOwnValue(error, 'name') === 'CredentialsProviderError';
}

function isAwsCredentialsNotFoundError(error) {
  return getOwnValue(error, 'code') === 'AWS_CREDENTIALS_NOT_FOUND';
}

function isAwsSdkV3MissingCredentialsError(error) {
  const message = getAwsErrorMessage(error);
  return message ? message.includes('Could not load credentials from any providers') : false;
}

const unrecognizedProfilePattern = /Could not resolve credentials using profile: \[([^\]]+)\]/;

function getAwsSdkV3UnrecognizedProfile(error) {
  if (!isAwsCredentialProviderError(error)) return undefined;
  const message = getAwsErrorMessage(error);
  const match = message ? message.match(unrecognizedProfilePattern) : undefined;
  return match ? match[1] : undefined;
}

// Errors raised by the interactive SSO login wrapper during credential
// resolution (lib/aws/sso-login.js)
function isAwsSsoLoginError(error) {
  const code = getOwnValue(error, 'code');
  return typeof code === 'string' && code.startsWith('AWS_SSO_LOGIN_');
}

function isAwsCredentialError(error) {
  return (
    isAwsCredentialsNotFoundError(error) ||
    isAwsCredentialProviderError(error) ||
    isAwsSsoLoginError(error)
  );
}

const throttlingErrorCodes = new Set([
  'Throttling',
  'ThrottlingException',
  'ThrottledException',
  'TooManyRequestsException',
  'RequestLimitExceeded',
  'RequestThrottled',
  'RequestThrottledException',
  'SlowDown',
  'PriorRequestNotComplete',
  'ProvisionedThroughputExceededException',
]);

function hasThrottlingRetryableFlag(error) {
  const retryable = getOwnValue(error, '$retryable');
  return Boolean(retryable && retryable.throttling);
}

function isAwsThrottlingError(error) {
  if (hasThrottlingRetryableFlag(error)) return true;
  if (hasThrottlingRetryableFlag(getOwnValue(error, 'providerError'))) return true;
  if (isAwsErrorStatusCode(error, 429)) return true;
  const code = getAwsErrorCode(error);
  return code ? throttlingErrorCodes.has(code) : false;
}

const transientNetworkErrorCodes = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT']);

function isTransientNetworkError(error) {
  const code = getOwnValue(error, 'code');
  if (code && transientNetworkErrorCodes.has(code)) return true;
  return getAwsErrorMessage(error) === 'aborted';
}

function isApiGatewayNotFoundError(error) {
  return isAwsErrorCode(error, 'NotFoundException') || isAwsErrorStatusCode(error, 404);
}

function isCloudFormationValidationError(error) {
  return isAwsErrorCode(error, 'ValidationError');
}

function isCloudFormationValidationErrorWithMessage(error, messageFragment) {
  const message = getAwsErrorMessage(error);
  return (
    isCloudFormationValidationError(error) && Boolean(message && message.includes(messageFragment))
  );
}

function isCloudFormationMissingResourceError(error) {
  const message = getAwsErrorMessage(error);
  return (
    isCloudFormationValidationError(error) &&
    Boolean(
      message &&
      (message.includes('does not exist for stack') ||
        message === 'Resource does not exist' ||
        (message.startsWith('Resource ') && message.includes(' does not exist')))
    )
  );
}

function isCloudFormationMissingStackError(error) {
  const message = getAwsErrorMessage(error);
  return (
    isCloudFormationValidationError(error) &&
    Boolean(message && message.includes('does not exist')) &&
    !isCloudFormationMissingResourceError(error)
  );
}

function isCloudFormationNoUpdateError(error) {
  return isCloudFormationValidationErrorWithMessage(error, 'No updates are to be performed.');
}

function isCloudWatchLogsResourceNotFoundError(error) {
  return isAwsErrorCode(error, 'ResourceNotFoundException') || isAwsErrorStatusCode(error, 404);
}

function isEcrAccessDeniedError(error) {
  return isAwsErrorCode(error, 'AccessDeniedException');
}

function isEcrRepositoryNotFoundError(error) {
  return isAwsErrorCode(error, 'RepositoryNotFoundException');
}

function isLambdaAccessDeniedError(error) {
  return isAwsErrorCode(error, 'AccessDeniedException') || isAwsErrorStatusCode(error, 403);
}

function isLambdaResourceConflictError(error) {
  return isAwsErrorCode(error, 'ResourceConflictException');
}

function isLambdaResourceNotFoundError(error) {
  return isAwsErrorCode(error, 'ResourceNotFoundException');
}

function normalizeErrorCodePostfix(code) {
  if (typeof code === 'number') return `HTTP_${code}_ERROR`;
  const stringCode = String(code);
  if (alreadyNormalizedErrorCodePattern.test(stringCode)) return stringCode;
  return stringCode
    .replace(acronymBoundaryPattern, '$1_$2')
    .replace(camelCaseBoundaryPattern, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toUpperCase();
}

function createS3UploadError(error) {
  if (error instanceof ServerlessError) return error;

  const providerErrorCode = getAwsErrorCode(error) || getAwsErrorStatusCode(error);
  const providerErrorCodeExtension = providerErrorCode
    ? normalizeErrorCodePostfix(providerErrorCode)
    : 'ERROR';

  return Object.assign(
    new ServerlessError(
      getAwsErrorMessage(error) || String(providerErrorCode || 'Error'),
      `AWS_S3_UPLOAD_${providerErrorCodeExtension}`
    ),
    {
      providerError: error,
      providerErrorCodeExtension,
    }
  );
}

function getHeader(headers, headerName) {
  if (!headers) return undefined;
  if (hasOwn(headers, headerName) && headers[headerName]) return headers[headerName];
  const normalizedHeaderName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName) return value;
  }
  return undefined;
}

function normalizeS3BucketRegion(region) {
  if (region === 'EU') return 'eu-west-1';
  return region;
}

function getS3BucketRegion(resultOrError) {
  if (!resultOrError) return undefined;
  const metadata = getOwnValue(resultOrError, '$metadata');
  const response = getOwnValue(resultOrError, '$response');
  const metadataHeaders = getOwnValue(metadata, 'httpHeaders');
  const responseHeaders = getOwnValue(response, 'headers');
  return normalizeS3BucketRegion(
    getOwnValue(resultOrError, 'BucketRegion') ||
      getOwnValue(resultOrError, 'bucketRegion') ||
      getOwnValue(resultOrError, 'region') ||
      getHeader(metadataHeaders, 'x-amz-bucket-region') ||
      getHeader(responseHeaders, 'x-amz-bucket-region')
  );
}

function isS3GetObjectNoSuchKeyError(error) {
  return isAwsErrorCode(error, 'AWS_S3_GET_OBJECT_NO_SUCH_KEY', 'NoSuchKey');
}

function isS3HeadBucketForbiddenError(error) {
  return (
    isAwsErrorCode(error, 'AWS_S3_HEAD_BUCKET_FORBIDDEN', 'Forbidden', 'AccessDenied') ||
    isAwsErrorStatusCode(error, 403)
  );
}

function isS3HeadBucketNotFoundError(error) {
  return (
    isAwsErrorCode(error, 'AWS_S3_HEAD_BUCKET_NOT_FOUND', 'NotFound', 'NoSuchBucket') ||
    isAwsErrorStatusCode(error, 404)
  );
}

function isS3HeadObjectForbiddenError(error) {
  return (
    isAwsErrorCode(error, 'AWS_S3_HEAD_OBJECT_FORBIDDEN', 'Forbidden', 'AccessDenied') ||
    isAwsErrorStatusCode(error, 403)
  );
}

function isS3ListObjectsAccessDeniedError(error) {
  const errorCode = getAwsErrorCode(error);

  return (
    errorCode === 'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED' ||
    errorCode === 'AccessDenied' ||
    ((!errorCode || genericS3ListErrorCodes.has(errorCode)) && getAwsErrorStatusCode(error) === 403)
  );
}

function isS3ListObjectsNoSuchBucketError(error) {
  const message = getAwsErrorMessage(error);
  return (
    isAwsErrorCode(error, 'AWS_S3_LIST_OBJECTS_V2_NO_SUCH_BUCKET', 'NoSuchBucket') ||
    isAwsErrorStatusCode(error, 404) ||
    Boolean(message && message.includes('The specified bucket does not exist'))
  );
}

function isSsmParameterNotFoundError(error) {
  return isAwsErrorCode(error, 'ParameterNotFound', 'AWS_S_S_M_GET_PARAMETER_PARAMETER_NOT_FOUND');
}

module.exports = {
  getAwsErrorCode,
  getAwsErrorMessage,
  getAwsErrorStatusCode,
  isAwsErrorCode,
  isAwsErrorStatusCode,
  isAwsCredentialError,
  isAwsCredentialProviderError,
  isAwsThrottlingError,
  isTransientNetworkError,
  isAwsCredentialsNotFoundError,
  isAwsSdkV3MissingCredentialsError,
  getAwsSdkV3UnrecognizedProfile,
  isApiGatewayNotFoundError,
  isCloudFormationValidationError,
  isCloudFormationValidationErrorWithMessage,
  isCloudFormationMissingResourceError,
  isCloudFormationMissingStackError,
  isCloudFormationNoUpdateError,
  isCloudWatchLogsResourceNotFoundError,
  isEcrAccessDeniedError,
  isEcrRepositoryNotFoundError,
  isLambdaAccessDeniedError,
  isLambdaResourceConflictError,
  isLambdaResourceNotFoundError,
  createS3UploadError,
  getS3BucketRegion,
  isS3GetObjectNoSuchKeyError,
  isS3HeadBucketForbiddenError,
  isS3HeadBucketNotFoundError,
  isS3HeadObjectForbiddenError,
  isS3ListObjectsAccessDeniedError,
  isS3ListObjectsNoSuchBucketError,
  isSsmParameterNotFoundError,
};
