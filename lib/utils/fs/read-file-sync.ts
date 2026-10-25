'use strict';

const fs = require('fs');
const parse = require('./parse');

function readFileSync(filePath) {
  const contents = fs.readFileSync(filePath);
  return parse(filePath, contents);
}

module.exports = readFileSync;
