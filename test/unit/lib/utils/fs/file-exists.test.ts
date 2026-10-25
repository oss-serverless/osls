import path from 'node:path';
import fileExists from '../../../../../lib/utils/fs/file-exists.ts';

// Configure chai
import { expect } from 'chai';

describe('#fileExists()', () => {
  describe('When reading a file', () => {
    it('should detect if a file exists', () =>
      expect(fileExists(import.meta.filename)).to.eventually.equal(true));

    it("should detect if a file doesn't exist", () =>
      expect(fileExists(path.join(import.meta.dirname, 'XYZ.json'))).to.eventually.equal(false));
  });
});
