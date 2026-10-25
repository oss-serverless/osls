import * as chai from 'chai';
import * as sinon from 'sinon';
import CLI from '../../../../lib/classes/cli.ts';
import Serverless from '../../../../lib/serverless.ts';
import esmock from 'esmock';

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
    it('applies legacy color and text formatting options', async () => {
      const notice = sinon.stub();
      const CLIWithStubbedWriters = (
        await esmock('../../../../lib/classes/cli.ts', {
          '../../../../lib/utils/colors.ts': {
            stdoutColors: {
              yellow: (text) => `[yellow]${text}[/yellow]`,
            },
            stderrColors: {
              bold: (text) => `<b>${text}</b>`,
              underline: (text) => `<u>${text}</u>`,
              colorize: (text, color) => `[${color}]${text}[/${color}]`,
            },
          },
          '../../../../lib/utils/serverless-utils/log.ts': {
            log: {
              get: sinon.stub().returns({ notice }),
            },
          },
          '../../../../lib/cli/resolve-input.ts': sinon.stub().returns({ isHelpRequest: false }),
          '../../../../lib/cli/render-help/index.ts': sinon.stub(),
        })
      ).default;

      const localCli = new CLIWithStubbedWriters(serverless);

      localCli.log('Message', 'entity', { color: 'green', underline: true, bold: true });

      expect(notice).to.have.been.calledOnceWithExactly(
        'entity: <b><u>[green]Message[/green]</u></b>'
      );
    });

    it('accepts null opts', async () => {
      const notice = sinon.stub();
      const CLIWithStubbedWriters = (
        await esmock('../../../../lib/classes/cli.ts', {
          '../../../../lib/utils/colors.ts': {
            stdoutColors: {
              yellow: (text) => text,
            },
            stderrColors: {
              bold: (text) => text,
              underline: (text) => text,
              colorize: (text) => text,
            },
          },
          '../../../../lib/utils/serverless-utils/log.ts': {
            log: {
              get: sinon.stub().returns({ notice }),
            },
          },
          '../../../../lib/cli/resolve-input.ts': sinon.stub().returns({ isHelpRequest: false }),
          '../../../../lib/cli/render-help/index.ts': sinon.stub(),
        })
      ).default;

      const localCli = new CLIWithStubbedWriters(serverless);

      expect(() => localCli.log('Message', 'entity', null)).not.to.throw();
      expect(notice).to.have.been.calledOnceWithExactly('entity: Message');
    });
  });
});
