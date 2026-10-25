import cliCommandsSchema from '../cli/commands-schema/index.ts';

class Logs {
  constructor(serverless) {
    this.serverless = serverless;

    this.commands = {
      logs: {
        ...cliCommandsSchema.get('logs'),
      },
    };
  }
}

export default Logs;
