import { promises as fsp } from 'node:fs';
import { writeText, log } from '../lib/utils/serverless-utils/log.ts';
import healthStatusFilename from '../lib/utils/health-status-filename.ts';

export default async () => {
  const healthStatus = await (async () => {
    try {
      return await fsp.readFile(healthStatusFilename);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  })();

  if (healthStatus) writeText(healthStatus);
  else log.notice('No deprecations were reported in the last command');
};
