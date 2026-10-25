'use strict';

const jc = require('json-cycle');
const yaml = require('js-yaml');
const cloudformationSchema = require('../serverless-utils/cloudformation-schema');

function parse(filePath, contents) {
  // Auto-parse JSON
  if (filePath.endsWith('.json') || filePath.endsWith('.tfstate')) {
    return jc.parse(contents);
  } else if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
    return yaml.load(contents.toString(), { filename: filePath, schema: cloudformationSchema });
  }
  return contents.toString().trim();
}

module.exports = parse;
