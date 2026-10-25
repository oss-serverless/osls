'use strict';

const { stdoutColors, stderrColors } = require('../utils/colors');
const { log } = require('../utils/serverless-utils/log');
const renderHelp = require('../cli/render-help');

const legacyPluginLog = log.get('plugin-legacy');

const formatLegacyMessage = (message, opts) => {
  const { underline = false, bold = false, color = null } = opts || {};
  let text = String(message);

  if (color) {
    text = stderrColors.colorize(text, color);
  }
  if (underline) {
    text = stderrColors.underline(text);
  }
  if (bold) {
    text = stderrColors.bold(text);
  }

  return text;
};

class CLI {
  constructor(serverless) {
    this.serverless = serverless;
    this.loadedPlugins = [];
    this.loadedCommands = {};
  }

  setLoadedPlugins(plugins) {
    this.loadedPlugins = plugins;
  }

  setLoadedCommands(commands) {
    this.loadedCommands = commands;
  }

  displayHelp() {
    if (!this.serverless.processedInput.isHelpRequest) return false;
    renderHelp(this.serverless.pluginManager.externalPlugins, this.serverless.processedInput);
    return true;
  }

  printDot() {
    process.stdout.write(stdoutColors.yellow('.'));
  }

  log(message, entity, opts) {
    const formattedMessage = formatLegacyMessage(message, opts);

    legacyPluginLog.notice(entity ? `${entity}: ${formattedMessage}` : formattedMessage);
  }

  consoleLog(message) {
    process.stdout.write(`${message}\n`);
  }
}

module.exports = CLI;
