import cliCommandsSchema from '../cli/commands-schema/index.ts';

class Info {
  constructor(serverless) {
    this.serverless = serverless;

    this.commands = {
      info: {
        ...cliCommandsSchema.get('info'),
      },
    };
  }
}

export default Info;
