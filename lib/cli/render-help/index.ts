'use strict';

const resolveInput = require('../resolve-input');
const renderGeneralHelp = require('./general');
const renderCommandHelp = require('./command');

module.exports = (loadedPlugins, resolvedInput = resolveInput()) => {
  const { command } = resolvedInput;
  if (!command) {
    renderGeneralHelp(loadedPlugins, resolvedInput);
  } else if (command === 'help') {
    renderGeneralHelp(loadedPlugins, resolvedInput);
  } else {
    renderCommandHelp(command, resolvedInput);
  }
};
