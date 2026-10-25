// Dedicated to join text tokens as passed to `writeText` and `progress.update`

'use strict';

const ensureString = require('type/string/ensure');

const flattenDeep = (items) => {
  const result = [];
  for (const item of items) {
    if (Array.isArray(item)) {
      result.push(...flattenDeep(item));
    } else {
      result.push(item);
    }
  }
  return result;
};

module.exports = (textTokens) =>
  `${flattenDeep(textTokens)
    .map((textToken) => ensureString(textToken, { isOptional: true, name: 'textToken' }) || '')
    .join('\n')}\n`;
