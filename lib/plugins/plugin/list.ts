import cliCommandsSchema from '../../cli/commands-schema/index.ts';
import pluginUtils from './lib/utils.ts';

class PluginList {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    Object.assign(this, pluginUtils);

    this.commands = {
      plugin: {
        commands: {
          list: {
            ...cliCommandsSchema.get('plugin list'),
          },
        },
      },
    };

    this.hooks = {
      'plugin:list:list': async () => this.list(),
    };
  }

  async list() {
    const plugins = await this.getPlugins();
    await this.display(plugins);
  }
}

export default PluginList;
