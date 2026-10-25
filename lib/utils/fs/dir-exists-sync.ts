import fs from 'node:fs';

function dirExistsSync(dirPath) {
  try {
    const stats = fs.statSync(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export default dirExistsSync;
