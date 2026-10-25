'use strict';

const chai = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const CLI = require('../../../../lib/classes/cli');
const Serverless = require('../../../../lib/serverless');

const { expect } = chai;

describe('CLI', () => {
  let cli;
  let serverless;

  beforeEach(() => {
    serverless = new Serverless({ commands: [], options: {} });
  });

  describe('#constructor()', () => {
    it('should set the serverless instance', () => {
      cli = new CLI(serverless);
      expect(cli.serverless).to.deep.equal(serverless);
    });

    it('should set an empty loadedPlugins array', () => {
      cli = new CLI(serverless);
      expect(cli.loadedPlugins.length).to.equal(0);
    });
  });

  describe('#setLoadedPlugins()', () => {
    it('should set the loadedPlugins array with the given plugin instances', () => {
      class PluginMock {}

      const pluginMock = new PluginMock();
      const plugins = [pluginMock];

      cli = new CLI(serverless);

      cli.setLoadedPlugins(plugins);

      expect(cli.loadedPlugins[0]).to.equal(pluginMock);
    });
  });

  describe('#log()', () => {
    it('applies legacy color and text formatting options', () => {
      const notice = sinon.stub();
      const CLIWithStubbedWriters = proxyquire.noCallThru().load('../../../../lib/classes/cli', {
        '../utils/colors': {
          stdoutColors: {
            yellow: (text) => `[yellow]${text}[/yellow]`,
          },
          stderrColors: {
            bold: (text) => `<b>${text}</b>`,
            underline: (text) => `<u>${text}</u>`,
            colorize: (text, color) => `[${color}]${text}[/${color}]`,
          },
        },
        '../utils/serverless-utils/log': {
          log: {
            get: sinon.stub().returns({ notice }),
          },
        },
        '../cli/resolve-input': sinon.stub().returns({ isHelpRequest: false }),
        '../cli/render-help': sinon.stub(),
      });

      const localCli = new CLIWithStubbedWriters(serverless);

      localCli.log('Message', 'entity', { color: 'green', underline: true, bold: true });

      expect(notice).to.have.been.calledOnceWithExactly(
        'entity: <b><u>[green]Message[/green]</u></b>'
      );
    });

    it('accepts null opts', () => {
      const notice = sinon.stub();
      const CLIWithStubbedWriters = proxyquire.noCallThru().load('../../../../lib/classes/cli', {
        '../utils/colors': {
          stdoutColors: {
            yellow: (text) => text,
          },
          stderrColors: {
            bold: (text) => text,
            underline: (text) => text,
            colorize: (text) => text,
          },
        },
        '../utils/serverless-utils/log': {
          log: {
            get: sinon.stub().returns({ notice }),
          },
        },
        '../cli/resolve-input': sinon.stub().returns({ isHelpRequest: false }),
        '../cli/render-help': sinon.stub(),
      });

      const localCli = new CLIWithStubbedWriters(serverless);

      expect(() => localCli.log('Message', 'entity', null)).not.to.throw();
      expect(notice).to.have.been.calledOnceWithExactly('entity: Message');
    });
  });
});
