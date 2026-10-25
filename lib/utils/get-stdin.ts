'use strict';

const { TextDecoder, TextEncoder } = require('node:util');

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf8', {
  // Strip BOM since JS strings are already Unicode and it only adds noise.
  ignoreBOM: false,
});

module.exports = async (stdin = process.stdin) => {
  if (stdin.isTTY) return '';

  const chunks = [];
  let length = 0;

  for await (const chunk of stdin) {
    let data;

    if (typeof chunk === 'string') {
      data = textEncoder.encode(chunk);
    } else if (chunk instanceof Uint8Array) {
      data = chunk;
    } else {
      throw new TypeError('Expected stdin chunk to be a string or Uint8Array');
    }

    chunks.push(data);
    length += data.length;
  }

  const buffer = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  return textDecoder.decode(buffer);
};
