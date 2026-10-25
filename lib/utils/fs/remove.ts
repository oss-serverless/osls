'use strict';

const fs = require('fs');

const remove = (targetPath) => fs.promises.rm(targetPath, { recursive: true, force: true });
const removeSync = (targetPath) => fs.rmSync(targetPath, { recursive: true, force: true });

module.exports = { remove, removeSync };
