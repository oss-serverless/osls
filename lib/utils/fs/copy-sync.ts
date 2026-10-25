'use strict';

const fs = require('fs');
const path = require('path');

const shouldCopy = (sourcePath, destinationPath, options) => {
  if (typeof options.filter !== 'function') return true;
  return options.filter(sourcePath, destinationPath);
};

const copyFileSync = (sourcePath, destinationPath, options) => {
  try {
    fs.copyFileSync(
      sourcePath,
      destinationPath,
      options.force === false ? fs.constants.COPYFILE_EXCL : 0
    );
  } catch (error) {
    if (options.force === false && error.code === 'EEXIST') return;
    throw error;
  }
};

const copyDereferencedSync = (sourcePath, destinationPath, options) => {
  if (!shouldCopy(sourcePath, destinationPath, options)) return;
  const stats = fs.statSync(sourcePath);
  if (stats.isDirectory()) {
    fs.mkdirSync(destinationPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyDereferencedSync(
        path.join(sourcePath, entry),
        path.join(destinationPath, entry),
        options
      );
    }
    return;
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath, options);
};

module.exports = (sourcePath, destinationPath, options = {}) => {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  if (options.dereference) {
    // Native fs.cpSync can preserve nested symlinks despite dereference on supported Node releases.
    copyDereferencedSync(sourcePath, destinationPath, options);
    return;
  }
  const copyOptions = {
    dereference: Boolean(options.dereference),
    force: options.force !== false,
    recursive: true,
  };
  if (typeof options.filter === 'function') copyOptions.filter = options.filter;
  fs.cpSync(sourcePath, destinationPath, copyOptions);
};
