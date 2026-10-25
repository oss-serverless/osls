'use strict';

const expect = require('chai').expect;

const ServerlessError = require('../../../../lib/serverless-error');
const tokenizeError = require('../../../../lib/utils/tokenize-exception');

describe('test/unit/lib/utils/tokenize-exception.test.js', () => {
  it('Should tokenize user error', () => {
    const errorTokens = tokenizeError(
      new ServerlessError('Some error', 'ERR_CODE', { decoratedMessage: 'decorated' })
    );
    expect(errorTokens.title).to.equal('Serverless Error');
    expect(errorTokens.name).to.equal('ServerlessError');
    expect(errorTokens.stack).to.include('tokenize-exception.test.js:');
    expect(errorTokens.message).to.equal('Some error');
    expect(errorTokens.isUserError).to.equal(true);
    expect(errorTokens.code).to.equal('ERR_CODE');
    expect(errorTokens.decoratedMessage).to.equal('decorated');
  });

  it('Should tokenize programmer error', () => {
    const errorTokens = tokenizeError(new TypeError('Some error'));
    expect(errorTokens.title).to.equal('Type Error');
    expect(errorTokens.name).to.equal('TypeError');
    expect(errorTokens.stack).to.include('tokenize-exception.test.js:');
    expect(errorTokens.message).to.equal('Some error');
    expect(errorTokens.isUserError).to.equal(false);
  });

  it('Should tokenize AWS SDK service error as user error', () => {
    const exception = Object.assign(
      new Error('User is not authorized to perform: cloudformation:UpdateStack'),
      { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }
    );
    const errorTokens = tokenizeError(exception);
    expect(errorTokens.title).to.equal('Access Denied');
    expect(errorTokens.isUserError).to.equal(true);
    expect(errorTokens.code).to.equal('AWS_ACCESS_DENIED');
  });

  it('Should normalize AWS SDK service error names into codes', () => {
    const exception = Object.assign(new Error('Rate exceeded'), {
      name: 'ThrottlingException',
      $metadata: { httpStatusCode: 429 },
    });
    expect(tokenizeError(exception).code).to.equal('AWS_THROTTLING_EXCEPTION');
  });

  it('Should preserve explicit codes on AWS SDK service errors', () => {
    const exception = Object.assign(new Error('Some error'), {
      name: 'ThrottlingException',
      code: 'CUSTOM_CODE',
      $metadata: { httpStatusCode: 429 },
    });
    const errorTokens = tokenizeError(exception);
    expect(errorTokens.isUserError).to.equal(true);
    expect(errorTokens.code).to.equal('CUSTOM_CODE');
  });

  it('Should not classify errors without $metadata as AWS service errors', () => {
    const exception = Object.assign(new Error('Some error'), { name: 'AccessDenied' });
    const errorTokens = tokenizeError(exception);
    expect(errorTokens.isUserError).to.equal(false);
    expect(errorTokens.code).to.equal(undefined);
  });

  it('Should tokenize non-error exception', () => {
    const errorTokens = tokenizeError(null);
    expect(errorTokens.title).to.equal('Exception');
    expect(errorTokens.message).to.equal('null');
    expect(errorTokens.isUserError).to.equal(false);
  });
});
