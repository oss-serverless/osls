'use strict';

const { expect } = require('chai');
const ServerlessError = require('../../../../../../lib/serverless-error');
const isS3ListAccessDeniedError = require('../../../../../../lib/plugins/aws/utils/is-s3-list-access-denied-error');

describe('test/unit/lib/plugins/aws/utils/is-s3-list-access-denied-error.test.js', () => {
  it('matches explicit access denied codes', () => {
    expect(isS3ListAccessDeniedError({ code: 'AWS_S3_LIST_OBJECTS_V2_ACCESS_DENIED' })).to.equal(
      true
    );
    expect(isS3ListAccessDeniedError({ code: 'AccessDenied' })).to.equal(true);
    expect(isS3ListAccessDeniedError({ Code: 'AccessDenied' })).to.equal(true);
    expect(isS3ListAccessDeniedError({ name: 'AccessDenied' })).to.equal(true);
    expect(isS3ListAccessDeniedError({ providerError: { code: 'AccessDenied' } })).to.equal(true);
    expect(isS3ListAccessDeniedError({ providerError: { Code: 'AccessDenied' } })).to.equal(true);
    expect(isS3ListAccessDeniedError({ providerError: { name: 'AccessDenied' } })).to.equal(true);
  });

  it('prefers meaningful SDK v3 error names over legacy codes', () => {
    expect(
      isS3ListAccessDeniedError({
        name: 'AccessDenied',
        code: 'SignatureDoesNotMatch',
      })
    ).to.equal(true);
    expect(
      isS3ListAccessDeniedError({
        name: 'SignatureDoesNotMatch',
        code: 'AccessDenied',
        statusCode: 403,
      })
    ).to.equal(false);
    expect(
      isS3ListAccessDeniedError({
        providerError: {
          name: 'AccessDenied',
          code: 'SignatureDoesNotMatch',
        },
      })
    ).to.equal(true);
    expect(
      isS3ListAccessDeniedError({
        providerError: {
          name: 'SignatureDoesNotMatch',
          code: 'AccessDenied',
          statusCode: 403,
        },
      })
    ).to.equal(false);
  });

  it('matches status-only 403 errors', () => {
    expect(isS3ListAccessDeniedError({ statusCode: 403 })).to.equal(true);
    expect(isS3ListAccessDeniedError({ $metadata: { httpStatusCode: 403 } })).to.equal(true);
    expect(isS3ListAccessDeniedError({ providerError: { statusCode: 403 } })).to.equal(true);
    expect(
      isS3ListAccessDeniedError({
        providerError: { $metadata: { httpStatusCode: 403 } },
      })
    ).to.equal(true);
  });

  it('matches wrapped generic list errors with status 403', () => {
    expect(
      isS3ListAccessDeniedError(
        Object.assign(new ServerlessError('forbidden', 'AWS_S3_LIST_OBJECTS_V2_ERROR'), {
          providerError: { statusCode: 403 },
        })
      )
    ).to.equal(true);
    expect(
      isS3ListAccessDeniedError(
        Object.assign(new ServerlessError('forbidden', 'AWS_S3_LIST_OBJECT_VERSIONS_ERROR'), {
          providerError: { statusCode: 403 },
        })
      )
    ).to.equal(true);
  });

  it('does not match specific non-access-denied auth errors', () => {
    for (const code of ['SignatureDoesNotMatch', 'InvalidAccessKeyId', 'ExpiredToken']) {
      expect(
        isS3ListAccessDeniedError({
          providerError: {
            code,
            statusCode: 403,
          },
        })
      ).to.equal(false);
    }
  });

  it('does not match inherited legacy error fields', () => {
    expect(isS3ListAccessDeniedError(Object.create({ code: 'AccessDenied' }))).to.equal(false);
    expect(isS3ListAccessDeniedError(Object.create({ Code: 'AccessDenied' }))).to.equal(false);
    expect(isS3ListAccessDeniedError(Object.create({ name: 'AccessDenied' }))).to.equal(false);
    expect(isS3ListAccessDeniedError(Object.create({ statusCode: 403 }))).to.equal(false);
    expect(
      isS3ListAccessDeniedError(
        Object.create({ providerError: { code: 'AccessDenied', statusCode: 403 } })
      )
    ).to.equal(false);
    expect(
      isS3ListAccessDeniedError({ providerError: Object.create({ name: 'AccessDenied' }) })
    ).to.equal(false);
    expect(
      isS3ListAccessDeniedError(Object.create({ $metadata: { httpStatusCode: 403 } }))
    ).to.equal(false);
  });

  it('does not match unrelated errors', () => {
    expect(isS3ListAccessDeniedError(new Error('boom'))).to.equal(false);
    expect(isS3ListAccessDeniedError({ code: 'Throttling', statusCode: 403 })).to.equal(false);
    expect(isS3ListAccessDeniedError({ code: 'AccessDenied', statusCode: 500 })).to.equal(true);
  });
});
