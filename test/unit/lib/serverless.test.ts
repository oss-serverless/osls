'use strict';

const chai = require('chai');

const { expect } = chai;

const Serverless = require('../../../lib/serverless');
const semver = require('semver');
const { version } = require('../../../package.json');

const YamlParser = require('../../../lib/classes/yaml-parser');
const PluginManager = require('../../../lib/classes/plugin-manager');
const Utils = require('../../../lib/classes/utils');
const Service = require('../../../lib/classes/service');
const ConfigSchemaHandler = require('../../../lib/classes/config-schema-handler');
const CLI = require('../../../lib/classes/cli');
const ServerlessError = require('../../../lib/serverless-error');
const runServerless = require('../../utils/run-serverless');
const spawn = require('../../../lib/utils/spawn');
const setupProgrammaticFixture = require('../../utils/setup-programmatic-fixture');
const path = require('path');
const yaml = require('js-yaml');

const getByPath = (source, pathSegments) => {
  let current = source;
  const segments = Array.isArray(pathSegments) ? pathSegments : pathSegments.split('.');

  for (const segment of segments) {
    if (current == null) return undefined;
    current = current[segment];
  }

  return current;
};

const setByPath = (source, pathSegments, value) => {
  let current = source;
  const segments = Array.isArray(pathSegments) ? pathSegments : pathSegments.split('.');

  segments.slice(0, -1).forEach((segment) => {
    if (typeof current[segment] !== 'object' || current[segment] === null) {
      current[segment] = {};
    }
    current = current[segment];
  });

  current[segments.at(-1)] = value;
  return source;
};

describe('Serverless', () => {
  let serverless;

  beforeEach(() => {
    serverless = new Serverless({ commands: ['print'], options: {}, serviceDir: null });
  });

  describe('#constructor()', () => {
    it('should set an empty providers object', () => {
      expect(serverless.providers).to.deep.equal({});
    });

    it('should set the osls version', () => {
      expect(serverless.version.length).to.be.at.least(1);
    });

    it('should set the YamlParser class instance', () => {
      expect(serverless.yamlParser).to.be.instanceof(YamlParser);
    });

    it('should set the PluginManager class instance', () => {
      expect(serverless.pluginManager).to.be.instanceof(PluginManager);
    });

    it('should set the Utils class instance', () => {
      expect(serverless.utils).to.be.instanceof(Utils);
    });

    it('should set the Service class instance', () => {
      expect(serverless.service).to.be.instanceof(Service);
    });

    it('should set the ConfigSchemaHandler class instance', () => {
      expect(serverless.configSchemaHandler).to.be.instanceof(ConfigSchemaHandler);
    });

    it('should have a config object', () => {
      expect(serverless.config).to.not.equal(undefined);
    });

    it('should have a classes object', () => {
      expect(serverless.classes).to.not.equal(undefined);
    });

    it('should store the CLI class inside the classes object', () => {
      expect(serverless.classes.CLI).to.deep.equal(CLI);
    });

    it('should store the YamlParser class inside the classes object', () => {
      expect(serverless.classes.YamlParser).to.deep.equal(YamlParser);
    });

    it('should store the PluginManager class inside the classes object', () => {
      expect(serverless.classes.PluginManager).to.deep.equal(PluginManager);
    });

    it('should store the Utils class inside the classes object', () => {
      expect(serverless.classes.Utils).to.deep.equal(Utils);
    });

    it('should store the Service class inside the classes object', () => {
      expect(serverless.classes.Service).to.deep.equal(Service);
    });

    it('should store the ConfigSchemaHandler class inside the classes object', () => {
      expect(serverless.classes.ConfigSchemaHandler).to.deep.equal(ConfigSchemaHandler);
    });

    it('should store the Error class inside the classes object', () => {
      expect(serverless.classes.Error).to.deep.equal(ServerlessError);
    });

    it('should reject invalid CLI stage', () => {
      expect(
        () =>
          new Serverless({
            commands: ['print'],
            options: { stage: 'foo/bar' },
            serviceDir: null,
          })
      )
        .to.throw(ServerlessError)
        .and.have.property('code', 'INVALID_STAGE');
    });

    it('should reject empty CLI stage', () => {
      expect(
        () =>
          new Serverless({
            commands: ['print'],
            options: { stage: '' },
            serviceDir: null,
          })
      )
        .to.throw(ServerlessError)
        .and.have.property('code', 'INVALID_STAGE');
    });
  });

  describe('#init()', () => {
    it('should set an instanceId', async () =>
      serverless.init().then(() => {
        expect(serverless.instanceId).to.match(/\d/);
      }));

    it('should create a new CLI instance', async () =>
      serverless.init().then(() => {
        expect(serverless.cli).to.be.instanceof(CLI);
      }));

    it('should allow a custom CLI instance', async () => {
      class CustomCLI extends CLI {}
      serverless.classes.CLI = CustomCLI;

      return serverless.init().then(() => {
        expect(serverless.cli).to.be.instanceof(CLI);
        expect(serverless.cli.constructor.name).to.equal('CustomCLI');
      });
    });

    // note: we just test that the processedInput variable is set (not the content of it)
    // the test for the correct input is done in the CLI class test file
    it('should receive the processed input form the CLI instance', async () =>
      serverless.init().then(() => {
        expect(serverless.processedInput).to.not.deep.equal({});
      }));
  });

  describe('#setProvider()', () => {
    class ProviderMock {}

    it('should set the provider object in the provider object', () => {
      const myProvider = new ProviderMock();

      serverless.setProvider('myProvider', myProvider);

      expect(serverless.providers.myProvider).to.equal(myProvider);
    });
  });

  describe('#getProvider()', () => {
    class ProviderMock {}
    let myProvider;

    beforeEach(() => {
      myProvider = new ProviderMock();
      serverless.setProvider('myProvider', myProvider);
    });

    it('should return the provider object', () => {
      const retrivedProvider = serverless.getProvider('myProvider');

      expect(retrivedProvider).to.deep.equal(myProvider);
    });
  });

  describe('#getVersion()', () => {
    it('should get the correct osls version', () => {
      expect(serverless.getVersion()).to.equal(version);
      expect(semver.valid(serverless.getVersion())).to.equal(serverless.getVersion());
    });
  });

  describe('compatibility aliases', () => {
    it('resolves @serverless/utils/config through require.main.require', () => {
      const config = require.main.require('@serverless/utils/config');
      const configJs = require.main.require('@serverless/utils/config.js');
      const vendoredConfig = require('../../../lib/utils/serverless-utils/config');

      expect(config).to.equal(vendoredConfig);
      expect(configJs).to.equal(vendoredConfig);
      expect(typeof config.get).to.equal('function');
      expect(typeof config.getConfig).to.equal('function');
    });

    it('resolves @serverless/utils/log through require.main.require', () => {
      const log = require.main.require('@serverless/utils/log');
      const logJs = require.main.require('@serverless/utils/log.js');
      const vendoredLog = require('../../../lib/utils/serverless-utils/log');

      expect(log).to.equal(vendoredLog);
      expect(logJs).to.equal(vendoredLog);
      expect(typeof log.log).to.equal('function');
      expect(typeof log.writeText).to.equal('function');
      expect(typeof log.progress.create).to.equal('function');
    });
  });
});

describe('test/unit/lib/serverless.test.js', () => {
  describe('Legacy API interface', () => {
    let serverless;

    before(async () => {
      ({ serverless } = await runServerless({
        fixture: 'aws',
        command: 'package',
      }));
    });

    it('Ensure that instance is setup', async () => {
      expect(serverless.variables).to.have.property('service');
    });

    it('Ensure config.servicePath', async () => {
      expect(serverless.config).to.have.property('servicePath');
    });
  });

  describe('Extend configuration', () => {
    const pluginConfig =
      require('../../fixtures/programmatic/plugin/extend-config-plugin').pluginConfig;

    const serverlessPath = path.resolve(__dirname, '../../../scripts/serverless.js');

    it('Extends configuration with given values', async () => {
      const customExt = { custom: {} };
      const configExt = {
        plugins: ['./extend-config-plugin/index.js'],
        provider: {
          stage: 'dev',
        },
        custom: {},
      };
      setByPath(customExt, pluginConfig.overwriteValuePath, 'test_value');

      const { servicePath: serviceDir } = await setupProgrammaticFixture('plugin', {
        configExt,
      });
      const serverlessProcess = await spawn('node', [serverlessPath, 'print'], {
        cwd: serviceDir,
      });
      const configuration = yaml.load(String(serverlessProcess.stdoutBuffer));

      const targetValue = getByPath(configuration, pluginConfig.targetValuePath);
      expect(targetValue, 'Target value should not be undefined').to.not.be.undefined;

      const afterInitValue = getByPath(configuration, pluginConfig.afterInitValuePath);
      expect(afterInitValue, 'afterInitValue should be undefined').to.be.undefined;

      const refValue = getByPath(configuration, pluginConfig.refValuePath);
      expect(refValue).to.deep.equal(targetValue, 'refValue should equal targetValue');

      const overwriteValue = getByPath(configuration, pluginConfig.overwriteValuePath);
      expect(overwriteValue).to.deep.equal(targetValue, 'overwriteValue should equal targetValue');
    });

    it('creates arrays for numeric path segments', () => {
      const extendableServerless = new Serverless({
        commands: ['print'],
        options: {},
        serviceDir: '/tmp/serverless-test',
        configurationFilename: 'serverless.yml',
        configuration: {
          service: 'service',
          provider: {
            name: 'aws',
          },
          functions: {
            foo: {},
          },
        },
      });

      extendableServerless.extendConfiguration(['functions', 'foo', 'events', '0'], {
        http: {
          path: '/',
          method: 'get',
        },
      });

      expect(extendableServerless.configurationInput.functions.foo.events).to.deep.equal([
        {
          http: {
            path: '/',
            method: 'get',
          },
        },
      ]);
    });

    it('ignores unsafe configuration extension paths', () => {
      const extendableServerless = new Serverless({
        commands: ['print'],
        options: {},
        serviceDir: '/tmp/serverless-test',
        configurationFilename: 'serverless.yml',
        configuration: {
          service: 'service',
          provider: {
            name: 'aws',
          },
          functions: {
            foo: {},
          },
        },
      });

      extendableServerless.extendConfiguration(['provider', '__proto__', 'polluted'], 'yes');
      extendableServerless.extendConfiguration(
        ['provider', 'constructor', 'prototype', 'polluted'],
        'yes'
      );

      expect({}.polluted).to.equal(undefined);
      expect(extendableServerless.configurationInput.provider).to.deep.equal({
        name: 'aws',
      });
    });
  });
});
