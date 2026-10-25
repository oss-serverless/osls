import ensureString from 'type/string/ensure.js';

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

export default (textTokens) =>
  `${flattenDeep(textTokens)
    .map((textToken) => ensureString(textToken, { isOptional: true, name: 'textToken' }) || '')
    .join('\n')}\n`;
