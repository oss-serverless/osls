import fs from 'node:fs';

function fileExistsSync(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

export default fileExistsSync;
