'use strict';

const path = require('path');
const expect = require('chai').expect;
const fs = require('fs');
const skipOnDisabledSymlinksInWindows = require('../../../../lib/skip-on-disabled-symlinks-in-windows');
const fileExistsSync = require('../../../../../lib/utils/fs/file-exists-sync');

describe('#fileExistsSync()', () => {
  describe('When reading a file', () => {
    it('should detect if a file exists', () => {
      const file = fileExistsSync(__filename);
      expect(file).to.equal(true);
    });

    it("should detect if a file doesn't exist", () => {
      const noFile = fileExistsSync(path.join(__dirname, 'XYZ.json'));
      expect(noFile).to.equal(false);
    });
  });

  describe('When reading a symlink to a file', () => {
    it('should detect if the file exists', function () {
      try {
        fs.symlinkSync(__filename, 'sym');
      } catch (error) {
        skipOnDisabledSymlinksInWindows(error, this);
        throw error;
      }
      const found = fileExistsSync('sym');
      expect(found).to.equal(true);
      fs.unlinkSync('sym');
    });

    it("should detect if the file doesn't exist w/ bad symlink", function () {
      try {
        fs.symlinkSync('oops', 'invalid-sym');
      } catch (error) {
        skipOnDisabledSymlinksInWindows(error, this);
        throw error;
      }
      const found = fileExistsSync('invalid-sym');
      expect(found).to.equal(false);
      fs.unlinkSync('invalid-sym');
    });

    it("should detect if the file doesn't exist w/ symlink to dir", function () {
      try {
        fs.symlinkSync(__dirname, 'dir-sym');
      } catch (error) {
        skipOnDisabledSymlinksInWindows(error, this);
        throw error;
      }
      const found = fileExistsSync('dir-sym');
      expect(found).to.equal(false);
      fs.unlinkSync('dir-sym');
    });

    it("should detect if the file doesn't exist", () => {
      const found = fileExistsSync('bogus');
      expect(found).to.equal(false);
    });
  });
});
