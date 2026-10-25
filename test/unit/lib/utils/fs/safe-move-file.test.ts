'use strict';

const sinon = require('sinon');
const proxyquire = require('proxyquire');
const provisionTempDir = require('../../../../lib/provision-tmp-dir');
const { join } = require('path');
const { expect } = require('chai');
const fsp = require('fs').promises;
const fs = require('fs');
const safeMoveFile = require('../../../../../lib/utils/fs/safe-move-file');
const { ensureFileSync, remove } = require('../../../../utils/fs');

/**
 * Returns and Error object that resembles the EXDEV errors that are thrown
 * when you try to rename across device boundaries.
 *
 * @returns an Error object that resembles the EXDEV errors are thrown
 */
const createFakeExDevError = () => {
  const fakeCrossDeviceError = new Error(
    "Error: EXDEV: cross-device link not permitted, rename '/foo/bar' -> '/bar/baz'"
  );
  // This is the important property that safeMoveFile looks for
  // to fallback to copy then rename behaviour
  fakeCrossDeviceError.code = 'EXDEV';

  // These other properties aren't used but it doesn't hurt to have an accurate error object
  fakeCrossDeviceError.errno = -18;
  fakeCrossDeviceError.syscall = 'rename';
  fakeCrossDeviceError.path = '/foo/bar';
  fakeCrossDeviceError.dest = '/bar/baz';
  return fakeCrossDeviceError;
};

const createFakeEpermError = () => {
  const error = new Error('EPERM: operation not permitted, rename');
  error.code = 'EPERM';
  return error;
};

/**
 * The name of the file that will be moved
 */
const artifactName = 'foo-bar.zip';

describe('test/unit/lib/utils/fs/safeMoveFile.test.js', () => {
  let sourceDir;
  let destinationDir;
  let sourceFile;
  let destinationFile;

  let renameStub;

  beforeEach(async () => {
    sourceDir = await provisionTempDir();
    destinationDir = await provisionTempDir();
    sourceFile = join(sourceDir, artifactName);
    destinationFile = join(destinationDir, artifactName);

    renameStub = sinon.stub(fsp, 'rename');
    // Allow the fs calls to act as normal until we want to force the rename to fail
    renameStub.callThrough();

    // Write a test file to rename
    await fsp.writeFile(sourceFile, 'source data');
  });

  afterEach(async () => {
    // Clean up test directories after each test so they don't interfere with each other
    await remove(destinationDir);
    await remove(sourceDir);
    // Reset stubbed methods
    fsp.rename.restore();
  });

  /**
   * Run the test suite with the provided post assertion function.
   * The post assertion function will be called after each test scenario is executed
   * so that the test scenarios can be reused.
   *
   * @param {*} postAssertion the function that is called after every test scenario
   */
  const runTestScenariosWithPostAssertion = (postAssertion) => {
    describe('when file at target path does not exist', () => {
      it('should move file to target destination', async () => {
        await safeMoveFile(sourceFile, destinationFile);

        const sourceExists = fs.existsSync(sourceFile);
        const destinationExists = fs.existsSync(destinationFile);

        expect(sourceExists).to.be.false;
        expect(destinationExists).to.be.true;

        postAssertion();
      });
    });

    describe('when file at target path already exists', () => {
      beforeEach(async () => {
        // Create an existing file that is at the destination
        ensureFileSync(destinationFile);
        fs.writeFileSync(destinationFile, 'existing destination data');
      });

      it('should overwrite the file at the target destination', async () => {
        await safeMoveFile(sourceFile, destinationFile);

        // Check that the file was actually overwritten
        const cachedData = fs.readFileSync(destinationFile).toString();
        expect(cachedData).not.to.eq('existing destination data');

        const sourceExists = await fs.existsSync(sourceFile);
        expect(sourceExists).to.be.false;

        postAssertion();
      });
    });
  };

  describe('when file is moved in context of same device', () => {
    runTestScenariosWithPostAssertion(() => {
      // Happy path: Only rename is called
      expect(renameStub).to.have.be.calledOnce;
    });
  });

  describe('when file is moved to different device', () => {
    beforeEach(async () => {
      const error = createFakeExDevError();
      renameStub.onFirstCall().rejects(error);
    });

    runTestScenariosWithPostAssertion(() => {
      // Rename is called twice because the first call will fail due to the cross device rename
      // The second call is across the same device
      expect(renameStub).to.have.been.calledTwice;
    });

    it('does not leave the temporary destination file after success', async () => {
      const error = createFakeExDevError();
      renameStub.onFirstCall().rejects(error);

      await safeMoveFile(sourceFile, destinationFile);

      const temporaryDestinationPath = renameStub.secondCall.args[0];
      expect(fs.existsSync(temporaryDestinationPath)).to.equal(false);
      expect(fs.existsSync(destinationFile)).to.equal(true);
    });
  });

  describe('when rename fails with a transient Windows EPERM lock', () => {
    let originalPlatformDescriptor;
    let sleepStub;
    let safeMoveFileWithStubbedSleep;

    const setPlatform = (platform) => {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: platform,
      });
    };

    const loadSafeMoveFileWithStubbedSleep = () => {
      safeMoveFileWithStubbedSleep = proxyquire('../../../../../lib/utils/fs/safe-move-file', {
        '../sleep': sleepStub,
      });
    };

    beforeEach(() => {
      originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      sleepStub = sinon.stub().resolves();
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
    });

    it('retries on Windows and succeeds once the lock clears', async () => {
      setPlatform('win32');
      loadSafeMoveFileWithStubbedSleep();
      renameStub.onFirstCall().rejects(createFakeEpermError());

      await safeMoveFileWithStubbedSleep(sourceFile, destinationFile);

      expect(renameStub).to.have.been.calledTwice;
      expect(sleepStub).to.have.been.calledOnceWithExactly(100);
      expect(fs.existsSync(sourceFile)).to.be.false;
      expect(fs.existsSync(destinationFile)).to.be.true;
    });

    it('rethrows the EPERM once the retries are exhausted', async () => {
      setPlatform('win32');
      loadSafeMoveFileWithStubbedSleep();
      renameStub.rejects(createFakeEpermError());

      await expect(safeMoveFileWithStubbedSleep(sourceFile, destinationFile)).to.be.rejectedWith(
        'EPERM'
      );

      expect(renameStub.callCount).to.equal(4);
      expect(sleepStub.args.map(([ms]) => ms)).to.deep.equal([100, 200, 400]);
    });

    it('does not retry EPERM on non-Windows platforms', async () => {
      setPlatform('linux');
      loadSafeMoveFileWithStubbedSleep();
      renameStub.rejects(createFakeEpermError());

      await expect(safeMoveFileWithStubbedSleep(sourceFile, destinationFile)).to.be.rejectedWith(
        'EPERM'
      );

      expect(renameStub).to.have.been.calledOnce;
      expect(sleepStub).to.have.not.been.called;
    });
  });
});
