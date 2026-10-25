'use strict';

const path = require('path');
const fsp = require('fs').promises;
const sinon = require('sinon');
const yaml = require('js-yaml');
const proxyquire = require('proxyquire');
const setupProgrammaticFixture = require('../../utils/setup-programmatic-fixture');
const resolveConfigurationPath = require('../../../lib/cli/resolve-configuration-path');
const cloudformationSchema = require('../../../lib/utils/serverless-utils/cloudformation-schema');
const { expect } = require('chai');

const writeRawConfiguration = async (serviceDir, rawYaml) => {
  const configurationFilePath = await resolveConfigurationPath({
    cwd: serviceDir,
  });
  await fsp.writeFile(configurationFilePath, rawYaml);
  return {
    configurationFilePath,
    configuration: yaml.load(rawYaml, {
      filename: configurationFilePath,
      schema: cloudformationSchema,
    }),
  };
};

const readParsedConfiguration = async (configurationFilePath) =>
  yaml.load(await fsp.readFile(configurationFilePath, 'utf8'), {
    filename: configurationFilePath,
    schema: cloudformationSchema,
  });

const writeJsonConfiguration = async (serviceDir, configuration, rawJson) => {
  const configurationFilePath = path.join(serviceDir, 'serverless.json');
  await fsp.writeFile(configurationFilePath, rawJson || JSON.stringify(configuration));
  return {
    configurationFilePath,
    configuration,
    configurationFilename: path.basename(configurationFilePath),
  };
};

describe('test/unit/commands/plugin-install.test.js', async () => {
  const spawnFake = sinon.fake();
  const installPlugin = proxyquire('../../../commands/plugin-install', {
    '../lib/utils/spawn': spawnFake,
  });
  const pluginName = 'serverless-plugin-1';

  const expectInstallSpawn = (serviceDir, packageSpec, { allowInstallScripts = false } = {}) => {
    const expectedArgs = [
      'install',
      '--save-dev',
      ...(allowInstallScripts ? [] : ['--ignore-scripts']),
      '--',
      packageSpec,
    ];

    expect(spawnFake.firstCall.args[1].slice(-expectedArgs.length)).to.deep.equal(expectedArgs);
    expect(spawnFake.firstCall.args[2]).to.deep.equal({
      cwd: serviceDir,
      stdio: 'pipe',
    });
  };

  afterEach(() => {
    spawnFake.resetHistory();
  });

  describe('without plugins in configuration', () => {
    let serviceDir;
    let configurationFilePath;
    before(async () => {
      const fixture = await setupProgrammaticFixture('function');
      const configuration = fixture.serviceConfig;
      serviceDir = fixture.servicePath;
      configurationFilePath = await resolveConfigurationPath({
        cwd: serviceDir,
      });
      const configurationFilename = configurationFilePath.slice(serviceDir.length + 1);
      const options = {
        name: pluginName,
      };

      await installPlugin({
        configuration,
        serviceDir,
        configurationFilename,
        options,
      });
    });

    it('should install plugin', () => {
      expectInstallSpawn(serviceDir, `${pluginName}@latest`);
    });

    it('should add plugin to serverless file', async () => {
      const serverlessFileObj = yaml.load(await fsp.readFile(configurationFilePath, 'utf8'), {
        filename: configurationFilePath,
      });
      expect(serverlessFileObj.plugins).to.include(pluginName);
    });
  });

  describe('with plugins in configuration', () => {
    it('should not add plugin to serverless file if it is already present in configuration but configured behind a variable', async () => {
      const fixture = await setupProgrammaticFixture('function', {
        configExt: {
          plugins: ['${self:custom.pluginName}'],
          custom: {
            pluginName,
          },
        },
      });

      const configuration = fixture.serviceConfig;

      // Simulate that the variable has been resolved
      configuration.plugins = [pluginName];
      const serviceDir = fixture.servicePath;
      const configurationFilePath = await resolveConfigurationPath({
        cwd: serviceDir,
      });
      const configurationFilename = configurationFilePath.slice(serviceDir.length + 1);
      const options = {
        name: pluginName,
      };

      await installPlugin({
        configuration,
        serviceDir,
        configurationFilename,
        options,
      });
      const serverlessFileObj = yaml.load(await fsp.readFile(configurationFilePath, 'utf8'), {
        filename: configurationFilePath,
      });
      expect(serverlessFileObj.plugins).not.to.include(pluginName);
    });
  });

  describe('with invalid plugin name', () => {
    it('rejects before installing or updating the configuration file', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const configuration = fixture.serviceConfig;
      const serviceDir = fixture.servicePath;
      const configurationFilePath = await resolveConfigurationPath({
        cwd: serviceDir,
      });
      const configurationFilename = configurationFilePath.slice(serviceDir.length + 1);
      const originalConfigurationText = await fsp.readFile(configurationFilePath, 'utf8');

      await expect(
        installPlugin({
          configuration,
          serviceDir,
          configurationFilename,
          options: {
            name: '--prefix=/tmp/x',
          },
        })
      ).to.be.eventually.rejected.and.have.property('code', 'INVALID_PLUGIN_NAME');

      expect(spawnFake).to.not.have.been.called;
      expect(await fsp.readFile(configurationFilePath, 'utf8')).to.equal(originalConfigurationText);
    });
  });

  describe('with invalid plugin version', () => {
    for (const inputName of [`${pluginName}@1.0.0;id`, `${pluginName}@"^1.60.0 || 2"`]) {
      it(`rejects ${JSON.stringify(inputName)} before installing`, async () => {
        const fixture = await setupProgrammaticFixture('function');
        const configuration = fixture.serviceConfig;
        const serviceDir = fixture.servicePath;
        const configurationFilePath = await resolveConfigurationPath({
          cwd: serviceDir,
        });
        const configurationFilename = configurationFilePath.slice(serviceDir.length + 1);
        const originalConfigurationText = await fsp.readFile(configurationFilePath, 'utf8');

        await expect(
          installPlugin({
            configuration,
            serviceDir,
            configurationFilename,
            options: {
              name: inputName,
            },
          })
        ).to.be.eventually.rejected.and.have.property('code', 'INVALID_PLUGIN_VERSION');

        expect(spawnFake).to.not.have.been.called;
        expect(await fsp.readFile(configurationFilePath, 'utf8')).to.equal(
          originalConfigurationText
        );
      });
    }
  });

  describe('with package specs that require argv boundaries', () => {
    for (const [inputName, expectedPackageSpec] of [
      ['@scope/serverless-plugin-1', '@scope/serverless-plugin-1@latest'],
      [`${pluginName}@^1.0.0 || 2`, `${pluginName}@^1.0.0 || 2`],
    ]) {
      it(`passes ${JSON.stringify(expectedPackageSpec)} as one npm argv element`, async () => {
        const fixture = await setupProgrammaticFixture('function');
        const configuration = fixture.serviceConfig;
        const serviceDir = fixture.servicePath;
        const configurationFilePath = await resolveConfigurationPath({
          cwd: serviceDir,
        });
        const configurationFilename = configurationFilePath.slice(serviceDir.length + 1);

        await installPlugin({
          configuration,
          serviceDir,
          configurationFilename,
          options: { name: inputName },
        });

        expectInstallSpawn(serviceDir, expectedPackageSpec);
        expect(spawnFake.firstCall.args[2]).to.not.have.property('shell');
      });
    }
  });

  describe('with install scripts explicitly allowed', () => {
    it('omits --ignore-scripts', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const configuration = fixture.serviceConfig;
      const serviceDir = fixture.servicePath;
      const configurationFilePath = await resolveConfigurationPath({
        cwd: serviceDir,
      });
      const configurationFilename = configurationFilePath.slice(serviceDir.length + 1);

      await installPlugin({
        configuration,
        serviceDir,
        configurationFilename,
        options: {
          'name': pluginName,
          'allow-install-scripts': true,
        },
      });

      expectInstallSpawn(serviceDir, `${pluginName}@latest`, { allowInstallScripts: true });
      expect(spawnFake.firstCall.args[1]).to.not.include('--ignore-scripts');
    });
  });

  describe('with JSON configuration', () => {
    it('adds a plugin to array-form plugins', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const { configurationFilePath, configuration, configurationFilename } =
        await writeJsonConfiguration(fixture.servicePath, {
          service: 'json-service',
          plugins: ['existing-plugin'],
        });

      await installPlugin({
        configuration,
        serviceDir: fixture.servicePath,
        configurationFilename,
        options: { name: pluginName },
      });

      expect(await fsp.readFile(configurationFilePath, 'utf8')).to.equal(
        `{"service":"json-service","plugins":["existing-plugin","${pluginName}"]}\n`
      );
    });

    it('adds a plugin to object-form plugins.modules', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const { configurationFilePath, configuration, configurationFilename } =
        await writeJsonConfiguration(fixture.servicePath, {
          service: 'json-service',
          plugins: { localPath: './plugins', modules: ['existing-plugin'] },
        });

      await installPlugin({
        configuration,
        serviceDir: fixture.servicePath,
        configurationFilename,
        options: { name: pluginName },
      });

      expect(
        JSON.parse(await fsp.readFile(configurationFilePath, 'utf8')).plugins.modules
      ).to.deep.equal(['existing-plugin', pluginName]);
    });

    it('strips a UTF-8 BOM from JSON input', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const configuration = { service: 'json-service', plugins: [] };
      const { configurationFilePath, configurationFilename } = await writeJsonConfiguration(
        fixture.servicePath,
        configuration,
        `\uFEFF${JSON.stringify(configuration)}`
      );

      await installPlugin({
        configuration,
        serviceDir: fixture.servicePath,
        configurationFilename,
        options: { name: pluginName },
      });

      expect(JSON.parse(await fsp.readFile(configurationFilePath, 'utf8')).plugins).to.deep.equal([
        pluginName,
      ]);
    });

    it('includes the JSON filename in invalid JSON errors', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const { configurationFilePath, configuration, configurationFilename } =
        await writeJsonConfiguration(fixture.servicePath, { service: 'json-service' }, '{invalid');

      await expect(
        installPlugin({
          configuration,
          serviceDir: fixture.servicePath,
          configurationFilename,
          options: { name: pluginName },
        })
      ).to.be.rejectedWith(configurationFilePath);
    });

    it('writes compact JSON with a final newline', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const { configurationFilePath, configuration, configurationFilename } =
        await writeJsonConfiguration(fixture.servicePath, {
          service: 'json-service',
          plugins: [],
        });

      await installPlugin({
        configuration,
        serviceDir: fixture.servicePath,
        configurationFilename,
        options: { name: pluginName },
      });

      expect(await fsp.readFile(configurationFilePath, 'utf8')).to.equal(
        `{"service":"json-service","plugins":["${pluginName}"]}\n`
      );
    });
  });

  describe('with intrinsic-tagged yaml', () => {
    it('preserves shorthand intrinsic tags when adding a plugin to array-form yaml', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const serviceDir = fixture.servicePath;
      const rawYaml = [
        'service: raw-plugin-yaml',
        'configValidationMode: error',
        "frameworkVersion: '*'",
        '',
        'custom:',
        '  pluginLogGroupArn: !Sub arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${self:service}-${sls:stage}:*',
        '',
        'provider:',
        '  name: aws',
        '  runtime: nodejs20.x',
        '',
        'functions:',
        '  basic:',
        '    handler: handler.hello',
        '',
      ].join('\n');

      const { configurationFilePath, configuration } = await writeRawConfiguration(
        serviceDir,
        rawYaml
      );

      await installPlugin({
        configuration,
        serviceDir,
        configurationFilename: path.basename(configurationFilePath),
        options: {
          name: pluginName,
        },
      });

      const fileText = await fsp.readFile(configurationFilePath, 'utf8');
      const parsed = await readParsedConfiguration(configurationFilePath);

      expect(fileText).to.include(
        'pluginLogGroupArn: !Sub arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${self:service}-${sls:stage}:*'
      );
      expect(fileText).to.include(`- ${pluginName}`);
      expect(parsed.plugins).to.include(pluginName);
      expect(parsed.custom.pluginLogGroupArn).to.deep.equal({
        'Fn::Sub':
          'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${self:service}-${sls:stage}:*',
      });
    });

    it('preserves sibling shorthand tags when adding a plugin to object-form plugins.modules', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const serviceDir = fixture.servicePath;
      const rawYaml = [
        'service: raw-plugin-yaml',
        'configValidationMode: error',
        "frameworkVersion: '*'",
        '',
        'plugins:',
        '  localPath: ./.serverless_plugins',
        '  modules:',
        '    - existing-plugin',
        '',
        'custom:',
        '  taggedValue: !Sub ${AWS::Region}',
        '',
        'provider:',
        '  name: aws',
        '  runtime: nodejs20.x',
        '',
      ].join('\n');

      const { configurationFilePath, configuration } = await writeRawConfiguration(
        serviceDir,
        rawYaml
      );

      await installPlugin({
        configuration,
        serviceDir,
        configurationFilename: path.basename(configurationFilePath),
        options: {
          name: pluginName,
        },
      });

      const fileText = await fsp.readFile(configurationFilePath, 'utf8');
      const parsed = await readParsedConfiguration(configurationFilePath);

      expect(fileText).to.include('taggedValue: !Sub ${AWS::Region}');
      expect(parsed.plugins.localPath).to.equal('./.serverless_plugins');
      expect(parsed.plugins.modules).to.deep.equal(['existing-plugin', pluginName]);
      expect(parsed.custom.taggedValue).to.deep.equal({
        'Fn::Sub': '${AWS::Region}',
      });
    });

    it('updates a quoted top level plugins array without duplicating the section', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const serviceDir = fixture.servicePath;
      const rawYaml = [
        'service: raw-plugin-yaml',
        'configValidationMode: error',
        "frameworkVersion: '*'",
        '',
        '"plugins":',
        '  - existing-plugin',
        '',
        'custom:',
        '  taggedValue: !Sub ${AWS::Region}',
        '',
        'provider:',
        '  name: aws',
        '  runtime: nodejs20.x',
        '',
      ].join('\n');

      const { configurationFilePath, configuration } = await writeRawConfiguration(
        serviceDir,
        rawYaml
      );

      await installPlugin({
        configuration,
        serviceDir,
        configurationFilename: path.basename(configurationFilePath),
        options: {
          name: pluginName,
        },
      });

      const fileText = await fsp.readFile(configurationFilePath, 'utf8');
      const parsed = await readParsedConfiguration(configurationFilePath);

      expect(fileText.match(/^(?:"plugins"|plugins):/gm)).to.have.length(1);
      expect(parsed.plugins).to.deep.equal(['existing-plugin', pluginName]);
      expect(parsed.custom.taggedValue).to.deep.equal({
        'Fn::Sub': '${AWS::Region}',
      });
    });
  });
});
