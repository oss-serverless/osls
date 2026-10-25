'use strict';

const fs = require('fs');
const path = require('path');
const jc = require('json-cycle');
const yaml = require('js-yaml');

function writeFileSync(filePath, conts, cycles) {
  let contents = conts || '';

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (filePath.indexOf('.json') !== -1 && typeof contents !== 'string') {
    if (cycles) {
      contents = jc.stringify(contents, null, 2);
    } else {
      contents = JSON.stringify(contents, null, 2);
    }
  }

  const yamlFileExists = filePath.indexOf('.yaml') !== -1;
  const ymlFileExists = filePath.indexOf('.yml') !== -1;

  if ((yamlFileExists || ymlFileExists) && typeof contents !== 'string') {
    contents = yaml.dump(contents);
  }

  return fs.writeFileSync(filePath, contents);
}

module.exports = writeFileSync;
