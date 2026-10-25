import { expect } from 'chai';
import { overrideArgv } from '../../../utils/process.ts';
import ServerlessError from '../../../../lib/serverless-error.ts';
import logDeprecation from '../../../../lib/utils/log-deprecation.ts';
import ensureSupportedCommand from '../../../../lib/cli/ensure-supported-command.ts';
import resolveInput from '../../../../lib/cli/resolve-input.ts';
const { triggeredDeprecations } = logDeprecation;

describe('test/unit/lib/cli/ensure-supported-command.test.ts', () => {
  beforeEach(() => {
    triggeredDeprecations.clear();
    resolveInput.clear();
  });

  afterEach(() => {
    resolveInput.clear();
  });

  it('should do nothing on valid command', async () => {
    overrideArgv(
      {
        args: ['serverless', 'help'],
      },
      () => ensureSupportedCommand()
    );
  });

  it('should do nothing on container command', async () => {
    overrideArgv(
      {
        args: ['serverless', 'plugin'],
      },
      () => ensureSupportedCommand()
    );
  });

  it('should reject invalid command', async () => {
    overrideArgv(
      {
        args: ['serverless', 'hablo'],
      },
      () =>
        expect(() => ensureSupportedCommand())
          .to.throw(ServerlessError)
          .with.property('code', 'UNRECOGNIZED_CLI_COMMAND')
    );
  });

  it('should report invalid options', async () => {
    overrideArgv(
      {
        args: ['serverless', 'deploy', '--hadsfa'],
      },
      () =>
        expect(() => ensureSupportedCommand())
          .to.throw(ServerlessError)
          .with.property('code', 'UNSUPPORTED_CLI_OPTIONS')
    );
  });

  it('should reject missing options', async () => {
    overrideArgv(
      {
        args: ['serverless', 'config', 'credentials'],
      },
      () =>
        expect(() => ensureSupportedCommand())
          .to.throw(ServerlessError)
          .with.property('code', 'MISSING_REQUIRED_CLI_OPTION')
    );
  });

  it('should accept plugin command from explicit resolved input', () => {
    const commandsSchema = new Map();
    commandsSchema.commonOptions = {};
    commandsSchema.set('customCommand', {
      usage: 'Description of custom command',
      serviceDependencyMode: 'required',
      options: {},
    });

    const resolvedInput = {
      command: 'customCommand',
      commands: ['customCommand'],
      options: {},
      commandSchema: commandsSchema.get('customCommand'),
      commandsSchema,
    };

    expect(() => ensureSupportedCommand({}, resolvedInput)).to.not.throw();
  });

  it('should validate plugin command options from explicit resolved input', () => {
    const commandsSchema = new Map();
    commandsSchema.commonOptions = {};
    commandsSchema.set('customCommand', {
      usage: 'Description of custom command',
      options: {
        pluginOption: { type: 'string' },
      },
    });

    const resolvedInput = {
      command: 'customCommand',
      commands: ['customCommand'],
      options: { unsupported: true },
      commandSchema: commandsSchema.get('customCommand'),
      commandsSchema,
    };

    expect(() => ensureSupportedCommand({}, resolvedInput))
      .to.throw(ServerlessError)
      .with.property('code', 'UNSUPPORTED_CLI_OPTIONS');
  });
});
