'use strict';

const { expect } = require('chai');
const { overrideArgv } = require('../../../../utils/process');
const resolveInput = require('../../../../../lib/cli/resolve-input');
const resolveFinalCommandsSchema = require('../../../../../lib/cli/commands-schema/resolve-final');
const renderHelp = require('../../../../../lib/cli/render-help');
const observeOutput = require('../../../../lib/observe-output');

describe('test/unit/lib/cli/render-help/index.test.js', () => {
  class TestPlugin {
    constructor() {
      this.commands = {
        customCommand: {
          usage: 'Description of custom command',
          lifecycleEvents: ['run'],
          options: {
            pluginOption: {
              usage: 'Plugin option',
              type: 'string',
            },
          },
        },
      };
    }
  }

  afterEach(() => {
    resolveInput.clear();
  });

  it('should show general help on main command', async () => {
    resolveInput.clear();
    const output = await overrideArgv(
      {
        args: ['serverless', '--help'],
      },
      () => observeOutput(() => renderHelp(new Set()))
    );
    expect(output).to.have.string('Usage');
    expect(output).to.have.string('deploy function');
  });

  it('should show general help on help command', async () => {
    resolveInput.clear();
    const output = await overrideArgv(
      {
        args: ['serverless', 'help'],
      },
      () => observeOutput(() => renderHelp(new Set()))
    );
    expect(output).to.have.string('Usage');
    expect(output).to.have.string('deploy function');
  });

  it('should show specific command help with specific command', async () => {
    resolveInput.clear();
    const output = await overrideArgv(
      {
        args: ['serverless', 'deploy', '--help'],
      },
      () => {
        const { commandsSchema } = resolveInput();
        return {
          commandsSchema,
          observedOutput: observeOutput(() => renderHelp(new Set())),
        };
      }
    );
    expect(output.observedOutput).to.have.string('deploy');
    expect(output.observedOutput).to.have.string('deploy function');
    expect(output.observedOutput).to.have.string('--help');
    expect(output.observedOutput).to.have.string(output.commandsSchema.get('deploy').usage);
    expect(output.observedOutput).to.have.string(
      output.commandsSchema.get('deploy function').usage
    );
  });

  it('should include plugin commands in general help from explicit resolved input', async () => {
    const plugin = new TestPlugin();
    const loadedPlugins = new Set([plugin]);
    const commandsSchema = resolveFinalCommandsSchema(loadedPlugins, {
      providerName: 'aws',
      configuration: {},
    });

    const output = await observeOutput(() =>
      renderHelp(loadedPlugins, {
        command: '',
        commands: [],
        options: { help: true },
        commandSchema: commandsSchema.get(''),
        commandsSchema,
        isHelpRequest: true,
      })
    );

    expect(output).to.include('TestPlugin');
    expect(output).to.include('customCommand');
    expect(output).to.include('Description of custom command');
  });

  it('should render plugin command help from explicit resolved input', async () => {
    const plugin = new TestPlugin();
    const loadedPlugins = new Set([plugin]);
    const commandsSchema = resolveFinalCommandsSchema(loadedPlugins, {
      providerName: 'aws',
      configuration: {},
    });

    const output = await observeOutput(() =>
      renderHelp(loadedPlugins, {
        command: 'customCommand',
        commands: ['customCommand'],
        options: { help: true },
        commandSchema: commandsSchema.get('customCommand'),
        commandsSchema,
        isHelpRequest: true,
      })
    );

    expect(output).to.include('customCommand');
    expect(output).to.include('Description of custom command');
    expect(output).to.include('pluginOption');
  });
});
