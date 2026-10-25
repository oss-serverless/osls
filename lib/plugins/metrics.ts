import cliCommandsSchema from '../cli/commands-schema/index.ts';

class Metrics {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {
      metrics: {
        ...cliCommandsSchema.get('metrics'),
      },
    };
  }
}

export default Metrics;
