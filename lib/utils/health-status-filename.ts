import path from 'node:path';
import os from 'node:os';
export default path.resolve(os.homedir(), '.serverless/last-command-health-status');
