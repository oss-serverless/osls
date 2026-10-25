'use strict';

const path = require('path');
const { outputFileSync } = require('./fs');

// mock to test functionality bound to a serverless plugin
class ServerlessPlugin {
  constructor(serverless, options, testSubject) {
    this.options = options;
    this.serverless = serverless;

    Object.assign(this, testSubject);
  }
}

function installPlugin(installDir, PluginClass) {
  const pluginPkg = { name: path.basename(installDir), version: '0.0.0' };
  const className = new PluginClass().constructor.name;
  outputFileSync(path.join(installDir, 'package.json'), JSON.stringify(pluginPkg), 'utf8');
  outputFileSync(
    path.join(installDir, 'index.js'),
    `"use strict";\n${PluginClass.toString()}\nmodule.exports = ${className}`,
    'utf8'
  );
}

module.exports = {
  ServerlessPlugin,
  installPlugin,
};
