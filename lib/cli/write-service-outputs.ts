import { writeText, style } from '../utils/serverless-utils/log.ts';

export default (serviceOutputs) => {
  for (const [section, entries] of serviceOutputs) {
    if (typeof entries === 'string') {
      writeText(`${style.aside(`${section}:`)} ${entries}`);
    } else {
      writeText(`${style.aside(`${section}:\n`)}  ${entries.join('\n  ')}`);
    }
  }
};
