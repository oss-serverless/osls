import logDeprecation from './log-deprecation.ts';
import { getByPath } from './object-path.ts';

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

export default (code, props, { serviceConfig } = {}) => {
  const msg = getMessage(props, serviceConfig);
  if (msg) {
    logDeprecation(code, msg, { serviceConfig });
  }
};
