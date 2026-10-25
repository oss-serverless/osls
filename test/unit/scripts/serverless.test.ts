'use strict';

const { expect } = require('chai');

const path = require('path');
const spawn = require('../../../lib/utils/spawn');
const { stripVTControlCharacters: stripAnsi } = require('node:util');
const { version } = require('../../../package');
const setupProgrammaticFixture = require('../../utils/setup-programmatic-fixture');

const serverlessPath = path.resolve(__dirname, '../../../scripts/serverless.js');
const programmaticFixturesPath = path.resolve(__dirname, '../../fixtures/programmatic');
const cliFixturesPath = path.resolve(__dirname, '../../fixtures/cli');

describe('test/unit/scripts/serverless.test.js', () => {
  it('should display version when "--version" option', async () => {
    const output = String((await spawn('node', [serverlessPath, '-v'])).stdoutBuffer);
    expect(output).to.include(`osls version: ${version}`);
  });

  it('should not prevent help output with invalid service configuration', async () => {
    const output = String(
      (
        await spawn('node', [serverlessPath, '--help'], {
          cwd: path.resolve(cliFixturesPath, 'config-syntax-error'),
        })
      ).stdoutBuffer
    );
    expect(output).to.include('serverless <command> <options>');
  });

  it('should report with an error invalid configuration', async () => {
    try {
      await spawn('node', [serverlessPath, 'print'], {
        cwd: path.resolve(cliFixturesPath, 'config-syntax-error'),
      });
      throw new Error('Unexpected');
    } catch (error) {
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('Cannot parse');
    }
  });

  it('should handle exceptions', async () => {
    try {
      await spawn('node', [serverlessPath, 'print'], {
        cwd: path.resolve(programmaticFixturesPath, 'exception'),
      });
      throw new Error('Unexpected');
    } catch (error) {
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('Error: Stop');
    }
  });

  it('should handle uncaught exceptions', async () => {
    try {
      await spawn('node', [serverlessPath, 'print'], {
        cwd: path.resolve(cliFixturesPath, 'uncaught-exception'),
      });
      throw new Error('Unexpected');
    } catch (error) {
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('Error: Stop');
    }
  });

  it('should handle no service related commands', async () => {
    const output = String(
      (
        await spawn('node', [serverlessPath, 'plugin', 'list'], {
          cwd: path.resolve(cliFixturesPath, 'config-syntax-error'),
        })
      ).stdoutBuffer
    );
    expect(output).to.include('Install a plugin by running');
  });

  it('should resolve variables', async () => {
    expect(
      String(
        (
          await spawn('node', [serverlessPath, 'print'], {
            cwd: path.resolve(cliFixturesPath, 'variables'),
          })
        ).stdoutBuffer
      )
    ).to.include('nestedInPrototype: bar-in-prototype');
  });

  it('should support multi service project', async () => {
    expect(
      String(
        (
          await spawn('node', [serverlessPath, 'print'], {
            cwd: path.resolve(programmaticFixturesPath, 'multi-service/service-a'),
          })
        ).stdoutBuffer
      )
    ).to.include('self: bar');
  });

  it('should support "-c" flag', async () => {
    expect(
      String(
        (
          await spawn('node', [serverlessPath, 'print', '-c', 'serverless.custom.yml'], {
            cwd: path.resolve(programmaticFixturesPath, 'custom-config-filename'),
          })
        ).stdoutBuffer
      )
    ).to.include('looks: good');
  });

  it('should reject invalid CLI stage', async () => {
    try {
      await spawn('node', [serverlessPath, 'print', '--stage', 'foo/../../tmp/x'], {
        cwd: path.resolve(programmaticFixturesPath, 'aws'),
      });
      throw new Error('Unexpected');
    } catch (error) {
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('Invalid stage name');
    }
  });

  it('should support "-c" flag for "aws-service" commands', async () => {
    try {
      await spawn('node', [serverlessPath, 'info', '-c', 'serverless.custom.yml'], {
        cwd: path.resolve(programmaticFixturesPath, 'custom-config-filename'),
      });
      throw new Error('Unexpected');
    } catch (error) {
      // The way to validate it is to check if command errors out with missing credentials
      // at this point we know the configuration was resolved properly
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('AWS provider credentials not found');
    }
  });

  it('should rejected unresolved "provider" section', async () => {
    try {
      await spawn('node', [serverlessPath, 'print'], {
        cwd: (
          await setupProgrammaticFixture('aws', {
            configExt: { provider: '${foo:bar}' },
          })
        ).servicePath,
      });
      throw new Error('Unexpected');
    } catch (error) {
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('"provider.stage" property is not accessible');
    }
  });

  it('should rejected unresolved "provider.stage" property', async () => {
    try {
      await spawn('node', [serverlessPath, 'print'], {
        cwd: (
          await setupProgrammaticFixture('aws', {
            configExt: { provider: { stage: '${foo:bar}' } },
          })
        ).servicePath,
      });
      throw new Error('Unexpected');
    } catch (error) {
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('"provider.stage" property is not accessible');
    }
  });

  it('should load env variables from dotenv files', async () => {
    const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
      configExt: {
        useDotenv: true,
        custom: {
          fromDefaultEnv: '${env:DEFAULT_ENV_VARIABLE}',
        },
      },
      files: [{ to: '.env', contents: 'DEFAULT_ENV_VARIABLE=valuefromdefault' }],
    });
    const printOut = String(
      (await spawn('node', [serverlessPath, 'print'], { cwd: serviceDir })).stdoutBuffer
    );
    expect(printOut).to.include('fromDefaultEnv: valuefromdefault');
    expect(printOut).to.not.match(/(?:injecting|injected) env \(\d+\) from \.env/);
  });

  it('should allow not defined environment variables in provider.stage`', async () => {
    const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
      configExt: {
        useDotenv: true,
        provider: {
          stage: "${env:FOO, 'dev'}",
        },
        custom: {
          fromDefaultEnv: '${env:DEFAULT_ENV_VARIABLE}',
        },
      },
      files: [{ to: '.env', contents: 'DEFAULT_ENV_VARIABLE=valuefromdefault' }],
    });
    const printOut = String(
      (await spawn('node', [serverlessPath, 'print'], { cwd: serviceDir })).stdoutBuffer
    );
    expect(printOut).to.include('fromDefaultEnv: valuefromdefault');
    expect(printOut).to.include('stage: dev');
  });

  it('should report "env" variables resolution conflicts with exception', async () => {
    const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
      configExt: {
        useDotenv: true,
        provider: {
          stage: "${env:FOO, 'dev'}",
        },
      },
      files: [{ to: '.env', contents: 'FOO=test' }],
    });
    try {
      await spawn('node', [serverlessPath, 'print'], { cwd: serviceDir });
      throw new Error('Unexpected');
    } catch (error) {
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('Environment variable "FOO" which');
    }
  });

  it('should support custom variable soruces', async () => {
    const { servicePath: serviceDir } = await setupProgrammaticFixture('plugin', {
      configExt: {
        custom: {
          otherVar: '${other:addressValue}',
        },
        plugins: ['./custom-variable-source'],
      },
    });
    expect(
      String((await spawn('node', [serverlessPath, 'print'], { cwd: serviceDir })).stdoutBuffer)
    ).to.include('otherVar: Resolving variable addressValue');
  });

  it('should reject unresolved "plugins" property', async () => {
    try {
      await spawn('node', [serverlessPath, 'print'], {
        cwd: (
          await setupProgrammaticFixture('aws', {
            configExt: { plugins: '${foo:bar}' },
          })
        ).servicePath,
      });
      throw new Error('Unexpected');
    } catch (error) {
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('"plugins" property is not accessible');
    }
  });

  it('should throw meaningful error on unrecognized command for custom provider', async () => {
    try {
      await spawn('node', [serverlessPath, 'foo'], {
        cwd: (await setupProgrammaticFixture('custom-provider')).servicePath,
      });
      throw new Error('Unexpected');
    } catch (error) {
      if (!error.code) throw error;
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('command "foo" not found');
    }
  });

  it('should show help when requested and in context of invalid service configuration', async () => {
    const output = String(
      (
        await spawn('node', [serverlessPath, '--help'], {
          cwd: path.resolve(programmaticFixturesPath, 'config-invalid'),
        })
      ).stdoutBuffer
    );
    expect(output).to.include('serverless <command> <options>');
  });

  it('should print general --help to stdout', async () => {
    const output = String((await spawn('node', [serverlessPath, '--help'])).stdoutBuffer);
    expect(output).to.include('serverless <command> <options>');
  });

  it('should print command --help to stdout', async () => {
    const output = String((await spawn('node', [serverlessPath, 'deploy', '--help'])).stdoutBuffer);
    expect(output).to.include('deploy');
    expect(output).to.include('stage');
  });

  it('should include plugin commands in service help output', async () => {
    const { servicePath: serviceDir } = await setupProgrammaticFixture('plugin');

    const output = stripAnsi(
      String(
        (
          await spawn('node', [serverlessPath, '--help'], {
            cwd: serviceDir,
          })
        ).stdoutBuffer
      )
    );

    expect(output).to.include('TestPlugin');
    expect(output).to.include('customCommand');
    expect(output).to.include('Description of custom command');
  });

  it('should print plugin command help to stdout', async () => {
    const { servicePath: serviceDir } = await setupProgrammaticFixture('plugin');

    const output = stripAnsi(
      String(
        (
          await spawn('node', [serverlessPath, 'customCommand', '--help'], {
            cwd: serviceDir,
          })
        ).stdoutBuffer
      )
    );

    expect(output).to.include('customCommand');
    expect(output).to.include('Description of custom command');
    expect(output).to.include('pluginOption');
  });

  it('should dispatch plugin command', async () => {
    const { servicePath: serviceDir } = await setupProgrammaticFixture('plugin');

    const output = stripAnsi(
      String(
        (
          await spawn('node', [serverlessPath, 'customCommand'], {
            cwd: serviceDir,
          })
        ).stdoutBuffer
      )
    );

    expect(output).to.include('customCommand invoked');
  });

  it('should parse plugin command options from final plugin schema', async () => {
    const { servicePath: serviceDir } = await setupProgrammaticFixture('plugin');

    const output = stripAnsi(
      String(
        (
          await spawn('node', [serverlessPath, 'customCommand', '--pluginOption', 'abc'], {
            cwd: serviceDir,
          })
        ).stdoutBuffer
      )
    );

    expect(output).to.include('customCommand invoked abc');
  });

  it('should print not integrated command --help to stdout', async () => {
    const output = String(
      (await spawn('node', [serverlessPath, 'plugin', 'install', '--help'])).stdoutBuffer
    );
    expect(output).to.include('plugin install');
    expect(output).to.include('stage');
  });

  it('should show help when running container command', async () => {
    // Note: Arbitrarily picked "plugin" command for testing
    const output = stripAnsi(
      String((await spawn('node', [serverlessPath, 'plugin'])).stdoutBuffer)
    );
    expect(output).to.include('plugin install');
  });

  it('should crash in required option is missing', async () => {
    try {
      await spawn('node', [serverlessPath, 'config', 'credentials', '-k', 'foo', '-s', 'bar']);
      throw new Error('Unexpected');
    } catch (error) {
      expect(error.code).to.equal(1);
      expect(String(error.stdoutBuffer)).to.include('command "config credentials" requires');
    }
  });

  describe('params of irrelevant stages', () => {
    const print = async (serviceDir, args = []) =>
      stripAnsi(
        String(
          (await spawn('node', [serverlessPath, 'print', ...args], { cwd: serviceDir }))
            .stdoutBuffer
        )
      );

    it('should not resolve params of other stages', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          params: {
            dev: { greeting: 'hello-dev' },
            prod: {
              fromUnknownSource: '${unknownSource:foo}',
              fromMissingEnv: '${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}',
            },
          },
          custom: { greeting: '${param:greeting}' },
        },
      });
      const output = await print(serviceDir);
      expect(output).to.include('greeting: hello-dev');
      // Values of other stages are left as-is
      expect(output).to.include('${unknownSource:foo}');
      expect(output).to.include('${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}');
    });

    it('should still resolve params of their own stage', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          params: {
            dev: { greeting: 'hello-dev' },
            prod: { fromMissingEnv: '${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}' },
          },
        },
      });
      try {
        await print(serviceDir, ['--stage', 'prod']);
        throw new Error('Unexpected');
      } catch (error) {
        expect(error.code).to.equal(1);
        expect(String(error.stdoutBuffer)).to.include('params.prod.fromMissingEnv');
      }
    });

    it('should resolve other stage params referenced with "self" variables', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          params: {
            prod: { domain: '${file(./prod-params.yml):domain}' },
          },
          custom: { prodDomain: '${self:params.prod.domain}' },
        },
        files: [{ to: 'prod-params.yml', contents: 'domain: prod.example.com' }],
      });
      expect(await print(serviceDir)).to.include('prodDomain: prod.example.com');
    });

    it('should resolve other stage sections configured with a single variable', async () => {
      // Such section cannot be left unresolved, as the configuration schema requires
      // "params.<stage>" to be an object
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          params: {
            dev: { greeting: 'hello-dev' },
            prod: '${file(./prod-params.yml)}',
          },
          custom: { greeting: '${param:greeting}' },
        },
        files: [{ to: 'prod-params.yml', contents: 'apiKey: real-prod-key' }],
      });
      const output = await print(serviceDir);
      expect(output).to.include('greeting: hello-dev');
      expect(output).to.include('apiKey: real-prod-key');
    });

    it('should not resolve params nested in other stage sections resolved from a single variable', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          params: {
            dev: { greeting: 'hello-dev' },
            prod: '${file(./prod-params.yml)}',
          },
          custom: { greeting: '${param:greeting}' },
        },
        files: [
          { to: 'prod-params.yml', contents: 'secret: ${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}' },
        ],
      });
      const output = await print(serviceDir);
      expect(output).to.include('greeting: hello-dev');
      expect(output).to.include('${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}');
    });

    it('should not resolve other stage params nested in a whole "params" section resolved from a single variable', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          params: '${file(./params.yml)}',
          custom: { greeting: '${param:greeting}' },
        },
        files: [
          {
            to: 'params.yml',
            contents: [
              'dev:',
              '  greeting: hello-dev',
              'prod:',
              '  secret: ${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}',
            ].join('\n'),
          },
        ],
      });
      const output = await print(serviceDir);
      expect(output).to.include('greeting: hello-dev');
      expect(output).to.include('${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}');
    });

    it('should not resolve siblings of referenced params of other stages', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          params: {
            prod: '${file(./prod-params.yml)}',
          },
          custom: { prodDomain: '${self:params.prod.domain}' },
        },
        files: [
          {
            to: 'prod-params.yml',
            contents: [
              'domain: prod.example.com',
              'secret: ${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}',
            ].join('\n'),
          },
        ],
      });
      const output = await print(serviceDir);
      expect(output).to.include('prodDomain: prod.example.com');
      expect(output).to.include('${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}');
    });

    it('should resolve "self" references nested in other stage params', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          params: {
            prod: '${file(./prod-params.yml)}',
          },
          custom: { prodApiKey: "${self:params.prod.apiKey, 'fallback-value'}" },
        },
        files: [{ to: 'prod-params.yml', contents: 'apiKey: real-prod-key' }],
      });
      const output = await print(serviceDir);
      expect(output).to.include('prodApiKey: real-prod-key');
      expect(output).to.not.include('fallback-value');
    });

    it('should resolve params of the effective stage when it is configured behind a variable', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          provider: { stage: "${opt:stage, 'prod'}" },
          params: {
            dev: { greeting: '${unknownSource:foo}' },
            prod: { greeting: '${file(./prod-params.yml):greeting}' },
          },
          custom: { greeting: '${param:greeting}' },
        },
        files: [{ to: 'prod-params.yml', contents: 'greeting: hello-prod' }],
      });
      expect(await print(serviceDir)).to.include('greeting: hello-prod');
    });

    it('should reject variable syntax errors in params of other stages', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          params: { prod: { bad: '${env:UNCLOSED' } },
        },
      });
      try {
        await print(serviceDir);
        throw new Error('Unexpected');
      } catch (error) {
        expect(error.code).to.equal(1);
        expect(String(error.stdoutBuffer)).to.include('params.prod.bad');
      }
    });

    it('should resolve effective stage from "provider.stage"', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          provider: { stage: 'prod' },
          params: {
            dev: { greeting: '${unknownSource:foo}' },
            prod: { greeting: 'hello-prod' },
          },
          custom: { greeting: '${param:greeting}' },
        },
      });
      expect(await print(serviceDir)).to.include('greeting: hello-prod');
    });

    it('should not resolve other stage params added by plugins', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          plugins: ['./extend-params-plugin'],
          params: { dev: { greeting: 'hello-dev' } },
          custom: { greeting: '${param:greeting}' },
        },
        files: [
          {
            to: 'extend-params-plugin.js',
            contents: [
              "'use strict';",
              'module.exports = class ExtendParamsPlugin {',
              '  constructor(serverless) { this.serverless = serverless; }',
              '  async asyncInit() {',
              "    this.serverless.extendConfiguration(['params', 'prod', 'fromPlugin'],",
              "      '${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}');",
              '  }',
              '};',
              '',
            ].join('\n'),
          },
        ],
      });
      const output = await print(serviceDir);
      expect(output).to.include('greeting: hello-dev');
      expect(output).to.include('${env:OSLS_TEST_SURELY_MISSING_ENV_VAR}');
    });

    it('should report syntax errors in other stage params resolved in the final phase', async () => {
      const { servicePath: serviceDir } = await setupProgrammaticFixture('aws', {
        configExt: {
          plugins: ['./source-plugin'],
          params: {
            dev: { greeting: 'hello-dev' },
            prod: '${sourceObject:}',
          },
          custom: { greeting: '${param:greeting}' },
        },
        files: [
          {
            to: 'source-plugin.js',
            contents: [
              "'use strict';",
              'module.exports = class SourcePlugin {',
              '  constructor() {',
              '    this.configurationVariablesSources = {',
              '      sourceObject: {',
              "        resolve: async () => ({ value: { bad: '${env:UNCLOSED' } }),",
              '      },',
              '    };',
              '  }',
              '};',
              '',
            ].join('\n'),
          },
        ],
      });
      try {
        await print(serviceDir);
        throw new Error('Unexpected');
      } catch (error) {
        expect(error.code).to.equal(1);
        expect(String(error.stdoutBuffer)).to.include('params.prod.bad');
      }
    });
  });
});
