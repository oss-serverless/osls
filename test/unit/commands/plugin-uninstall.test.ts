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

const pluginName = 'serverless-plugin-1';
const spawnFake = sinon.fake();
const uninstallPlugin = proxyquire('../../../commands/plugin-uninstall', {
  '../lib/utils/spawn': spawnFake,
});

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

const setupPluginFixture = async () => {
  const fixture = await setupProgrammaticFixture('function', {
    configExt: {
      plugins: [pluginName],
    },
  });

  const serviceDir = fixture.servicePath;
  const configurationFilePath = await resolveConfigurationPath({
    cwd: serviceDir,
  });
  const configurationFilename = configurationFilePath.slice(serviceDir.length + 1);

  return {
    configuration: fixture.serviceConfig,
    serviceDir,
    configurationFilePath,
    configurationFilename,
  };
};

const uninstallFromPluginFixture = async () => {
  const fixture = await setupPluginFixture();

  await uninstallPlugin({
    configuration: fixture.configuration,
    serviceDir: fixture.serviceDir,
    configurationFilename: fixture.configurationFilename,
    options: { name: pluginName },
  });

  return fixture;
};

describe('test/unit/commands/plugin-uninstall.test.js', async () => {
  afterEach(() => {
    spawnFake.resetHistory();
  });

  it('should uninstall plugin', async () => {
    const { serviceDir } = await uninstallFromPluginFixture();

    expect(spawnFake.firstCall.args[1].slice(-4)).to.deep.equal([
      'uninstall',
      '--save-dev',
      '--',
      pluginName,
    ]);
    expect(spawnFake.firstCall.args[2]).to.deep.equal({
      cwd: serviceDir,
      stdio: 'pipe',
    });
  });

  it('should remove plugin from serverless file', async () => {
    const { configurationFilePath } = await uninstallFromPluginFixture();

    const serverlessFileObj = yaml.load(await fsp.readFile(configurationFilePath, 'utf8'), {
      filename: configurationFilePath,
    });
    expect(serverlessFileObj.plugins).to.be.undefined;
  });

  describe('with invalid plugin name', () => {
    it('rejects before uninstalling or updating the configuration file', async () => {
      const fixture = await setupProgrammaticFixture('function', {
        configExt: {
          plugins: [pluginName],
        },
      });

      const configuration = fixture.serviceConfig;
      const fixtureServiceDir = fixture.servicePath;
      const fixtureConfigurationPath = await resolveConfigurationPath({
        cwd: fixtureServiceDir,
      });
      const configurationFilename = fixtureConfigurationPath.slice(fixtureServiceDir.length + 1);
      const originalConfigurationText = await fsp.readFile(fixtureConfigurationPath, 'utf8');

      await expect(
        uninstallPlugin({
          configuration,
          serviceDir: fixtureServiceDir,
          configurationFilename,
          options: {
            name: '--prefix=/tmp/x',
          },
        })
      ).to.be.eventually.rejected.and.have.property('code', 'INVALID_PLUGIN_NAME');

      expect(spawnFake).to.not.have.been.called;
      expect(await fsp.readFile(fixtureConfigurationPath, 'utf8')).to.equal(
        originalConfigurationText
      );
    });
  });

  describe('with versioned package spec', () => {
    it('rejects before uninstalling or updating the configuration file', async () => {
      const fixture = await setupProgrammaticFixture('function', {
        configExt: {
          plugins: [pluginName],
        },
      });

      const configuration = fixture.serviceConfig;
      const fixtureServiceDir = fixture.servicePath;
      const fixtureConfigurationPath = await resolveConfigurationPath({
        cwd: fixtureServiceDir,
      });
      const configurationFilename = fixtureConfigurationPath.slice(fixtureServiceDir.length + 1);
      const originalConfigurationText = await fsp.readFile(fixtureConfigurationPath, 'utf8');

      await expect(
        uninstallPlugin({
          configuration,
          serviceDir: fixtureServiceDir,
          configurationFilename,
          options: {
            name: `${pluginName}@1.2.3`,
          },
        })
      ).to.be.eventually.rejected.and.have.property('code', 'INVALID_PLUGIN_UNINSTALL_SPEC');

      expect(spawnFake).to.not.have.been.called;
      expect(await fsp.readFile(fixtureConfigurationPath, 'utf8')).to.equal(
        originalConfigurationText
      );
    });
  });

  describe('with JSON configuration', () => {
    it('removes a plugin from array-form plugins', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const { configurationFilePath, configuration, configurationFilename } =
        await writeJsonConfiguration(fixture.servicePath, {
          service: 'json-service',
          plugins: ['existing-plugin', pluginName],
        });

      await uninstallPlugin({
        configuration,
        serviceDir: fixture.servicePath,
        configurationFilename,
        options: { name: pluginName },
      });

      expect(await fsp.readFile(configurationFilePath, 'utf8')).to.equal(
        '{"service":"json-service","plugins":["existing-plugin"]}\n'
      );
    });

    it('removes all duplicate plugin entries', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const { configurationFilePath, configuration, configurationFilename } =
        await writeJsonConfiguration(fixture.servicePath, {
          service: 'json-service',
          plugins: [pluginName, 'existing-plugin', pluginName],
        });

      await uninstallPlugin({
        configuration,
        serviceDir: fixture.servicePath,
        configurationFilename,
        options: { name: pluginName },
      });

      expect(JSON.parse(await fsp.readFile(configurationFilePath, 'utf8')).plugins).to.deep.equal([
        'existing-plugin',
      ]);
    });

    it('deletes an empty top-level plugins array', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const { configurationFilePath, configuration, configurationFilename } =
        await writeJsonConfiguration(fixture.servicePath, {
          service: 'json-service',
          plugins: [pluginName],
        });

      await uninstallPlugin({
        configuration,
        serviceDir: fixture.servicePath,
        configurationFilename,
        options: { name: pluginName },
      });

      expect(await fsp.readFile(configurationFilePath, 'utf8')).to.equal(
        '{"service":"json-service"}\n'
      );
    });

    it('deletes an empty object-form plugins.modules array', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const { configurationFilePath, configuration, configurationFilename } =
        await writeJsonConfiguration(fixture.servicePath, {
          service: 'json-service',
          plugins: { localPath: './plugins', modules: [pluginName] },
        });

      await uninstallPlugin({
        configuration,
        serviceDir: fixture.servicePath,
        configurationFilename,
        options: { name: pluginName },
      });

      expect(JSON.parse(await fsp.readFile(configurationFilePath, 'utf8'))).to.deep.equal({
        service: 'json-service',
        plugins: { localPath: './plugins' },
      });
    });

    it('includes the JSON filename in invalid JSON errors', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const { configurationFilePath, configuration, configurationFilename } =
        await writeJsonConfiguration(fixture.servicePath, { service: 'json-service' }, '{invalid');

      await expect(
        uninstallPlugin({
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
          plugins: [pluginName, 'existing-plugin'],
        });

      await uninstallPlugin({
        configuration,
        serviceDir: fixture.servicePath,
        configurationFilename,
        options: { name: pluginName },
      });

      expect(await fsp.readFile(configurationFilePath, 'utf8')).to.equal(
        '{"service":"json-service","plugins":["existing-plugin"]}\n'
      );
    });
  });

  describe('with intrinsic-tagged yaml', () => {
    it('preserves shorthand intrinsic tags when removing a plugin from array-form yaml', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const fixtureServiceDir = fixture.servicePath;
      const rawYaml = [
        'service: raw-plugin-yaml',
        'configValidationMode: error',
        "frameworkVersion: '*'",
        '',
        'plugins:',
        `  - ${pluginName}`,
        '',
        'custom:',
        '  pluginLogGroupArn: !GetAtt PluginLogGroup.Arn',
        '',
        'provider:',
        '  name: aws',
        '  runtime: nodejs20.x',
        '',
      ].join('\n');

      const { configurationFilePath: fixtureConfigurationPath, configuration } =
        await writeRawConfiguration(fixtureServiceDir, rawYaml);

      await uninstallPlugin({
        configuration,
        serviceDir: fixtureServiceDir,
        configurationFilename: path.basename(fixtureConfigurationPath),
        options: {
          name: pluginName,
        },
      });

      const fileText = await fsp.readFile(fixtureConfigurationPath, 'utf8');
      const parsed = await readParsedConfiguration(fixtureConfigurationPath);

      expect(fileText).to.include('pluginLogGroupArn: !GetAtt PluginLogGroup.Arn');
      expect(fileText).to.not.include(`- ${pluginName}`);
      expect(parsed.plugins).to.equal(undefined);
      expect(parsed.custom.pluginLogGroupArn).to.deep.equal({
        'Fn::GetAtt': ['PluginLogGroup', 'Arn'],
      });
    });

    it('preserves sibling shorthand tags when removing a plugin from object-form plugins.modules', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const fixtureServiceDir = fixture.servicePath;
      const rawYaml = [
        'service: raw-plugin-yaml',
        'configValidationMode: error',
        "frameworkVersion: '*'",
        '',
        'plugins:',
        '  localPath: ./.serverless_plugins',
        '  modules:',
        `    - ${pluginName}`,
        '',
        'custom:',
        '  taggedValue: !Sub ${AWS::Region}',
        '',
        'provider:',
        '  name: aws',
        '  runtime: nodejs20.x',
        '',
      ].join('\n');

      const { configurationFilePath: fixtureConfigurationPath, configuration } =
        await writeRawConfiguration(fixtureServiceDir, rawYaml);

      await uninstallPlugin({
        configuration,
        serviceDir: fixtureServiceDir,
        configurationFilename: path.basename(fixtureConfigurationPath),
        options: {
          name: pluginName,
        },
      });

      const fileText = await fsp.readFile(fixtureConfigurationPath, 'utf8');
      const parsed = await readParsedConfiguration(fixtureConfigurationPath);

      expect(fileText).to.include('taggedValue: !Sub ${AWS::Region}');
      expect(fileText).to.not.include(`- ${pluginName}`);
      expect(parsed.plugins.localPath).to.equal('./.serverless_plugins');
      expect(parsed.plugins.modules).to.equal(undefined);
      expect(parsed.custom.taggedValue).to.deep.equal({
        'Fn::Sub': '${AWS::Region}',
      });
    });

    it('preserves later plugins siblings when removing the last object-form plugin entry', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const fixtureServiceDir = fixture.servicePath;
      const rawYaml = [
        'service: raw-plugin-yaml',
        'configValidationMode: error',
        "frameworkVersion: '*'",
        '',
        'plugins:',
        '  modules:',
        `    - ${pluginName}`,
        '  localPath: ./.serverless_plugins',
        '',
        'custom:',
        '  taggedValue: !Sub ${AWS::Region}',
        '',
        'provider:',
        '  name: aws',
        '  runtime: nodejs20.x',
        '',
      ].join('\n');

      const { configurationFilePath: fixtureConfigurationPath, configuration } =
        await writeRawConfiguration(fixtureServiceDir, rawYaml);

      await uninstallPlugin({
        configuration,
        serviceDir: fixtureServiceDir,
        configurationFilename: path.basename(fixtureConfigurationPath),
        options: {
          name: pluginName,
        },
      });

      const fileText = await fsp.readFile(fixtureConfigurationPath, 'utf8');
      const parsed = await readParsedConfiguration(fixtureConfigurationPath);

      expect(fileText).to.include('localPath: ./.serverless_plugins');
      expect(fileText).to.include('taggedValue: !Sub ${AWS::Region}');
      expect(fileText).to.not.include(`- ${pluginName}`);
      expect(parsed.plugins.localPath).to.equal('./.serverless_plugins');
      expect(parsed.plugins.modules).to.equal(undefined);
      expect(parsed.custom.taggedValue).to.deep.equal({
        'Fn::Sub': '${AWS::Region}',
      });
    });

    it('removes plugins from a quoted top level plugins array without leaving a duplicate section', async () => {
      const fixture = await setupProgrammaticFixture('function');
      const fixtureServiceDir = fixture.servicePath;
      const rawYaml = [
        'service: raw-plugin-yaml',
        'configValidationMode: error',
        "frameworkVersion: '*'",
        '',
        '"plugins":',
        `  - ${pluginName}`,
        '',
        'custom:',
        '  taggedValue: !Sub ${AWS::Region}',
        '',
        'provider:',
        '  name: aws',
        '  runtime: nodejs20.x',
        '',
      ].join('\n');

      const { configurationFilePath: fixtureConfigurationPath, configuration } =
        await writeRawConfiguration(fixtureServiceDir, rawYaml);

      await uninstallPlugin({
        configuration,
        serviceDir: fixtureServiceDir,
        configurationFilename: path.basename(fixtureConfigurationPath),
        options: {
          name: pluginName,
        },
      });

      const fileText = await fsp.readFile(fixtureConfigurationPath, 'utf8');
      const parsed = await readParsedConfiguration(fixtureConfigurationPath);

      expect(fileText.match(/^(?:"plugins"|plugins):/gm)).to.equal(null);
      expect(parsed.plugins).to.equal(undefined);
      expect(parsed.custom.taggedValue).to.deep.equal({
        'Fn::Sub': '${AWS::Region}',
      });
    });
  });
});
