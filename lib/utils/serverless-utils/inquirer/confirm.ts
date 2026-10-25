'use strict';

const inquirer = require('./');

module.exports = async (message, options = {}) => {
  const name = options.name || 'isConfirmed';

  return (
    await inquirer.prompt({
      message,
      type: 'confirm',
      name,
    })
  )[name];
};
