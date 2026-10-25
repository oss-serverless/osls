'use strict';

const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const path = require('path');
const yauzl = require('yauzl');

const pathPosix = path.posix;

const zipSignatures = new Set([0x04034b50, 0x06054b50, 0x08074b50]);

const isZipBuffer = (buffer) => {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && zipSignatures.has(buffer.readUInt32LE(0));
};

const openZip = (input) => {
  return new Promise((resolve, reject) => {
    const callback = (error, zipfile) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(zipfile);
    };

    if (Buffer.isBuffer(input)) {
      yauzl.fromBuffer(input, { lazyEntries: true, strictFileNames: true }, callback);
      return;
    }

    yauzl.open(input, { lazyEntries: true, strictFileNames: true }, callback);
  });
};

const createUnsafeEntryError = (entryPath) =>
  new Error(`Unsafe ZIP entry path rejected: ${entryPath}`);

const assertSafeZipEntryPath = (entryPath) => {
  if (!entryPath || entryPath.includes('\0') || entryPath.includes('\\')) {
    throw createUnsafeEntryError(entryPath);
  }

  if (entryPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(entryPath)) {
    throw createUnsafeEntryError(entryPath);
  }

  const normalizedPath = pathPosix.normalize(entryPath);
  const normalizedWithoutTrailingSlash = normalizedPath.replace(/\/+$/, '');

  if (normalizedPath === '..' || normalizedPath.startsWith('../')) {
    throw createUnsafeEntryError(entryPath);
  }

  if (normalizedWithoutTrailingSlash === '.' || normalizedWithoutTrailingSlash === '') return '';

  return normalizedPath;
};

const getEntryUnixMode = (entry) => {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return unixMode || null;
};

const getEntryType = (entry) => {
  const mode = getEntryUnixMode(entry);
  const fileType = mode && mode & 0o170000;

  if (fileType === 0o120000) return 'symlink';
  if (fileType === 0o040000 || entry.fileName.endsWith('/')) return 'directory';
  return 'file';
};

const getEntryPermissions = (entry) => {
  const mode = getEntryUnixMode(entry);
  return mode ? mode & 0o7777 : undefined;
};

const getEntryMtime = (entry) => {
  const mtime = entry.getLastModDate && entry.getLastModDate();
  return mtime instanceof Date && !Number.isNaN(mtime.getTime()) ? mtime : undefined;
};

const normalizeEntryPath = (entryPath, strip = 0) => {
  const safePath = assertSafeZipEntryPath(entryPath);
  const strippedPath = safePath.split('/').slice(strip).join('/');

  if (!strippedPath) return null;
  return assertSafeZipEntryPath(strippedPath);
};

const assertInside = (rootPath, targetPath) => {
  const relativePath = path.relative(rootPath, targetPath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`ZIP entry resolved outside extraction target: ${targetPath}`);
  }
};

const assertNoSymlinkInPath = async (rootPath, targetPath) => {
  assertInside(rootPath, targetPath);

  const relativeParts = path.relative(rootPath, targetPath).split(path.sep).filter(Boolean);
  let currentPath = rootPath;

  for (const part of relativeParts) {
    currentPath = path.join(currentPath, part);

    try {
      const stats = await fsp.lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to extract through symlink: ${currentPath}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
};

const openEntryReadStream = (zipfile, entry) => {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stream);
    });
  });
};

const openTempFile = async (parentPath, mode) => {
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tempPath = path.join(
      parentPath,
      `.sls-extract-${crypto.randomBytes(12).toString('hex')}.tmp`
    );

    try {
      const handle = await fsp.open(tempPath, flags, mode);
      return { handle, path: tempPath };
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
  }

  throw new Error(`Could not create temporary ZIP extraction file in: ${parentPath}`);
};

const writeChunk = async (handle, chunk) => {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  let offset = 0;

  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset);

    if (bytesWritten === 0) {
      throw new Error('Failed to write ZIP entry chunk');
    }

    offset += bytesWritten;
  }
};

const getExistingRegularFileMode = async (targetPath) => {
  try {
    const stats = await fsp.stat(targetPath);
    return stats.isFile() ? stats.mode & 0o7777 : undefined;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
};

const writeEntrySafely = async ({ zipfile, entry, outputRoot, targetPath, mode, mtime }) => {
  const parentPath = path.dirname(targetPath);

  await assertNoSymlinkInPath(outputRoot, targetPath);
  await fsp.mkdir(parentPath, { recursive: true });
  await assertNoSymlinkInPath(outputRoot, targetPath);

  const modeToApply = mode == null ? await getExistingRegularFileMode(targetPath) : mode;
  const tempFile = await openTempFile(parentPath, modeToApply);
  let caughtError;
  let handleClosed = false;
  let renamed = false;

  const closeTempHandle = async () => {
    if (handleClosed) return;
    handleClosed = true;
    await tempFile.handle.close();
  };

  try {
    const readStream = await openEntryReadStream(zipfile, entry);

    for await (const chunk of readStream) {
      await writeChunk(tempFile.handle, chunk);
    }

    if (modeToApply != null) await tempFile.handle.chmod(modeToApply);
    if (mtime) await tempFile.handle.utimes(mtime, mtime);

    await closeTempHandle();

    await assertNoSymlinkInPath(outputRoot, targetPath);
    await fsp.rename(tempFile.path, targetPath);
    renamed = true;
  } catch (error) {
    caughtError = error;
  }

  try {
    await closeTempHandle();
  } catch (error) {
    if (!caughtError) caughtError = error;
  }

  if (!renamed) await fsp.unlink(tempFile.path).catch(() => {});

  if (caughtError) throw caughtError;
};

const applyDirectoryMetadata = async (outputRoot, directory) => {
  await assertNoSymlinkInPath(outputRoot, directory.path);

  const stats = await fsp.lstat(directory.path);
  if (!stats.isDirectory()) {
    throw new Error(`ZIP directory target is no longer a directory: ${directory.path}`);
  }

  if (directory.mode != null) await fsp.chmod(directory.path, directory.mode);
  if (directory.mtime) await fsp.utimes(directory.path, directory.mtime, directory.mtime);
};

const readEntry = async (zipfile, entry) => {
  const stream = await openEntryReadStream(zipfile, entry);

  return new Promise((resolve, reject) => {
    const chunks = [];

    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
};

const extractZip = async (input, output, options = {}) => {
  const extractedFiles = [];
  const directories = [];
  const outputRoot = output ? path.resolve(output) : null;

  if (outputRoot) {
    await fsp.mkdir(outputRoot, { recursive: true });
    if ((await fsp.lstat(outputRoot)).isSymbolicLink()) {
      throw new Error(`Refusing to extract into symlink: ${outputRoot}`);
    }
  }

  const zipfile = await openZip(input);

  try {
    await new Promise((resolve, reject) => {
      const fail = (error) => {
        reject(error);
      };

      zipfile.on('error', fail);
      zipfile.on('end', resolve);

      zipfile.on('entry', async (entry) => {
        try {
          const normalizedPath = normalizeEntryPath(entry.fileName, options.strip || 0);

          if (!normalizedPath) {
            zipfile.readEntry();
            return;
          }

          const entryType = getEntryType(entry);
          if (entryType === 'symlink') {
            throw new Error(`Refusing to extract ZIP symlink entry: ${entry.fileName}`);
          }

          const permissions = getEntryPermissions(entry);
          const mtime = getEntryMtime(entry);
          const isDirectory = entryType === 'directory';
          const file = {
            path:
              isDirectory && !normalizedPath.endsWith('/') ? `${normalizedPath}/` : normalizedPath,
            type: isDirectory ? 'directory' : 'file',
            mode: permissions,
            mtime,
          };

          if (options.filter && !options.filter(file)) {
            zipfile.readEntry();
            return;
          }

          if (isDirectory) {
            if (output) {
              const targetPath = path.join(outputRoot, normalizedPath);
              await assertNoSymlinkInPath(outputRoot, targetPath);
              await fsp.mkdir(targetPath, { recursive: true });
              await assertNoSymlinkInPath(outputRoot, targetPath);
              directories.push({ path: targetPath, mode: permissions, mtime });
            }
            extractedFiles.push(file);
            zipfile.readEntry();
            return;
          }

          if (output) {
            const targetPath = path.join(outputRoot, normalizedPath);
            await writeEntrySafely({
              zipfile,
              entry,
              outputRoot,
              targetPath,
              mode: permissions,
              mtime,
            });

            extractedFiles.push({ ...file, data: undefined });
          } else {
            const data = await readEntry(zipfile, entry);
            extractedFiles.push({ ...file, data });
          }

          zipfile.readEntry();
        } catch (error) {
          reject(error);
        }
      });

      zipfile.readEntry();
    });

    if (output) {
      await Promise.all(
        directories
          .sort((left, right) => right.path.length - left.path.length)
          .map((directory) => applyDirectoryMetadata(outputRoot, directory))
      );
    }
  } finally {
    zipfile.close();
  }

  return extractedFiles;
};

module.exports = {
  extractZip,
  isZipBuffer,
};
