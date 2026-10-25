'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { expect } = require('chai');

const { readJson, writeJson } = require('../../../../../lib/utils/fs/json-file');
const { getTmpDirPath } = require('../../../../utils/fs');

describe('test/unit/lib/utils/fs/json-file.test.js', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = getTmpDirPath();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('strips a UTF-8 BOM when reading JSON', async () => {
    const filePath = path.join(tmpDir, 'bom.json');
    await fsp.writeFile(filePath, '\uFEFF{"service":"test"}');

    expect(await readJson(filePath)).to.deep.equal({ service: 'test' });
  });

  it('prefixes parse errors with the file path', async () => {
    const filePath = path.join(tmpDir, 'invalid.json');
    await fsp.writeFile(filePath, '{invalid');

    await expect(readJson(filePath)).to.be.rejectedWith(filePath);
  });

  it('writes compact JSON plus a final newline', async () => {
    const filePath = path.join(tmpDir, 'serverless.json');

    await writeJson(filePath, { plugins: ['plugin'] });

    expect(await fsp.readFile(filePath, 'utf8')).to.equal('{"plugins":["plugin"]}\n');
  });

  it('rejects values JSON cannot represent', async () => {
    await expect(writeJson(path.join(tmpDir, 'serverless.json'), undefined)).to.be.rejectedWith(
      TypeError
    );
  });
});
