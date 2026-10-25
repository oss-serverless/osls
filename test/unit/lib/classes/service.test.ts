'use strict';

const runServerless = require('../../../utils/run-serverless');
const { version } = require('../../../../package');
const Service = require('../../../../lib/classes/service');

// Configure chai
const expect = require('chai').expect;

describe('Service', () => {
  describe('#load()', () => {
    it('should reject when the service name is missing', () =>
      expect(
        runServerless({
          fixture: 'blank',
          command: 'print',
        })
      ).to.eventually.be.rejected.and.have.property('code', 'SERVICE_NAME_MISSING'));

    it('should reject if provider property is missing', () =>
      expect(
        runServerless({
          fixture: 'blank',
          configExt: { service: 'foo' },
          command: 'print',
        })
      ).to.eventually.be.rejected.and.have.property('code', 'PROVIDER_NAME_MISSING'));

    it('should reject old variables resolution mode even if validation is disabled', () =>
      expect(
        runServerless({
          fixture: 'aws',
          configExt: {
            configValidationMode: 'off',
            variablesResolutionMode: '20210219',
          },
          command: 'print',
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'VARIABLES_RESOLUTION_MODE_20210219_UNSUPPORTED'
      ));

    it('should reject removed console configuration', () =>
      expect(
        runServerless({
          fixture: 'aws',
          configExt: { console: true },
          command: 'print',
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      ));

    it('should reject if frameworkVersion is not satisfied', () =>
      expect(
        runServerless({
          fixture: 'aws',
          configExt: { frameworkVersion: '1.0' },
          command: 'print',
        })
      ).to.eventually.be.rejected.and.have.property('code', 'FRAMEWORK_VERSION_MISMATCH'));

    it('should pass if frameworkVersion is satisfied', async () =>
      runServerless({
        fixture: 'aws',
        configExt: { frameworkVersion: version },
        command: 'print',
      })
        .then(() =>
          runServerless({
            fixture: 'aws',
            configExt: { frameworkVersion: '*' },
            command: 'print',
          })
        )
        .then(() =>
          runServerless({
            fixture: 'aws',
            configExt: { frameworkVersion: version.split('.')[0] },
            command: 'print',
          })
        ));
  });

  describe('#mergeArrays', () => {
    it('should merge resources given as an array', async () =>
      runServerless({
        fixture: 'aws',
        configExt: {
          resources: [
            {
              Resources: {
                resource1: {
                  Type: 'value',
                },
              },
            },
            {
              Resources: {
                resource2: {
                  Type: 'value2',
                },
              },
            },
          ],
        },
        command: 'package',
      }).then(({ cfTemplate: { Resources } }) => {
        expect(Resources).to.be.an('object');
        expect(Resources.resource1).to.deep.equal({ Type: 'value' });
        expect(Resources.resource2).to.deep.equal({ Type: 'value2' });
      }));

    it('should merge functions given as an array', async () =>
      runServerless({
        fixture: 'aws',
        configExt: {
          functions: [
            {
              a: {},
            },
            {
              b: {},
            },
          ],
        },
        command: 'print',
      }).then(
        ({
          serverless: {
            service: { functions },
          },
        }) => {
          expect(functions).to.be.an('object');
          expect(functions.a).to.be.an('object');
          expect(functions.b).to.be.an('object');
        }
      ));

    it('should deeply merge overlapping resource fragments given as an array', async () =>
      runServerless({
        fixture: 'aws',
        configExt: {
          resources: [
            {
              Resources: {
                resource1: {
                  Type: 'value',
                  Properties: {
                    first: 'value-1',
                  },
                },
              },
            },
            {
              Resources: {
                resource1: {
                  Properties: {
                    second: 'value-2',
                  },
                },
              },
            },
          ],
        },
        command: 'package',
      }).then(({ cfTemplate: { Resources } }) => {
        expect(Resources.resource1).to.deep.equal({
          Type: 'value',
          Properties: {
            first: 'value-1',
            second: 'value-2',
          },
        });
      }));

    it('should reject non-plain resource fragments given as an array', () =>
      expect(
        runServerless({
          fixture: 'aws',
          configExt: {
            resources: [[]],
          },
          command: 'package',
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'LEGACY_CONFIGURATION_PROPERTY_MERGE_INVALID_INPUT'
      ));
  });

  describe('#setFunctionNames()', () => {
    it('should make sure function name contains the default stage', async () => {
      const { cfTemplate, awsNaming } = await runServerless({
        fixture: 'function',
        command: 'package',
      });
      expect(
        cfTemplate.Resources[awsNaming.getLambdaLogicalId('basic')].Properties.FunctionName
      ).to.include('dev-basic');
    });

    it('should throw when receives function with non-object configuration', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            functions: {
              bar: true,
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'NON_OBJECT_FUNCTION_CONFIGURATION_ERROR'
      );
    });

    it('should reject invalid short stage alias', async () => {
      const service = new Service({}, null);

      await expect(service.load({ s: 'foo/bar' })).to.be.eventually.rejected.and.have.property(
        'code',
        'INVALID_STAGE'
      );
    });

    it('should reject invalid provider stage before assigning function names', () => {
      const service = new Service(
        {},
        {
          service: 'test-service',
          provider: { stage: 'foo/bar' },
          functions: {
            hello: { handler: 'handler.hello' },
          },
        }
      );

      expect(() => service.setFunctionNames({}))
        .to.throw()
        .and.have.property('code', 'INVALID_STAGE');
    });
  });

  describe('#getFunction() / #getLayer()', () => {
    it('ignores inherited names unless explicitly defined as own properties', () => {
      const service = new Service({}, null);
      service.functions = {};
      service.layers = {};

      expect(() => service.getFunction('constructor'))
        .to.throw()
        .and.have.property('code', 'FUNCTION_MISSING_IN_SERVICE');
      expect(() => service.getLayer('constructor'))
        .to.throw()
        .and.have.property('code', 'LAYER_MISSING_IN_SERVICE');

      service.functions.constructor = { handler: 'handler.run' };
      service.layers.constructor = { path: 'layer' };

      expect(service.getFunction('constructor')).to.equal(service.functions.constructor);
      expect(service.getLayer('constructor')).to.equal(service.layers.constructor);
    });
  });
});
