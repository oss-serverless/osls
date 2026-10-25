'use strict';

const crypto = require('crypto');
const deepSortObjectByKey = require('../../utils/deep-sort-object-by-key');

module.exports = (schema) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(deepSortObjectByKey(schema)))
    .digest('hex');
