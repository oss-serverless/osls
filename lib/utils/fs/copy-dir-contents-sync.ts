import fs from 'node:fs';
import copySync from './copy-sync.ts';

const isNotSymbolicLink = (src) => !fs.lstatSync(src).isSymbolicLink();

function copyDirContentsSync(srcDir, destDir, { noLinks = false } = {}) {
  const copySyncOptions = {
    dereference: true,
    filter: noLinks ? isNotSymbolicLink : undefined,
  };
  copySync(srcDir, destDir, copySyncOptions);
}

export default copyDirContentsSync;
