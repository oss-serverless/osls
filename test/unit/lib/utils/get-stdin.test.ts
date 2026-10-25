'use strict';

const sinon = require('sinon');

const getStdin = require('../../../../lib/utils/get-stdin');

const { expect } = require('chai');

const createStdin = ({ chunks = [], isTTY = false, setEncoding = sinon.spy() } = {}) => ({
  isTTY,
  setEncoding,
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) yield chunk;
  },
});

describe('test/unit/lib/utils/get-stdin.test.js', () => {
  it('returns an empty string for TTY stdin', async () => {
    const setEncoding = sinon.spy();
    const stdin = createStdin({ isTTY: true, chunks: ['ignored'], setEncoding });

    expect(await getStdin(stdin)).to.equal('');
    expect(setEncoding).to.not.have.been.called;
  });

  it('reads string chunks', async () => {
    const stdin = createStdin({ chunks: ['hello', ' ', 'world'] });

    expect(await getStdin(stdin)).to.equal('hello world');
  });

  it('reads Buffer chunks', async () => {
    const stdin = createStdin({ chunks: [Buffer.from('hello '), Buffer.from('world')] });

    expect(await getStdin(stdin)).to.equal('hello world');
  });

  it('reads Uint8Array chunks', async () => {
    const encoder = new TextEncoder();
    const stdin = createStdin({ chunks: [encoder.encode('hello '), encoder.encode('world')] });

    expect(await getStdin(stdin)).to.equal('hello world');
  });

  it('decodes multibyte characters split across byte chunks', async () => {
    const bytes = Buffer.from('a€b');
    const stdin = createStdin({ chunks: [bytes.subarray(0, 2), bytes.subarray(2)] });

    expect(await getStdin(stdin)).to.equal('a€b');
  });

  it('reads mixed string and byte chunks', async () => {
    const stdin = createStdin({ chunks: ['hello ', Buffer.from('world')] });

    expect(await getStdin(stdin)).to.equal('hello world');
  });

  it('does not mutate stdin encoding', async () => {
    const setEncoding = sinon.spy();
    const stdin = createStdin({ chunks: ['hello'], setEncoding });

    await getStdin(stdin);

    expect(setEncoding).to.not.have.been.called;
  });

  it('rejects unsupported chunk types', async () => {
    const stdin = createStdin({ chunks: [42] });

    await expect(getStdin(stdin)).to.be.rejectedWith(
      TypeError,
      'Expected stdin chunk to be a string or Uint8Array'
    );
  });

  it('strips a UTF-8 byte order mark', async () => {
    const stdin = createStdin({ chunks: [Buffer.from([0xef, 0xbb, 0xbf, 0x6f, 0x6b])] });

    expect(await getStdin(stdin)).to.equal('ok');
  });
});
