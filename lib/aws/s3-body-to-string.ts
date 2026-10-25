'use strict';

const ServerlessError = require('../serverless-error');

function chunkToBuffer(chunk, encoding) {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, encoding);
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }

  if (chunk instanceof ArrayBuffer) {
    return Buffer.from(chunk);
  }

  return Buffer.from(chunk);
}

async function webReadableStreamToString(stream, encoding) {
  const chunks = [];
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      chunks.push(chunkToBuffer(value, encoding));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString(encoding);
}

async function nodeReadableStreamToString(stream, encoding) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunkToBuffer(chunk, encoding));
  }

  return Buffer.concat(chunks).toString(encoding);
}

async function s3BodyToString(body, { encoding = 'utf8' } = {}) {
  if (body == null) {
    return '';
  }

  if (typeof body === 'string') {
    return body;
  }

  if (typeof body.transformToString === 'function') {
    return body.transformToString(encoding);
  }

  if (Buffer.isBuffer(body)) {
    return body.toString(encoding);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString(encoding);
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body).toString(encoding);
  }

  if (typeof Blob === 'function' && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer()).toString(encoding);
  }

  if (typeof body.getReader === 'function') {
    return webReadableStreamToString(body, encoding);
  }

  if (typeof body[Symbol.asyncIterator] === 'function') {
    return nodeReadableStreamToString(body, encoding);
  }

  throw new ServerlessError(
    `Unsupported S3 GetObject Body type: ${Object.prototype.toString.call(body)}`,
    'UNSUPPORTED_S3_GET_OBJECT_BODY'
  );
}

module.exports = s3BodyToString;
