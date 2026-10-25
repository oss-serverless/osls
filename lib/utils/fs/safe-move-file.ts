'use strict';

const fsp = require('fs').promises;
const crypto = require('crypto');
const path = require('path');
const { remove } = require('./remove');
const sleep = require('../sleep');

const RENAME_MAX_RETRIES = 3;
const RENAME_RETRY_BASE_DELAY_MS = 100;

// Windows can reject a valid rename with EPERM when the destination is briefly
// locked by another process (a concurrent reader or an antivirus scan). Such
// locks are transient, so retry with a short backoff before giving up.
const shouldRetryRename = (error) => process.platform === 'win32' && error.code === 'EPERM';

const renameWithRetry = async (oldPath, newPath) => {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(oldPath, newPath);
      return;
    } catch (error) {
      if (!shouldRetryRename(error) || attempt >= RENAME_MAX_RETRIES) {
        throw error;
      }

      await sleep(RENAME_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
};

/**
 * Given a path that designates a location of a file on another device, will
 * return a path to file in the same folder, but with a unique name to avoid
 * collisions.
 *
 * @param {*} destPath the path to the final location of the file being moved
 * @returns a unique path to a file on the same device as the file being moved
 */
const generateTemporaryPathOnDestinationDevice = (destPath) => {
  const dirName = path.dirname(destPath);
  // Generate a unique destination file name to get the file onto the
  // destination filesystem
  const tempName = path.basename(destPath) + crypto.randomBytes(12).toString('hex');
  return path.join(dirName, tempName);
};

/**
 * Allows a file to be moved (renamed) even across filesystem boundaries.
 *
 * If the rename fails because the file is getting renamed across file system
 * boundaries, the file is first copied to the destination file system under a
 * temporary name, and then renamed from there.
 *
 * This is done because rename is atomic but copy is not, and can leave
 * partially copied files.
 *
 * @param {*} oldPath the original file that should be moved
 * @param {*} newPath the path to move the file to
 */
async function safeMoveFile(oldPath, newPath) {
  try {
    await renameWithRetry(oldPath, newPath);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;

    const tempPath = generateTemporaryPathOnDestinationDevice(newPath);
    await fsp.copyFile(oldPath, tempPath);
    await renameWithRetry(tempPath, newPath);
    await remove(oldPath);
  }
}

module.exports = safeMoveFile;
