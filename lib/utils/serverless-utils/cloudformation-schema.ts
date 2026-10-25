'use strict';

const yaml = require('js-yaml');

const functionNames = [
  'And',
  'Base64',
  'Cidr',
  'Condition',
  'Equals',
  'FindInMap',
  'GetAtt',
  'GetAZs',
  'GetStackOutput',
  'If',
  'ImportValue',
  'Join',
  'Not',
  'Or',
  'Ref',
  'Select',
  'Split',
  'Sub',
  'Transform',
];

const yamlType = (name, kind) => {
  const functionName = ['Ref', 'Condition'].includes(name) ? name : `Fn::${name}`;
  return new yaml.Type(`!${name}`, {
    kind,
    construct: (data) => {
      if (name === 'GetAtt') {
        // special GetAtt dot syntax
        if (typeof data === 'string') {
          const [first, ...tail] = data.split('.');
          data = [first, tail.join('.')];
        }
      }
      return { [functionName]: data };
    },
  });
};

const createSchema = () => {
  const types = functionNames.flatMap((functionName) =>
    ['mapping', 'scalar', 'sequence'].map((kind) => yamlType(functionName, kind))
  );
  // Drop implicit timestamps so date-shaped plain scalars (e.g. an IAM policy
  // `Version: 2012-10-17`) stay strings; an explicit `!!timestamp` tag still constructs a Date
  const implicitTypes = yaml.DEFAULT_SCHEMA.implicit.filter(
    (type) => type.tag !== 'tag:yaml.org,2002:timestamp'
  );
  return new yaml.Schema({
    implicit: implicitTypes,
    explicit: [...yaml.DEFAULT_SCHEMA.explicit, yaml.types.timestamp],
  }).extend(types);
};

module.exports = createSchema();
