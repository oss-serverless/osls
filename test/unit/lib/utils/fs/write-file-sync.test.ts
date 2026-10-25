'use strict';

const fsp = require('fs').promises;
const path = require('path');
const Utils = require('../../../../../lib/classes/utils');
const YamlParser = require('../../../../../lib/classes/yaml-parser');
const writeFileSync = require('../../../../../lib/utils/fs/write-file-sync');
const readFileSync = require('../../../../../lib/utils/fs/read-file-sync');
const { expect } = require('chai');
const { getTmpFilePath } = require('../../../../utils/fs');

const createHarness = () => {
  const serverlessLike = {};
  serverlessLike.utils = new Utils(serverlessLike);
  serverlessLike.yamlParser = new YamlParser(serverlessLike);
  return serverlessLike;
};

describe('#writeFileSync()', () => {
  let serverless;

  beforeEach(() => {
    serverless = createHarness();
  });

  it('should write a .json file synchronously', () => {
    const tmpFilePath = getTmpFilePath('anything.json');

    writeFileSync(tmpFilePath, { foo: 'bar' });
    const obj = readFileSync(tmpFilePath);

    expect(obj.foo).to.equal('bar');
  });

  it('should write a .yml file synchronously', async () => {
    const tmpFilePath = getTmpFilePath('anything.yml');

    writeFileSync(tmpFilePath, { foo: 'bar' });

    return serverless.yamlParser.parse(tmpFilePath).then((obj) => {
      expect(obj.foo).to.equal('bar');
    });
  });

  it('should write a .yaml file synchronously', async () => {
    const tmpFilePath = getTmpFilePath('anything.yaml');

    writeFileSync(tmpFilePath, { foo: 'bar' });

    return serverless.yamlParser.parse(tmpFilePath).then((obj) => {
      expect(obj.foo).to.equal('bar');
    });
  });

  it('should throw error if invalid path is provided', () => {
    expect(() => {
      writeFileSync(null);
    }).to.throw(Error);
  });

  it('should be able to write an object with circular references', async () => {
    const tmpFilePath = getTmpFilePath('anything.json');
    const bar = {};
    bar.foo = bar;
    const expected = '{\n  "foo": {\n    "$ref": "$"\n  }\n}';

    writeFileSync(tmpFilePath, bar, true);

    return fsp.readFile(tmpFilePath, 'utf8').then((contents) => {
      expect(contents).to.equal(expected);
    });
  });

  it('should create nested parent directories', () => {
    const tmpFilePath = path.join(getTmpFilePath('nested.json'), 'nested', 'anything.json');

    writeFileSync(tmpFilePath, { foo: 'bar' });

    expect(readFileSync(tmpFilePath)).to.deep.equal({ foo: 'bar' });
  });
});
