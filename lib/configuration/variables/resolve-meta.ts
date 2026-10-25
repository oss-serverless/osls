import isPlainObject from 'type/plain-object/is.js';
import ensurePlainObject from 'type/plain-object/ensure.js';
import parse from './parse.ts';
import humanizePropertyPath from './humanize-property-path-keys.ts';

const parseEntries = (entries, parentPropertyPathKeys, map) => {
  for (const [key, value] of entries) {
    if (isPlainObject(value)) {
      parseEntries(Object.entries(value), parentPropertyPathKeys.concat(key), map);
      continue;
    }
    if (Array.isArray(value)) {
      parseEntries(value.entries(), parentPropertyPathKeys.concat(key), map);
      continue;
    }
    if (typeof value === 'string') {
      const variables = (() => {
        try {
          return parse(value);
        } catch (error) {
          const propertyPathTokens = parentPropertyPathKeys.concat(key);
          error.message = `Variable syntax error at "${humanizePropertyPath(
            propertyPathTokens
          )}": ${error.message}`;
          map.set(propertyPathTokens.join('\0'), { value, error });
          return null;
        }
      })();
      if (variables) map.set(parentPropertyPathKeys.concat(key).join('\0'), { value, variables });
    }
  }
  return map;
};

const resolveMeta = (configuration) => {
  ensurePlainObject(configuration);

  return parseEntries(Object.entries(configuration), [], new Map());
};

resolveMeta.parseEntries = parseEntries;

export { parseEntries };
export default resolveMeta;
