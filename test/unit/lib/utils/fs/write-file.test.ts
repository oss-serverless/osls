'use strict';

const fsp = require('fs').promises;
const path = require('path');
const Utils = require('../../../../../lib/classes/utils');
const YamlParser = require('../../../../../lib/classes/yaml-parser');
const writeFile = require('../../../../../lib/utils/fs/write-file');
const readFile = require('../../../../../lib/utils/fs/read-file');
const { getTmpFilePath } = require('../../../../utils/fs');

// Configure chai
const expect = require('chai').expect;

const createHarness = () => {
  const serverlessLike = {};
  serverlessLike.utils = new Utils(serverlessLike);
  serverlessLike.yamlParser = new YamlParser(serverlessLike);
  return serverlessLike;
};

describe('#writeFile()', function () {
  let serverless;
  this.timeout(0);

  beforeEach(() => {
    serverless = createHarness();
  });

  it('should write a .json file asynchronously', async () => {
    const tmpFilePath = getTmpFilePath('anything.json');
    return writeFile(tmpFilePath, { foo: 'bar' }).then(() =>
      expect(readFile(tmpFilePath)).to.eventually.deep.equal({ foo: 'bar' })
    );
  });

  it('should write a .yml file synchronously', async () => {
    const tmpFilePath = getTmpFilePath('anything.yml');

    return writeFile(tmpFilePath, { foo: 'bar' }).then(() =>
      expect(serverless.yamlParser.parse(tmpFilePath)).to.eventually.deep.equal({ foo: 'bar' })
    );
  });

  it('should write a .yaml file synchronously', async () => {
    const tmpFilePath = getTmpFilePath('anything.yaml');

    return writeFile(tmpFilePath, { foo: 'bar' }).then(() =>
      expect(serverless.yamlParser.parse(tmpFilePath)).to.eventually.deep.equal({ foo: 'bar' })
    );
  });

  it('should be able to write an object with circular references', async () => {
    const tmpFilePath = getTmpFilePath('anything.json');
    const bar = {};
    bar.foo = bar;
    const expected = '{\n  "foo": {\n    "$ref": "$"\n  }\n}';

    return writeFile(tmpFilePath, bar, true).then(() =>
      expect(fsp.readFile(tmpFilePath, 'utf8')).to.eventually.equal(expected)
    );
  });

  it('should create nested parent directories', async () => {
    const tmpFilePath = path.join(getTmpFilePath('nested.json'), 'nested', 'anything.json');

    await writeFile(tmpFilePath, { foo: 'bar' });

    expect(await readFile(tmpFilePath)).to.deep.equal({ foo: 'bar' });
  });
});
