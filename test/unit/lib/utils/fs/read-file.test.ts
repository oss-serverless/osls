import writeFile from '../../../../../lib/utils/fs/write-file.ts';
import readFile from '../../../../../lib/utils/fs/read-file.ts';
import { getTmpFilePath } from '../../../../utils/fs.ts';

// Configure chai
import { expect } from 'chai';

describe('#readFile()', () => {
  it('should read a file asynchronously', async () => {
    const tmpFilePath = getTmpFilePath('anything.json');

    return writeFile(tmpFilePath, { foo: 'bar' }).then(() =>
      expect(readFile(tmpFilePath)).to.eventually.deep.equal({ foo: 'bar' })
    );
  });

  it('should read a filename extension .yml', async () => {
    const tmpFilePath = getTmpFilePath('anything.yml');

    return writeFile(tmpFilePath, { foo: 'bar' }).then(() =>
      expect(readFile(tmpFilePath)).to.eventually.deep.equal({ foo: 'bar' })
    );
  });

  it('should read a filename extension .yaml', async () => {
    const tmpFilePath = getTmpFilePath('anything.yaml');

    return writeFile(tmpFilePath, { foo: 'bar' }).then(() =>
      expect(readFile(tmpFilePath)).to.eventually.deep.equal({ foo: 'bar' })
    );
  });

  it('should throw YAMLException with filename if yml file is invalid format', async () => {
    const tmpFilePath = getTmpFilePath('invalid.yml');
    return writeFile(tmpFilePath, ': a')
      .then(() => readFile(tmpFilePath))
      .catch((e) => {
        expect(e.name).to.equal('YAMLException');
        expect(e.message).to.match(new RegExp('.*invalid.yml'));
      });
  });
});
