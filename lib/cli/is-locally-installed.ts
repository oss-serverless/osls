'use strict';

const path = require('path');
const resolveLocalServerlessPath = require('./local-serverless-path');

module.exports = ({ cwd = process.cwd() } = {}) =>
  resolveLocalServerlessPath({ cwd }) === path.resolve(__dirname, '../../');
