'use strict';

const path = require('path');

module.exports = require('../lib/setup-run-serverless-fixtures-engine')({
  fixturesDir: path.resolve(__dirname, '../fixtures/programmatic'),
  serverlessDir: path.resolve(__dirname, '../../'),
});
