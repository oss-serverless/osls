import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fileExistsSync from '../utils/fs/file-exists-sync.ts';
import writeFileSync from '../utils/fs/write-file-sync.ts';
import copyDirContentsSync from '../utils/fs/copy-dir-contents-sync.ts';
import readFileSync from '../utils/fs/read-file-sync.ts';
import readFile from '../utils/fs/read-file.ts';
import walkDirSync from '../utils/fs/walk-dir-sync.ts';
import dirExistsSync from '../utils/fs/dir-exists-sync.ts';
import { packageJson as packageModule } from '../utils/package-root.ts';
const version = packageModule.version;

class Utils {
  constructor(serverless) {
    this.serverless = serverless;
  }

  getVersion() {
    return version;
  }

  dirExistsSync(dirPath) {
    return dirExistsSync(dirPath);
  }

  getTmpDirPath() {
    const dirPath = path.join(
      os.tmpdir(),
      'tmpdirs-serverless',
      crypto.randomBytes(12).toString('hex')
    );
    fs.mkdirSync(dirPath, { recursive: true });
    return dirPath;
  }

  fileExistsSync(filePath) {
    return fileExistsSync(filePath);
  }

  writeFileDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  writeFileSync(filePath, contents, cycles) {
    writeFileSync(filePath, contents, cycles);
  }

  async writeFile(filePath, contents, cycles) {
    this.writeFileSync(filePath, contents, cycles);
  }

  async appendFileSync(filePath, conts) {
    const contents = conts || '';
    fs.appendFileSync(filePath, contents);
  }

  readFileSync(filePath) {
    return readFileSync(filePath);
  }

  readFile(filePath) {
    return readFile(filePath);
  }

  walkDirSync(dirPath) {
    return walkDirSync(dirPath);
  }

  copyDirContentsSync(srcDir, destDir) {
    return copyDirContentsSync(srcDir, destDir);
  }

  generateShortId(length) {
    return Math.random().toString(36).substr(2, length);
  }

  isEventUsed(functions, eventName) {
    return Object.keys(functions).reduce((accum, key) => {
      const events = functions[key].events || [];
      if (events.length) {
        events.forEach((event) => {
          if (Object.keys(event)[0] === eventName) {
            accum = true;
          }
        });
      }
      return accum;
    }, false);
  }
}

export default Utils;
