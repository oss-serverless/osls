'use strict';

const fs = require('fs');
const copySync = require('./copy-sync');

const isNotSymbolicLink = (src) => !fs.lstatSync(src).isSymbolicLink();

function copyDirContentsSync(srcDir, destDir, { noLinks = false } = {}) {
  const copySyncOptions = {
    dereference: true,
    filter: noLinks ? isNotSymbolicLink : undefined,
  };
  copySync(srcDir, destDir, copySyncOptions);
}

module.exports = copyDirContentsSync;
