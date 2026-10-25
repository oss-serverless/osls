'use strict';

const globalOptions = require('./common-options/global');
const serviceOptions = require('./common-options/service');
const awsServiceOptions = require('./common-options/aws-service');

const commands = (module.exports = new Map());

commands.commonOptions = globalOptions;

commands.set('', {
  usage: 'Help',
  serviceDependencyMode: 'optional',
});

commands.set('config', {
  usage: 'Configure Serverless',
  options: {},
  lifecycleEvents: ['config'],
});

commands.set('config credentials', {
  usage: 'Configures a new provider profile for osls',
  hasAwsExtension: true,
  options: {
    provider: {
      usage: 'Name of the provider. Supported providers: aws',
      required: true,
      shortcut: 'p',
    },
    key: {
      usage: 'Access key for the provider',
      shortcut: 'k',
      required: true,
    },
    secret: {
      usage: 'Secret key for the provider',
      shortcut: 's',
      required: true,
    },
    profile: {
      usage: 'Name of the profile you wish to create. Defaults to "default"',
      shortcut: 'n',
    },
    overwrite: {
      usage: 'Overwrite the existing profile configuration in the credentials file',
      shortcut: 'o',
      type: 'boolean',
    },
  },
  lifecycleEvents: ['config'],
});

commands.set('create', {
  usage: 'Create new service',
  options: {
    'template-url': {
      usage:
        'Template URL for the service. Supports plain Git URLs plus GitHub, GitHub Enterprise, GitLab, Bitbucket, and Bitbucket Server.',
      shortcut: 'u',
    },
    'template-path': {
      usage: 'Template local path for the service.',
    },
    'path': {
      usage: 'The path where the service should be created (e.g. --path my-service)',
      shortcut: 'p',
    },
    'name': {
      usage:
        'Name for the service. Overwrites the default name of the created service and is used as the target directory when --path is omitted.',
      shortcut: 'n',
    },
  },
  lifecycleEvents: ['create'],
});

commands.set('doctor', {
  usage: 'Print status on reported deprecations triggered in the last command run',
});

commands.set('generate-event', {
  usage: 'Generate event',
  lifecycleEvents: ['generate-event'],
  options: {
    type: {
      usage:
        'Specify event type. "aws:apiGateway", "aws:sns", "aws:sqs", "aws:dynamo", ' +
        '"aws:kinesis", "aws:cloudWatchLog", "aws:s3", "aws:alexaSmartHome", "aws:alexaSkill", ' +
        '"aws:cloudWatch", "aws:iot", "aws:cognitoUserPool","aws:websocket" are supported.',
      shortcut: 't',
      required: true,
    },
    body: {
      usage: 'Specify the body for the message, request, or stream event.',
      shortcut: 'b',
    },
  },
});

commands.set('help', {
  usage: 'Show this help',
  serviceDependencyMode: 'optional',
});

commands.set('install', {
  usage: 'Install a service from a remote Git URL',
  options: {
    url: {
      usage: 'URL of the remote service. Supports plain Git URLs and supported code hosting URLs.',
      required: true,
      shortcut: 'u',
    },
    name: {
      usage: 'Name for the service. Also used as the target directory name.',
      shortcut: 'n',
    },
  },
  lifecycleEvents: ['install'],
});

commands.set('plugin list', {
  usage: 'Lists all available plugins',
  lifecycleEvents: ['list'],
});

commands.set('plugin search', {
  usage: 'Search for plugins',
  options: {
    query: {
      usage: 'Search query',
      required: true,
      shortcut: 'q',
    },
  },
  lifecycleEvents: ['search'],
});

for (const [name, schema] of commands) {
  if (!schema.options) schema.options = {};
  for (const optionSchema of Object.values(schema.options)) {
    if (!optionSchema.type) optionSchema.type = 'string';
  }
  if (schema.serviceDependencyMode) {
    Object.assign(schema.options, schema.hasAwsExtension ? awsServiceOptions : serviceOptions);
  } else {
    Object.assign(schema.options, globalOptions);
  }
  if (!name) {
    // Necessary tweaks for Interactive CLI help
    schema.options.help = { ...schema.options.help, usage: 'Show general help info' };
    schema.options.version = { ...schema.options.version, shortcut: 'v' };
  }
}
