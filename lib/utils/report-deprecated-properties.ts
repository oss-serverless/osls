'use strict';

const logDeprecation = require('./log-deprecation');
const { getByPath } = require('./object-path');

const getMessage = (props, serviceConfig) => {
  const warnings = [];

  for (const [oldProp, newProp] of Object.entries(props)) {
    if (getByPath(serviceConfig, oldProp) != null) {
      warnings.push([oldProp, newProp]);
    }
  }

  if (warnings.length) {
    const what = warnings.length > 1 ? 'properties' : 'property';
    const details = warnings
      .map(([oldProp, newProp]) => `  "${oldProp}" -> "${newProp}"`)
      .join('\n');
    return `Starting with osls 5.0.0, following ${what} will no longer be supported:\n${details}`;
  }
  return null;
};

module.exports = (code, props, { serviceConfig } = {}) => {
  const msg = getMessage(props, serviceConfig);
  if (msg) {
    logDeprecation(code, msg, { serviceConfig });
  }
};
