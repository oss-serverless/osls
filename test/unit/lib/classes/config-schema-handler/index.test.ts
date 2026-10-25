'use strict';

const chai = require('chai');
const runServerless = require('../../../../utils/run-serverless');
const ConfigSchemaHandler = require('../../../../../lib/classes/config-schema-handler');

const { getConfigurationValidationResult } = ConfigSchemaHandler;

const expect = chai.expect;
const FUNCTION_NAME_PATTERN = '^[a-zA-Z0-9-_]+$';
const STAGE_NAME_PATTERN = require('../../../../../lib/utils/stage-pattern');

const createConfigSchemaHandler = (configurationInput) =>
  new ConfigSchemaHandler({
    configurationInput,
    service: { configValidationMode: 'error' },
  });

describe('test/unit/lib/classes/ConfigSchemaHandler/index.test.js', () => {
  describe('#constructor', () => {
    it('should freeze parts of schema for service', async () => {
      return runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      }).then((serverless) => {
        expect(() => {
          serverless.configSchemaHandler.schema.properties.service.name = 'changed';
        }).to.throw(Error);
      });
    });

    it('should freeze parts of schema for plugins', async () => {
      return runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      }).then((serverless) => {
        expect(() => {
          serverless.configSchemaHandler.schema.properties.plugins.properties = 'changed';
        }).to.throw(Error);
      });
    });

    it('should freeze parts of schema for resources', async () => {
      return runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      }).then((serverless) => {
        expect(() => {
          serverless.configSchemaHandler.schema.properties.resources.something = 'changed';
        }).to.throw(Error);
      });
    });

    it('should freeze parts of schema for package', async () => {
      return runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      }).then((serverless) => {
        expect(() => {
          serverless.configSchemaHandler.schema.properties.package.properties.oneMore = {
            type: 'string',
          };
        }).to.throw(Error);
      });
    });

    it('should freeze parts of schema for layers', async () => {
      return runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      }).then((serverless) => {
        expect(() => {
          serverless.configSchemaHandler.schema.properties.layers.properties = 'changed';
        }).to.throw(Error);
      });
    });
  });

  describe('#validateConfig', () => {
    it('should run without errors for valid config', async () => {
      const { serverless } = await runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      });
      expect(getConfigurationValidationResult(serverless.configurationInput)).to.be.true;
    });

    it('should reject an explicit function name containing CloudFormation substitution syntax', async () => {
      const userConfig = {
        service: 'service',
        frameworkVersion: '*',
        provider: { name: 'aws' },
        functions: { fn: { name: 'fn-${AWS::AccountId}' } },
      };

      await expect(
        createConfigSchemaHandler(userConfig).validateConfig(userConfig)
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      );
    });

    it('should accept explicit function names within the Lambda character set, including long ones', async () => {
      const userConfig = {
        service: 'service',
        frameworkVersion: '*',
        provider: { name: 'aws' },
        functions: {
          explicitName: { name: 'my-Function_1' },
          longGeneratedShape: { name: 'a'.repeat(68) },
        },
      };

      await expect(createConfigSchemaHandler(userConfig).validateConfig(userConfig)).to.eventually
        .be.fulfilled;
    });

    it('restores safe null paths and skips unsafe null paths without mutating prototypes', async () => {
      const userConfig = JSON.parse(
        '{"service":"service","frameworkVersion":"*","provider":{"name":"aws"},"custom":{"safe":{"keptNull":null},"__proto__":null,"constructor":{"prototype":{"blockedNull":null}}}}'
      );
      const configSchemaHandler = createConfigSchemaHandler(userConfig);

      await configSchemaHandler.validateConfig(userConfig);

      expect(userConfig.custom.safe.keptNull).to.equal(null);
      expect(Object.getPrototypeOf(userConfig.custom)).to.equal(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(userConfig.custom, '__proto__')).to.equal(false);
      expect(Object.prototype.hasOwnProperty.call(userConfig.custom, 'constructor')).to.equal(true);
      expect(userConfig.custom.constructor.prototype.blockedNull).to.equal(undefined);
      expect({}.blockedNull).to.equal(undefined);
    });

    it('resolves schema references through own definition keys named constructor', async () => {
      const userConfig = {
        service: 'service',
        frameworkVersion: '*',
        provider: { name: 'aws' },
        custom: { someConstructorBackedValue: 'ok' },
      };
      const configSchemaHandler = createConfigSchemaHandler(userConfig);
      const customProperties = configSchemaHandler.schema.properties.custom.properties;

      configSchemaHandler.schema.definitions.constructor = { type: 'string' };
      customProperties.someConstructorBackedValue = {
        $ref: '#/definitions/constructor',
      };

      await configSchemaHandler.validateConfig(userConfig);

      expect(customProperties.someConstructorBackedValue).to.deep.equal({ type: 'string' });
    });
  });

  describe('#defineFunctionEvent', () => {
    it('should extend schema with defineFunctionEvent method', async () => {
      return runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      }).then((serverless) => {
        const expectedPieceOfSchema = {
          type: 'object',
          properties: {
            someEvent: {
              type: 'object',
              properties: {
                someRequiredStringProp: { type: 'string' },
                someNumberProp: { type: 'number' },
              },
              required: ['someRequiredStringProp'],
              additionalProperties: false,
            },
          },
          required: ['someEvent'],
          additionalProperties: false,
        };

        expect(
          serverless.serverless.configSchemaHandler.schema.properties.functions.patternProperties[
            FUNCTION_NAME_PATTERN
          ].properties.events.items.anyOf.find(
            (definition) => definition.required[0] === 'someEvent'
          )
        ).to.deep.equal(expectedPieceOfSchema);
        return;
      });
    });

    it('should throw when defineFunctionEvent is used with an already defined event', async () => {
      await expect(
        runServerless({
          fixture: 'config-schema-extensions-error',
          command: 'info',
          configExt: {
            plugins: ['./test-plugin-with-colliding-function-event'],
          },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'SCHEMA_COLLISION');
    });
  });

  describe('#defineFunctionEventProperties', () => {
    it('should extend schema with defineFunctionEventProperties method', async () => {
      const serverless = await runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      });

      const existingEventDefinition =
        serverless.serverless.configSchemaHandler.schema.properties.functions.patternProperties[
          FUNCTION_NAME_PATTERN
        ].properties.events.items.anyOf.find(
          (definition) => definition.required[0] === 'existingEvent'
        ).properties.existingEvent;

      expect(existingEventDefinition.properties).to.have.deep.property(
        'somePluginAdditionalEventProp',
        {
          type: 'string',
        }
      );
      expect(existingEventDefinition.required).to.include('somePluginAdditionalEventProp');
    });

    it('should extend schema with defineFunctionEventProperties method on complex event schema', async () => {
      const serverless = await runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      });

      const existingEventDefinition =
        serverless.serverless.configSchemaHandler.schema.properties.functions.patternProperties[
          FUNCTION_NAME_PATTERN
        ].properties.events.items.anyOf.find(
          (definition) => definition.required[0] === 'existingComplexEvent'
        ).properties.existingComplexEvent;

      expect(existingEventDefinition).to.deep.equal({
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: {
              existingPropForObjectEventDefinition: { type: 'string' },
              somePluginAdditionalComplexEventProp: { type: 'string' },
            },
            required: ['somePluginAdditionalComplexEventProp'],
          },
        ],
      });
    });

    it('should throw when defineFunctionEventProperties is used on non existing event name', async () => {
      await expect(
        runServerless({
          fixture: 'config-schema-extensions-error',
          command: 'info',
          configExt: {
            plugins: ['./test-plugin-with-non-existing-event-error'],
          },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'UNRECOGNIZED_FUNCTION_EVENT_SCHEMA');
    });

    it('should throw when defineFunctionEventProperties is used on event without object definition', async () => {
      await expect(
        runServerless({
          fixture: 'config-schema-extensions-error',
          command: 'info',
          configExt: {
            plugins: ['./test-plugin-with-complex-event-without-object-definition'],
          },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'FUNCTION_EVENT_SCHEMA_NOT_OBJECT');
    });

    it('should throw when defineFunctionEventProperties is used with an already defined property', async () => {
      await expect(
        runServerless({
          fixture: 'config-schema-extensions-error',
          command: 'info',
          configExt: {
            plugins: ['./test-plugin-with-colliding-function-event-property'],
          },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'SCHEMA_COLLISION');
    });
  });

  describe('#defineFunctionProperties', () => {
    it('should extend schema with defineFunctionProperties method', async () => {
      return runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      }).then((serverless) => {
        const actualFunctionProperties =
          serverless.serverless.configSchemaHandler.schema.properties.functions.patternProperties[
            FUNCTION_NAME_PATTERN
          ].properties;

        expect(actualFunctionProperties).to.have.deep.property('someFunctionStringProp', {
          type: 'string',
        });

        expect(actualFunctionProperties).to.have.deep.property('someRequiredFunctionNumberProp', {
          type: 'number',
        });

        return;
      });
    });

    it('should throw when defineFunctionProperties is used with an already defined property', async () => {
      await expect(
        runServerless({
          fixture: 'config-schema-extensions-error',
          command: 'info',
          configExt: {
            plugins: ['./test-plugin-with-colliding-function-property'],
          },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'SCHEMA_COLLISION');
    });
  });

  describe('#defineCustomProperties', () => {
    it('should extend schema with defineCustomProperties method', async () => {
      return runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      }).then((serverless) => {
        const someCustomStringProp = {
          type: 'string',
        };
        expect(
          serverless.serverless.configSchemaHandler.schema.properties.custom.properties
            .someCustomStringProp
        ).to.deep.equal(someCustomStringProp);
        return;
      });
    });

    it('should throw when defineCustomProperties is used with an already defined property', async () => {
      await expect(
        runServerless({
          fixture: 'config-schema-extensions-error',
          command: 'info',
          configExt: {
            plugins: ['./test-plugin-with-colliding-custom-property'],
          },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'SCHEMA_COLLISION');
    });
  });

  describe('#defineTopLevelProperty', () => {
    it('should extend schema with defineTopLevelProperty method', async () => {
      return runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      }).then((serverless) => {
        const expectedAppPropSchema = {
          type: 'string',
        };
        expect(serverless.serverless.configSchemaHandler.schema.properties.top).to.deep.equal(
          expectedAppPropSchema
        );
        return;
      });
    });

    it('should throw when defineTopLevelProperty is used with an already defined property', async () => {
      await expect(
        runServerless({
          fixture: 'config-schema-extensions-error',
          command: 'info',
          configExt: {
            plugins: ['./test-plugin-with-colliding-top-level-property'],
          },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'SCHEMA_COLLISION');
    });
  });

  describe('#defineProvider', () => {
    it('should extend schema with defineProvider method', async () => {
      return runServerless({
        fixture: 'config-schema-extensions',
        command: 'info',
      }).then((serverless) => {
        const providerPieceOfSchema = {
          type: 'object',
          properties: {
            name: { const: 'someProvider' },
            stage: { type: 'string', pattern: STAGE_NAME_PATTERN },
          },
          required: ['name'],
          additionalProperties: false,
        };
        expect(serverless.serverless.configSchemaHandler.schema.properties.provider).to.deep.equal(
          providerPieceOfSchema
        );

        const expectedHandlerPieceOfSchema = { type: 'string' };
        expect(
          serverless.serverless.configSchemaHandler.schema.properties.functions.patternProperties[
            FUNCTION_NAME_PATTERN
          ].properties.handler
        ).to.deep.equal(expectedHandlerPieceOfSchema);
        return;
      });
    });

    it('should throw when defineProvider is used with an already defined property in provider', async () => {
      await expect(
        runServerless({
          fixture: 'config-schema-extensions-error',
          command: 'info',
          configExt: {
            plugins: ['./test-plugin-with-colliding-provider-property-in-provider'],
          },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'SCHEMA_COLLISION');
    });

    it('should throw when defineProvider is used with an already defined property in function', async () => {
      await expect(
        runServerless({
          fixture: 'config-schema-extensions-error',
          command: 'info',
          configExt: {
            plugins: ['./test-plugin-with-colliding-provider-property-in-function'],
          },
        })
      ).to.eventually.be.rejected.and.have.property('code', 'SCHEMA_COLLISION');
    });
  });
});
