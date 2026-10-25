'use strict';

const { writeText, style } = require('../../utils/serverless-utils/log');

module.exports = (commandOptions) => {
  const indentFillLength = 40;

  for (const [option, optionsObject] of Object.entries(commandOptions)) {
    let optionsIndentFill = ' '.repeat(Math.max(indentFillLength - option.length - 4, 0));

    if (optionsObject.required) {
      optionsIndentFill = optionsIndentFill.slice(0, optionsIndentFill.length - 18);
    } else {
      optionsIndentFill = optionsIndentFill.slice(0, optionsIndentFill.length - 7);
    }
    if (optionsObject.shortcut) {
      optionsIndentFill = optionsIndentFill.slice(0, optionsIndentFill.length - 5);
    }

    let shortcutInfo = '';
    let requiredInfo = '';
    if (optionsObject.shortcut) shortcutInfo = ` / -${optionsObject.shortcut}`;

    if (optionsObject.required) requiredInfo = ' (required)';

    const optionsUsage = optionsObject.usage
      ? optionsIndentFill + style.aside(optionsObject.usage)
      : '';
    writeText(`--${option}${shortcutInfo}${requiredInfo} ${optionsUsage}`);
  }
};
