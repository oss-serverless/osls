'use strict';

const functionNamePattern = '^[a-zA-Z0-9-_]+$';
const stagePattern = require('./utils/stage-pattern');

const schema = {
  type: 'object',
  properties: {
    /*
     * Modes for config validation:
     *  - error: the error is thrown
     *  - warn: logs error to console without throwing an error
     *  - off: disables validation at all
     *
     *  The default is `error`
     */
    configValidationMode: { enum: ['error', 'warn', 'off'] },
    custom: {
      type: 'object',
      properties: {},
      required: [],
      // User is free to add any properties for its own purpose
    },
    deprecationNotificationMode: {
      enum: ['error', 'warn', 'warn:summary'],
    },
    disabledDeprecations: {
      anyOf: [
        { const: '*' },
        {
          type: 'array',
          items: { $ref: '#/definitions/errorCode' },
        },
      ],
    },
    frameworkVersion: { type: 'string' },
    functions: {
      type: 'object',
      patternProperties: {
        [functionNamePattern]: {
          type: 'object',
          properties: {
            name: { type: 'string', pattern: functionNamePattern }, // name property is added by service class
            events: {
              type: 'array',
              items: {
                /*
                 * `anyOf` array by JSON schema spec cannot be empty, therefore we start
                 * with one dummy item as workaround to ensure it validates against
                 * any undefined function events.
                 */
                anyOf: [
                  {
                    type: 'object',
                    properties: { __schemaWorkaround__: { const: null } },
                    required: ['__schemaWorkaround__'],
                    additionalProperties: false,
                  },
                ],
              },
            },
          },

          /*
           * Schema for function properties is extended by a provider plugin.
           * For example, in the context of AWS provider props like
           * provisionedConcurrency, memorySize, reservedConcurrency, etc.
           * should be extended by awsProvider plugin.
           */
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    package: {
      type: 'object',
      properties: {
        artifact: { type: 'string' },
        excludeDevDependencies: { type: 'boolean' },
        individually: { type: 'boolean' },
        path: { type: 'string' },
        patterns: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    params: {
      type: 'object',
      patternProperties: {
        [stagePattern]: {
          type: 'object',
        },
      },
      additionalProperties: false,
    },
    plugins: {
      anyOf: [
        {
          type: 'object',
          properties: {
            localPath: { type: 'string' },
            modules: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
          required: ['modules'],
        },
        { type: 'array', items: { type: 'string' } },
      ],
    },
    projectDir: {
      type: 'string',
      pattern: '^(\\.\\/?|(\\.\\/)?\\.\\.(\\/\\.\\.)*\\/?)$',
    },
    /*
     * Provider specific properties are extended in respected provider plugins.
     */
    provider: {
      type: 'object',
      properties: {
        // "name" is configured as const by loaded provider
      },
      required: ['name'],
      additionalProperties: false,
    },
    service: { $ref: '#/definitions/serviceName' },
    useDotenv: { const: true },
    variablesResolutionMode: { type: 'string', enum: ['20210326'] },
  },
  additionalProperties: false,
  required: ['provider', 'service'],
  definitions: {
    errorCode: {
      type: 'string',
      pattern: '^[A-Z0-9_]+$',
    },
    functionName: {
      type: 'string',
      pattern: functionNamePattern,
    },
    serviceName: { type: 'string', pattern: '^[a-zA-Z][0-9a-zA-Z-]+$' },
    stage: { type: 'string', pattern: stagePattern },
  },
};

module.exports = schema;
