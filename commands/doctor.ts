import { promises as fsp } from 'node:fs';
import log2 from '../lib/utils/serverless-utils/log.ts';
import healthStatusFilename from '../lib/utils/health-status-filename.ts';
const { writeText, log } = log2;

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
