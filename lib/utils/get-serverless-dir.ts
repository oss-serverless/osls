import path from 'node:path';
import os from 'node:os';

// get .serverless home path
function getServerlessDir() {
  return path.join(os.homedir(), '.serverless');
}

export default getServerlessDir;
