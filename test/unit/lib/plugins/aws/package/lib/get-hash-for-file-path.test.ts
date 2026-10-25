'use strict';

const chai = require('chai');
const crypto = require('crypto');
const getHashForFilePath = require('../../../../../../../lib/plugins/aws/package/lib/get-hash-for-file-path');
const fsp = require('fs').promises;
const path = require('path');

const expect = chai.expect;

describe('getHashForFilePath', () => {
  let filePath;
  before(async () => {
    filePath = path.join(process.cwd(), 'file.txt');
    await fsp.writeFile(filePath, 'content');
  });

  it('correctly generates hash for existing file', async () => {
    const result = await getHashForFilePath(filePath);
    expect(result).to.equal('7XACtDnprIRfIjV9giusFERzD722AW0+yUMil7nsn3M=');
  });

  it('returns a fresh hash when the same file path is rewritten', async () => {
    await fsp.writeFile(filePath, 'first');
    const firstHash = await getHashForFilePath(filePath);

    await fsp.writeFile(filePath, 'second');
    const secondHash = await getHashForFilePath(filePath);

    expect(secondHash).to.not.equal(firstHash);
    expect(secondHash).to.equal(crypto.createHash('sha256').update('second').digest('base64'));
  });

  it('throws a clear error when it fails to read the file', async () => {
    const missingFilePath = path.join(process.cwd(), 'nonexistent.txt');

    const error = await getHashForFilePath(missingFilePath).catch((error) => error);

    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.include(`Could not calculate hash for "${missingFilePath}":`);
    expect(error.cause).to.be.instanceOf(Error);
    expect(error.cause.code).to.equal('ENOENT');
  });
});
