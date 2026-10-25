import fs from 'node:fs';
import EventEmitter from 'node:events';
import path from 'node:path';
import createZipFile from '../../../../../lib/utils/fs/create-zip-file.ts';
import { createTmpDir, createTmpFile, ensureDir, listZipFiles } from '../../../../utils/fs.ts';
// Configure chai
import { expect } from 'chai';

import esmock from 'esmock';

describe('#createZipFile()', () => {
  it('should create a zip file with the source directory content', async () => {
    const toZipFilePath = createTmpFile('foo.json');
    const zipFilePath = createTmpFile('package.zip');

    const srcDirPath = toZipFilePath.split(path.sep).slice(0, -1).join(path.sep);

    return createZipFile(srcDirPath, zipFilePath)
      .then(listZipFiles)
      .then((files) => expect(files).to.deep.equal(['foo.json']));
  });

  it('should preserve nested relative paths and ignore empty directories', async () => {
    const srcDirPath = createTmpDir();
    const zipFilePath = createTmpFile('nested-package.zip');
    const nestedFilePath = path.join(srcDirPath, 'nested', 'child', 'foo.json');

    await ensureDir(path.join(srcDirPath, 'empty-dir'));
    await ensureDir(path.dirname(nestedFilePath));
    await fs.promises.writeFile(nestedFilePath, '{"ok":true}');

    const files = await createZipFile(srcDirPath, zipFilePath).then(listZipFiles);

    expect(files).to.deep.equal(['nested/child/foo.json']);
  });

  it('should reject when the output stream errors', async () => {
    const output = new EventEmitter();
    let zipfile;

    class FakeZipFile extends EventEmitter {
      constructor() {
        super();
        this.outputStream = { pipe() {} };
        this.addFile = () => {};
        this.end = () => {};
        zipfile = this;
      }
    }

    const createZipFileProxy = (
      await esmock('../../../../../lib/utils/fs/create-zip-file.ts', {
        'node:fs': {
          createWriteStream: () => output,
          lstatSync: () => ({ isFile: () => true }),
        },
        'yazl': { ZipFile: FakeZipFile },
        '../../../../../lib/utils/fs/walk-dir-sync.ts': () => ['/tmp/source/foo.json'],
      })
    ).default;

    const promise = createZipFileProxy('/tmp/source', '/tmp/out.zip');
    output.emit('open');
    zipfile.emit('error', new Error('zip failed'));

    await expect(promise).to.be.rejectedWith('zip failed');
  });

  it('should reject when the writable stream errors', async () => {
    const output = new EventEmitter();

    class FakeZipFile extends EventEmitter {
      constructor() {
        super();
        this.outputStream = { pipe() {} };
        this.addFile = () => {};
        this.end = () => {};
      }
    }

    const createZipFileProxy = (
      await esmock('../../../../../lib/utils/fs/create-zip-file.ts', {
        'node:fs': {
          createWriteStream: () => output,
          lstatSync: () => ({ isFile: () => true }),
        },
        'yazl': { ZipFile: FakeZipFile },
        '../../../../../lib/utils/fs/walk-dir-sync.ts': () => ['/tmp/source/foo.json'],
      })
    ).default;

    const promise = createZipFileProxy('/tmp/source', '/tmp/out.zip');
    output.emit('error', new Error('write failed'));

    await expect(promise).to.be.rejectedWith('write failed');
  });
});
