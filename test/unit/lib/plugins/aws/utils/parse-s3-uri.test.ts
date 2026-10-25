'use strict';
const expect = require('chai').expect;
const parseS3URI = require('../../../../../../lib/plugins/aws/utils/parse-s3-uri');

describe('test/unit/lib/plugins/aws/utils/parse-s3-uri.test.js', () => {
  it('should parse an S3 URI', () => {
    const expected = {
      Bucket: 'test-bucket',
      Key: 'path/to/artifact.zip',
    };
    const actual = parseS3URI('s3://test-bucket/path/to/artifact.zip');
    expect(actual).to.deep.equal(expected);
  });

  it('should strip query and fragment from S3 URI keys', () => {
    const actual = parseS3URI(
      's3://test-bucket/path/to/artifact.zip?X-Amz-Credential=secret#fragment'
    );

    expect(actual).to.deep.equal({
      Bucket: 'test-bucket',
      Key: 'path/to/artifact.zip',
    });
    expect(actual.Key).to.not.include('X-Amz');
    expect(actual.Key).to.not.include('?');
  });

  it('should parse an old style S3 URL', () => {
    const expected = {
      Bucket: 'test-bucket',
      Key: 'path/to/artifact.zip',
    };
    const actual = parseS3URI('https://s3.amazonaws.com/test-bucket/path/to/artifact.zip');
    expect(actual).to.deep.equal(expected);
  });

  it('should strip query and fragment from old style S3 URLs', () => {
    const actual = parseS3URI(
      'https://s3.amazonaws.com/test-bucket/path/to/artifact.zip?X-Amz-Signature=secret#fragment'
    );

    expect(actual).to.deep.equal({
      Bucket: 'test-bucket',
      Key: 'path/to/artifact.zip',
    });
    expect(actual.Key).to.not.include('X-Amz');
    expect(actual.Key).to.not.include('Signature');
    expect(actual.Key).to.not.include('?');
  });

  it('should parse an old style S3 URL with region', () => {
    const expected = {
      Bucket: 'test-bucket',
      Key: 'path/to/artifact.zip',
    };
    const actual = parseS3URI(
      'https://s3.us-west-1.amazonaws.com/test-bucket/path/to/artifact.zip'
    );
    expect(actual).to.deep.equal(expected);
  });
  it('should parse another old style S3 URL with region', () => {
    const expected = {
      Bucket: 'test-bucket',
      Key: 'path/to/artifact.zip',
    };
    const actual = parseS3URI(
      'https://s3-us-west-1.amazonaws.com/test-bucket/path/to/artifact.zip'
    );
    expect(actual).to.deep.equal(expected);
  });
  it('should parse a new style S3 URL', () => {
    const expected = {
      Bucket: 'test-bucket',
      Key: 'path/to/artifact.zip',
    };
    const actual = parseS3URI('https://test-bucket.s3.amazonaws.com/path/to/artifact.zip');
    expect(actual).to.deep.equal(expected);
  });

  it('should strip query and fragment from new style S3 URLs', () => {
    const actual = parseS3URI(
      'https://test-bucket.s3.amazonaws.com/path/to/artifact.zip?X-Amz-Signature=secret#fragment'
    );

    expect(actual).to.deep.equal({
      Bucket: 'test-bucket',
      Key: 'path/to/artifact.zip',
    });
    expect(actual.Key).to.not.include('X-Amz');
    expect(actual.Key).to.not.include('Signature');
    expect(actual.Key).to.not.include('?');
  });

  it('should parse a new style S3 URL with region', () => {
    const expected = {
      Bucket: 'test-bucket',
      Key: 'path/to/artifact.zip',
    };
    const actual = parseS3URI(
      'https://test-bucket.s3.eu-west-1.amazonaws.com/path/to/artifact.zip'
    );
    expect(actual).to.deep.equal(expected);
  });
  it('should parse another new style S3 URL with region', () => {
    const expected = {
      Bucket: 'test-bucket',
      Key: 'path/to/artifact.zip',
    };
    const actual = parseS3URI(
      'https://test-bucket.s3-eu-west-1.amazonaws.com/path/to/artifact.zip'
    );
    expect(actual).to.deep.equal(expected);
  });

  it('should preserve raw encoded key text', () => {
    const actual = parseS3URI('https://test-bucket.s3.amazonaws.com/path%20to/artifact%23.zip');

    expect(actual).to.deep.equal({
      Bucket: 'test-bucket',
      Key: 'path%20to/artifact%23.zip',
    });
  });

  it('should reject non S3 URLs', () => {
    const actual = parseS3URI('https://example.com/path/to/artifact.zip');
    expect(actual).to.be.null;
  });

  it('should reject embedded S3-looking substrings', () => {
    expect(parseS3URI('https://example.com/test-bucket.s3.amazonaws.com/path/to/artifact.zip')).to
      .be.null;
    expect(parseS3URI('prefix https://s3.amazonaws.com/test-bucket/path/to/artifact.zip')).to.be
      .null;
    expect(parseS3URI('https://s3.amazonaws.com.evil.com/test-bucket/path/to/artifact.zip')).to.be
      .null;
    expect(parseS3URI('https://test-bucket.s3.amazonaws.com.evil.com/path/to/artifact.zip')).to.be
      .null;
  });

  it('should reject S3 locations without keys', () => {
    expect(parseS3URI('s3://test-bucket')).to.be.null;
    expect(parseS3URI('s3://test-bucket/')).to.be.null;
    expect(parseS3URI('https://s3.amazonaws.com/test-bucket')).to.be.null;
    expect(parseS3URI('https://test-bucket.s3.amazonaws.com/')).to.be.null;
  });

  it('should reject non-string values', () => {
    expect(parseS3URI()).to.be.null;
    expect(parseS3URI(false)).to.be.null;
  });
});
