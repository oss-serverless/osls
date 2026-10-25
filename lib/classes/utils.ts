'use strict';

const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fileExistsSync = require('../utils/fs/file-exists-sync');
const writeFileSync = require('../utils/fs/write-file-sync');
const copyDirContentsSync = require('../utils/fs/copy-dir-contents-sync');
const readFileSync = require('../utils/fs/read-file-sync');
const readFile = require('../utils/fs/read-file');
const walkDirSync = require('../utils/fs/walk-dir-sync');
const dirExistsSync = require('../utils/fs/dir-exists-sync');
const version = require('../../package.json').version;

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

module.exports = Utils;
