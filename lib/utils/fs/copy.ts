'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const shouldCopy = async (sourcePath, destinationPath, options) => {
  if (typeof options.filter !== 'function') return true;
  return options.filter(sourcePath, destinationPath);
};

const copyFile = async (sourcePath, destinationPath, options) => {
  try {
    await fsp.copyFile(
      sourcePath,
      destinationPath,
      options.force === false ? fs.constants.COPYFILE_EXCL : 0
    );
  } catch (error) {
    if (options.force === false && error.code === 'EEXIST') return;
    throw error;
  }
};

const copyDereferenced = async (sourcePath, destinationPath, options) => {
  if (!(await shouldCopy(sourcePath, destinationPath, options))) return;
  const stats = await fsp.stat(sourcePath);
  if (stats.isDirectory()) {
    await fsp.mkdir(destinationPath, { recursive: true });
    const entries = await fsp.readdir(sourcePath);
    await Promise.all(
      entries.map((entry) =>
        copyDereferenced(path.join(sourcePath, entry), path.join(destinationPath, entry), options)
      )
    );
    return;
  }
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath, options);
};

module.exports = async (sourcePath, destinationPath, options = {}) => {
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  if (options.dereference) {
    // Native fs.cp can preserve nested symlinks despite dereference on supported Node releases.
    await copyDereferenced(sourcePath, destinationPath, options);
    return;
  }
  const copyOptions = {
    dereference: Boolean(options.dereference),
    force: options.force !== false,
    recursive: true,
  };
  if (typeof options.filter === 'function') copyOptions.filter = options.filter;
  await fsp.cp(sourcePath, destinationPath, copyOptions);
};
