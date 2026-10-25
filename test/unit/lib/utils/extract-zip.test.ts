'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const yazl = require('yazl');
const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { extractZip, isZipBuffer } = require('../../../../lib/utils/extract-zip');
const { pathExists, remove } = require('../../../utils/fs');

const loadExtractZipWithFs = (fsStub) =>
  proxyquire.noCallThru().load('../../../../lib/utils/extract-zip', { fs: fsStub });

const createZipBuffer = (entries) =>
  new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks = [];

    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));

    for (const entry of entries) {
      const options = {
        ...(entry.mode == null ? {} : { mode: entry.mode }),
        ...(entry.mtime == null ? {} : { mtime: entry.mtime }),
      };

      if (entry.type === 'directory') {
        zip.addEmptyDirectory(entry.path, options);
      } else {
        zip.addBuffer(Buffer.from(entry.data || ''), entry.path, options);
      }
    }

    zip.end();
  });

const replaceZipEntryName = (zipBuffer, from, to) => {
  const source = Buffer.from(from);
  const target = Buffer.from(to);

  if (source.length !== target.length) {
    throw new Error('Replacement ZIP names must have equal byte length');
  }

  const result = Buffer.from(zipBuffer);
  let offset = 0;

  while ((offset = result.indexOf(source, offset)) !== -1) {
    target.copy(result, offset);
    offset += target.length;
  }

  return result;
};

const expectRejected = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
};

const getMode = async (filePath) => (await fsp.stat(filePath)).mode & 0o7777;

describe('extractZip', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extract-zip-'));
  });

  afterEach(async () => {
    await remove(tmpDir);
  });

  it('detects ZIP buffers', async () => {
    const zipBuffer = await createZipBuffer([{ path: 'file.txt', data: 'fixture' }]);

    expect(isZipBuffer(zipBuffer)).to.equal(true);
    expect(isZipBuffer(Buffer.from('not a zip'))).to.equal(false);
  });

  it('extracts from a buffer', async () => {
    const zipBuffer = await createZipBuffer([{ path: 'dir/file.txt', data: 'fixture' }]);

    const files = await extractZip(zipBuffer, tmpDir);

    expect(await fsp.readFile(path.join(tmpDir, 'dir', 'file.txt'), 'utf8')).to.equal('fixture');
    expect(files.map((file) => file.path)).to.deep.equal(['dir/file.txt']);
  });

  it('does not return buffered file data when output is provided', async () => {
    const zipBuffer = await createZipBuffer([{ path: 'file.txt', data: 'fixture' }]);

    const files = await extractZip(zipBuffer, tmpDir);

    expect(await fsp.readFile(path.join(tmpDir, 'file.txt'), 'utf8')).to.equal('fixture');
    expect(files[0]).to.include({ path: 'file.txt', type: 'file' });
    expect(files[0]).to.have.property('data', undefined);
  });

  it('extracts from a file path', async () => {
    const zipBuffer = await createZipBuffer([{ path: 'file.txt', data: 'fixture' }]);
    const zipPath = path.join(tmpDir, 'archive.zip');
    const outputPath = path.join(tmpDir, 'output');
    await fsp.writeFile(zipPath, zipBuffer);

    await extractZip(zipPath, outputPath);

    expect(await fsp.readFile(path.join(outputPath, 'file.txt'), 'utf8')).to.equal('fixture');
  });

  it('returns file data when output is null', async () => {
    const mtime = new Date('2024-01-02T03:04:00Z');
    const zipBuffer = await createZipBuffer([
      { path: 'dir/', type: 'directory', mtime },
      { path: 'dir/file.txt', data: 'fixture', mtime },
    ]);

    const files = await extractZip(zipBuffer, null);

    expect(files).to.have.length(2);
    expect(files[0]).to.include({ path: 'dir/', type: 'directory' });
    expect(files[1]).to.include({ path: 'dir/file.txt', type: 'file' });
    expect(files[1].data.toString()).to.equal('fixture');
  });

  it('strips safe leading path segments', async () => {
    const zipBuffer = await createZipBuffer([{ path: 'template-main/serverless.yml', data: 'x' }]);

    await extractZip(zipBuffer, tmpDir, { strip: 1 });

    expect(await fsp.readFile(path.join(tmpDir, 'serverless.yml'), 'utf8')).to.equal('x');
    expect(await pathExists(path.join(tmpDir, 'template-main'))).to.equal(false);
  });

  it('rejects traversal before strip can hide it', async () => {
    const zipBuffer = replaceZipEntryName(
      await createZipBuffer([{ path: 'xx/file.txt', data: 'x' }]),
      'xx/file.txt',
      '../file.txt'
    );

    await expectRejected(extractZip(zipBuffer, tmpDir, { strip: 1 }));
    expect(await pathExists(path.join(tmpDir, 'file.txt'))).to.equal(false);
  });

  it('allows safe in-root paths that start with two dots', async () => {
    const zipBuffer = await createZipBuffer([{ path: '..data/file.txt', data: 'safe' }]);

    await extractZip(zipBuffer, tmpDir);

    expect(await fsp.readFile(path.join(tmpDir, '..data', 'file.txt'), 'utf8')).to.equal('safe');
  });

  it('skips root-equivalent ./ directory entries without chmodding output root', async function () {
    if (process.platform === 'win32') this.skip();

    const originalMode = await getMode(tmpDir);
    const maliciousMtime = new Date('2000-01-01T00:00:00Z');
    const zipBuffer = replaceZipEntryName(
      await createZipBuffer([
        {
          path: 'x/',
          type: 'directory',
          mode: 0o42777,
          mtime: maliciousMtime,
        },
      ]),
      'x/',
      './'
    );

    const files = await extractZip(zipBuffer, tmpDir);
    const updatedStat = await fsp.stat(tmpDir);

    expect(files).to.deep.equal([]);
    expect(await getMode(tmpDir)).to.equal(originalMode);
    expect(Math.abs(updatedStat.mtime.getTime() - maliciousMtime.getTime())).to.be.greaterThan(
      2500
    );
  });

  it('skips root-equivalent nested dot directory entries', async () => {
    const zipBuffer = replaceZipEntryName(
      await createZipBuffer([{ path: 'x/y/', type: 'directory', mode: 0o42777 }]),
      'x/y/',
      '././'
    );

    const files = await extractZip(zipBuffer, tmpDir);

    expect(files).to.deep.equal([]);
  });

  it('does not apply stripped directory metadata to the output root', async function () {
    if (process.platform === 'win32') this.skip();

    const originalMode = await getMode(tmpDir);
    const zipBuffer = await createZipBuffer([
      { path: 'root/', type: 'directory', mode: 0o42777 },
      { path: 'root/file.txt', data: 'safe' },
    ]);

    await extractZip(zipBuffer, tmpDir, { strip: 1 });

    expect(await getMode(tmpDir)).to.equal(originalMode);
    expect(await fsp.readFile(path.join(tmpDir, 'file.txt'), 'utf8')).to.equal('safe');
  });

  it('filters entries without writing them', async () => {
    const zipBuffer = await createZipBuffer([
      { path: 'keep.txt', data: 'keep' },
      { path: 'skip.txt', data: 'skip' },
    ]);

    const files = await extractZip(zipBuffer, tmpDir, {
      filter: (file) => file.path !== 'skip.txt',
    });

    expect(files.map((file) => file.path)).to.deep.equal(['keep.txt']);
    expect(await pathExists(path.join(tmpDir, 'skip.txt'))).to.equal(false);
  });

  it('creates directory entries', async () => {
    const zipBuffer = await createZipBuffer([{ path: 'dir/', type: 'directory' }]);

    const files = await extractZip(zipBuffer, tmpDir);

    expect(files[0]).to.include({ path: 'dir/', type: 'directory' });
    expect((await fsp.stat(path.join(tmpDir, 'dir'))).isDirectory()).to.equal(true);
  });

  it('preserves executable file modes on non-Windows', async function () {
    if (process.platform === 'win32') this.skip();

    const zipBuffer = await createZipBuffer([{ path: 'bin', data: 'x', mode: 0o100755 }]);

    await extractZip(zipBuffer, tmpDir);

    expect((await fsp.stat(path.join(tmpDir, 'bin'))).mode & 0o777).to.equal(0o755);
  });

  it('preserves mtime with ZIP timestamp precision', async () => {
    const mtime = new Date('2024-01-02T03:04:00Z');
    const zipBuffer = await createZipBuffer([{ path: 'file.txt', data: 'x', mtime }]);

    await extractZip(zipBuffer, tmpDir);

    const stat = await fsp.stat(path.join(tmpDir, 'file.txt'));
    expect(Math.abs(stat.mtime.getTime() - mtime.getTime())).to.be.lessThan(2500);
  });

  it('overwrites existing regular files after successful extraction', async () => {
    await fsp.writeFile(path.join(tmpDir, 'file.txt'), 'original');
    const zipBuffer = await createZipBuffer([{ path: 'file.txt', data: 'changed' }]);

    await extractZip(zipBuffer, tmpDir);

    expect(await fsp.readFile(path.join(tmpDir, 'file.txt'), 'utf8')).to.equal('changed');
  });

  it('closes streamed temp file handles before renaming', async () => {
    const closeSpy = sinon.spy();
    let openedPath;
    const fsStub = {
      ...fs,
      promises: {
        ...fs.promises,
        async open(...args) {
          openedPath = args[0];
          const handle = await fs.promises.open(...args);
          return {
            chmod: (...chmodArgs) => handle.chmod(...chmodArgs),
            close: async () => {
              closeSpy();
              return handle.close();
            },
            utimes: (...utimesArgs) => handle.utimes(...utimesArgs),
            write: (...writeArgs) => handle.write(...writeArgs),
          };
        },
        async rename(...args) {
          expect(closeSpy.calledOnce).to.equal(true);
          return fs.promises.rename(...args);
        },
      },
    };
    const { extractZip: extractZipWithFsStub } = loadExtractZipWithFs(fsStub);
    const zipBuffer = await createZipBuffer([{ path: 'file.txt', data: 'fixture' }]);

    await extractZipWithFsStub(zipBuffer, tmpDir);

    expect(closeSpy.calledOnce).to.equal(true);
    expect(path.basename(openedPath)).to.match(/^\.sls-extract-[0-9a-f]{24}\.tmp$/);
    expect(await fsp.readFile(path.join(tmpDir, 'file.txt'), 'utf8')).to.equal('fixture');
  });

  it('removes temporary files and preserves existing targets when streaming fails', async () => {
    const writeError = new Error('write failed');
    const fsStub = {
      ...fs,
      promises: {
        ...fs.promises,
        async open(...args) {
          const handle = await fs.promises.open(...args);
          return {
            chmod: (...chmodArgs) => handle.chmod(...chmodArgs),
            close: () => handle.close(),
            utimes: (...utimesArgs) => handle.utimes(...utimesArgs),
            write: sinon.stub().rejects(writeError),
          };
        },
      },
    };
    const { extractZip: extractZipWithFsStub } = loadExtractZipWithFs(fsStub);
    const targetPath = path.join(tmpDir, 'file.txt');
    const zipBuffer = await createZipBuffer([{ path: 'file.txt', data: 'changed' }]);

    await fsp.writeFile(targetPath, 'original');

    const error = await expectRejected(extractZipWithFsStub(zipBuffer, tmpDir));

    expect(error).to.equal(writeError);
    expect(await fsp.readFile(targetPath, 'utf8')).to.equal('original');
    expect(await fsp.readdir(tmpDir)).to.deep.equal(['file.txt']);
  });

  it('uses temporary names independent of long target basenames', async function () {
    if (process.platform === 'win32') this.skip();

    const longName = `${'a'.repeat(240)}.txt`;
    const zipBuffer = await createZipBuffer([{ path: longName, data: 'fixture' }]);

    await extractZip(zipBuffer, tmpDir);

    expect(await fsp.readFile(path.join(tmpDir, longName), 'utf8')).to.equal('fixture');
  });

  it('removes temporary files and preserves existing targets when final rename fails', async () => {
    const renameError = new Error('rename failed');
    const targetPath = path.join(tmpDir, 'file.txt');
    const zipBuffer = await createZipBuffer([{ path: 'file.txt', data: 'changed' }]);
    const renameStub = sinon.stub(fsp, 'rename').rejects(renameError);

    await fsp.writeFile(targetPath, 'original');

    try {
      const error = await expectRejected(extractZip(zipBuffer, tmpDir));

      expect(error).to.equal(renameError);
      expect(await fsp.readFile(targetPath, 'utf8')).to.equal('original');
      expect(await fsp.readdir(tmpDir)).to.deep.equal(['file.txt']);
    } finally {
      renameStub.restore();
    }
  });

  it('rejects symlink entries', async () => {
    const zipBuffer = await createZipBuffer([{ path: 'link', data: 'target', mode: 0o120777 }]);

    const error = await expectRejected(extractZip(zipBuffer, tmpDir));

    expect(error.message).to.include('symlink');
  });

  for (const [description, replacement] of [
    ['parent directory traversal', '../file.txt'],
    ['absolute POSIX paths', '/x/file.txt'],
    ['Windows drive paths', 'C:/file.txt'],
    ['NUL bytes', 'x\0/file.txt'],
    ['backslash paths', 'xx\\file.txt'],
  ]) {
    it(`rejects ${description}`, async () => {
      const zipBuffer = replaceZipEntryName(
        await createZipBuffer([{ path: 'xx/file.txt', data: 'x' }]),
        'xx/file.txt',
        replacement
      );

      await expectRejected(extractZip(zipBuffer, tmpDir));
      expect(await pathExists(path.join(tmpDir, 'file.txt'))).to.equal(false);
    });
  }

  it('refuses to write through a pre-existing parent symlink', async function () {
    if (process.platform === 'win32') this.skip();

    const outsideDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extract-zip-outside-'));
    try {
      await fsp.symlink(outsideDir, path.join(tmpDir, 'link'), 'dir');
      const zipBuffer = await createZipBuffer([{ path: 'link/evil.txt', data: 'evil' }]);

      await expectRejected(extractZip(zipBuffer, tmpDir));
      expect(await pathExists(path.join(outsideDir, 'evil.txt'))).to.equal(false);
    } finally {
      await remove(outsideDir);
    }
  });

  it('refuses to extract into a symlink output directory', async function () {
    if (process.platform === 'win32') this.skip();

    const outsideDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extract-zip-output-'));
    const outputSymlink = path.join(tmpDir, 'output-link');
    try {
      await fsp.symlink(outsideDir, outputSymlink, 'dir');
      const zipBuffer = await createZipBuffer([{ path: 'evil.txt', data: 'evil' }]);

      const error = await expectRejected(extractZip(zipBuffer, outputSymlink));

      expect(error.message).to.include('Refusing to extract into symlink');
      expect(await pathExists(path.join(outsideDir, 'evil.txt'))).to.equal(false);
    } finally {
      await remove(outsideDir);
    }
  });

  it('refuses to overwrite a pre-existing final symlink', async function () {
    if (process.platform === 'win32') this.skip();

    const outsideDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'extract-zip-outside-'));
    const outsideFile = path.join(outsideDir, 'evil.txt');
    try {
      await fsp.writeFile(outsideFile, 'original');
      await fsp.symlink(outsideFile, path.join(tmpDir, 'evil.txt'));
      const zipBuffer = await createZipBuffer([{ path: 'evil.txt', data: 'changed' }]);

      await expectRejected(extractZip(zipBuffer, tmpDir));
      expect((await fsp.lstat(path.join(tmpDir, 'evil.txt'))).isSymbolicLink()).to.equal(true);
      expect(await fsp.readFile(outsideFile, 'utf8')).to.equal('original');
    } finally {
      await remove(outsideDir);
    }
  });
});
