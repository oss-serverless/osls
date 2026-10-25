import cliCommandsSchema from '../cli/commands-schema/index.ts';

class Remove {
  constructor(serverless) {
    this.serverless = serverless;

    this.commands = {
      remove: {
        ...cliCommandsSchema.get('remove'),
      },
    };
  }
}

export default Remove;
