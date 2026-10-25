import log2, { progress, style } from '../../../utils/serverless-utils/log.ts';
import writeServiceOutputs from '../../../cli/write-service-outputs.ts';
import validate from '../lib/validate.ts';
import getStackInfo from './get-stack-info.ts';
import getResourceCount from './get-resource-count.ts';
import getApiKeyValues from './get-api-key-values.ts';
import display from './display.ts';
const { log } = log2;

const mainProgress = progress.get('main');

class AwsInfo {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.provider = this.serverless.getProvider('aws');
    this.options = options || {};
    Object.assign(this, validate, getStackInfo, getResourceCount, getApiKeyValues, display);

    this.commands = {
      aws: {
        type: 'entrypoint',
        commands: {
          info: {
            lifecycleEvents: [
              'validate',
              'gatherData',
              'displayServiceInfo',
              'displayApiKeys',
              'displayEndpoints',
              'displayFunctions',
              'displayLayers',
              'displayStackOutputs',
            ],
          },
        },
      },
    };

    this.hooks = {
      'info:info': async () => this.serverless.pluginManager.spawn('aws:info'),
      'deploy:deploy': async () => this.serverless.pluginManager.spawn('aws:info'),
      'before:aws:info:validate': () => {
        const isDeployCommand = this.serverless.processedInput.commands.join(' ') === 'deploy';
        if (!isDeployCommand) return;
        mainProgress.notice('Retrieving CloudFormation stack', { isMainEvent: true });
      },
      'aws:info:validate': async () => this.validate(),
      'aws:info:gatherData': async () => {
        await this.getStackInfo();
        await this.getResourceCount();
        await this.getApiKeyValues();
      },
      'aws:info:displayServiceInfo': async () => this.displayServiceInfo(),
      'aws:info:displayApiKeys': async () => this.displayApiKeys(),
      'aws:info:displayEndpoints': async () => this.displayEndpoints(),
      'aws:info:displayFunctions': async () => this.displayFunctions(),
      'aws:info:displayLayers': async () => this.displayLayers(),
      'aws:info:displayStackOutputs': async () => this.displayStackOutputs(),
      'after:aws:info:gatherData': () => {
        if (this.gatheredData && this.gatheredData.info.resourceCount >= 450) {
          log.warning(
            `You have ${
              this.gatheredData.info.resourceCount
            } resources in your service. CloudFormation has a hard limit of 500 resources in a service. For advice on avoiding this limit, check out this link: ${style.link(
              'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-limits.html'
            )}.`
          );
        }
      },
      'finalize': () => {
        if (this.serverless.processedInput.commands.join(' ') !== 'info') return;
        writeServiceOutputs(this.serverless.serviceOutputs);
        writeServiceOutputs(this.serverless.servicePluginOutputs);
      },
    };
  }
}

export default AwsInfo;
