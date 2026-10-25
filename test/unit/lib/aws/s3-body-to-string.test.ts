'use strict';

const { Readable } = require('stream');
const zlib = require('zlib');
const { expect } = require('chai');
const s3BodyToString = require('../../../../lib/aws/s3-body-to-string');

describe('test/unit/lib/aws/s3-body-to-string.test.js', () => {
  it('returns string bodies unchanged', async () => {
    await expect(s3BodyToString('value')).to.eventually.equal('value');
  });

  it('converts Buffer bodies', async () => {
    await expect(s3BodyToString(Buffer.from('value'))).to.eventually.equal('value');
  });

  it('does not decompress gzip-encoded bodies', async () => {
    const body = zlib.gzipSync('value');
    const result = await s3BodyToString(body);

    expect(result).to.equal(body.toString('utf8'));
    expect(result).to.not.equal('value');
  });

  it('converts Uint8Array bodies', async () => {
    await expect(s3BodyToString(new Uint8Array(Buffer.from('value')))).to.eventually.equal('value');
  });

  it('converts ArrayBuffer bodies', async () => {
    const buffer = Buffer.from('value');
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );

    await expect(s3BodyToString(arrayBuffer)).to.eventually.equal('value');
  });

  it('converts Node readable stream bodies', async () => {
    await expect(s3BodyToString(Readable.from(['val', 'ue']))).to.eventually.equal('value');
  });

  it('converts Web ReadableStream bodies when available', async () => {
    if (typeof ReadableStream !== 'function') return;

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('val'));
        controller.enqueue(new TextEncoder().encode('ue'));
        controller.close();
      },
    });

    await expect(s3BodyToString(body)).to.eventually.equal('value');
  });

  it('converts Blob bodies when available', async () => {
    if (typeof Blob !== 'function') return;

    await expect(s3BodyToString(new Blob(['value']))).to.eventually.equal('value');
  });

  it('uses SDK transformToString when present', async () => {
    const body = {
      transformToString: async (encoding) => `transformed:${encoding}`,
      [Symbol.asyncIterator]: async function* iterator() {
        yield 'streamed';
      },
    };

    await expect(s3BodyToString(body)).to.eventually.equal('transformed:utf8');
  });

  it('passes custom encoding to SDK transformToString', async () => {
    const body = {
      transformToString: async (encoding) => encoding,
    };

    await expect(s3BodyToString(body, { encoding: 'latin1' })).to.eventually.equal('latin1');
  });

  it('propagates transformToString errors', async () => {
    const body = {
      transformToString: async () => {
        throw new Error('transform failed');
      },
    };

    await expect(s3BodyToString(body)).to.be.rejectedWith('transform failed');
  });

  it('propagates Node readable stream errors', async () => {
    const body = new Readable({
      read() {
        this.destroy(new Error('stream failed'));
      },
    });

    await expect(s3BodyToString(body)).to.be.rejectedWith('stream failed');
  });

  it('returns an empty string for nullish bodies', async () => {
    await expect(s3BodyToString(null)).to.eventually.equal('');
    await expect(s3BodyToString()).to.eventually.equal('');
  });

  it('rejects unsupported body shapes without stringifying contents', async () => {
    const body = { secret: 'do-not-log' };

    try {
      await s3BodyToString(body);
      throw new Error('Expected s3BodyToString to reject');
    } catch (error) {
      expect(error.code).to.equal('UNSUPPORTED_S3_GET_OBJECT_BODY');
      expect(error.message).to.include('[object Object]');
      expect(error.message).to.not.include('do-not-log');
    }
  });

  for (const body of [123, true, () => {}]) {
    it(`rejects unsupported ${typeof body} bodies`, async () => {
      try {
        await s3BodyToString(body);
        throw new Error('Expected s3BodyToString to reject');
      } catch (error) {
        expect(error.code).to.equal('UNSUPPORTED_S3_GET_OBJECT_BODY');
      }
    });
  }
});
