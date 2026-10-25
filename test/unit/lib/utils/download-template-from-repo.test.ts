'use strict';

const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const os = require('os');
const proxyquire = require('proxyquire');
const chai = require('chai');
const ServerlessError = require('../../../../lib/serverless-error');

const { expect } = chai;
const { getTmpDirPath } = require('../../../utils/fs');

const writeFileSync = require('../../../../lib/utils/fs/write-file-sync');
const readFileSync = require('../../../../lib/utils/fs/read-file-sync');

const loadUntildifyWithHome = (homeDirectory) =>
  proxyquire('../../../../lib/utils/untildify', {
    os: {
      homedir: () => homeDirectory,
      userInfo: () => ({ username: 'test-user' }),
    },
  });

describe('downloadTemplateFromRepo', () => {
  let downloadTemplateFromRepo;
  let spawnStub;
  let downloadStub;
  let removeSyncStub;
  let cwd;

  let parseRepoURL;
  let fetchStub;
  let originalFetch;

  let serviceDir;
  let newServicePath;

  beforeEach(() => {
    const tmpDir = getTmpDirPath();
    cwd = process.cwd();

    fs.mkdirSync(tmpDir, { recursive: true });
    process.chdir(tmpDir);

    serviceDir = tmpDir;
    newServicePath = path.join(serviceDir, 'new-service-name');

    fetchStub = sinon.stub().resolves({
      json: () => ({
        displayName: 'Bitbucket',
      }),
    });

    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.indexOf('mybitbucket.server.ltd') > -1) {
        return fetchStub();
      }

      throw Error('unknown server type');
    };

    spawnStub = sinon.stub().resolves();
    downloadStub = sinon.stub().resolves();
    removeSyncStub = sinon
      .stub()
      .callsFake((targetPath) => fs.rmSync(targetPath, { recursive: true, force: true }));

    const downloadTemplateFromRepoModule = proxyquire(
      '../../../../lib/utils/download-template-from-repo',
      {
        './serverless-utils/download': downloadStub,
        './spawn': spawnStub,
        './fs/remove': { removeSync: removeSyncStub },
      }
    );
    downloadTemplateFromRepo = downloadTemplateFromRepoModule.downloadTemplateFromRepo;
    parseRepoURL = downloadTemplateFromRepoModule.parseRepoURL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // change back to the old cwd
    process.chdir(cwd);
    fs.rmSync(newServicePath, { recursive: true, force: true });
  });

  describe('downloadTemplateFromRepo', () => {
    it('should reject an error if the passed URL option is not a valid URL', () => {
      return expect(
        downloadTemplateFromRepo('invalidUrl')
      ).to.be.eventually.rejected.and.have.property('code', 'INVALID_TEMPLATE_URL');
    });

    it('should reject an error if the passed URL is not a valid GitHub URL', () => {
      return expect(
        downloadTemplateFromRepo('http://no-git-hub-url.com/foo/bar')
      ).to.be.eventually.rejected.and.have.property('code', 'INVALID_TEMPLATE_PROVIDER');
    });

    it('should reject with a user-facing default target path if a directory already exists', async () => {
      const serviceDirName = path.join(serviceDir, 'existing-service');
      fs.mkdirSync(serviceDirName, { recursive: true });

      try {
        await downloadTemplateFromRepo('https://github.com/johndoe/existing-service');
      } catch (error) {
        expect(error).to.have.property('code', 'TARGET_FOLDER_ALREADY_EXISTS');
        expect(error).to.have.property(
          'message',
          'A folder named "./existing-service" already exists.'
        );
        return;
      }

      throw new Error('Expected downloadTemplateFromRepo to reject');
    });

    it('should reject with the provided path if a target directory already exists', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      const downloadPath = path.join('nested', 'existing-service');
      fs.mkdirSync(path.join(serviceDir, downloadPath), { recursive: true });

      try {
        await downloadTemplateFromRepo(url, undefined, downloadPath);
      } catch (error) {
        expect(error).to.have.property('code', 'TARGET_FOLDER_ALREADY_EXISTS');
        expect(error).to.have.property(
          'message',
          `A folder named "${downloadPath}" already exists.`
        );
        return;
      }

      throw new Error('Expected downloadTemplateFromRepo to reject');
    });

    it('should download the service based on a regular .git URL', async () => {
      const url = 'https://example.com/sample-service.git';

      return expect(downloadTemplateFromRepo(url)).to.be.fulfilled.then(() => {
        expect(spawnStub.calledOnce).to.equal(true);
        expect(downloadStub.calledOnce).to.equal(false);
        expect(spawnStub.args[0][0]).to.equal('git');
        expect(spawnStub.args[0][1][0]).to.equal('clone');
        expect(spawnStub.args[0][1][1]).to.equal('--');
        expect(spawnStub.args[0][1][2]).to.equal(url);
      });
    });

    it('should download and rename the service based on a regular .git URL', async () => {
      const url = 'https://example.com/sample-service.git';
      const name = 'new-service-name';

      spawnStub.resolves({
        then: (callback) => {
          const slsYml = path.join(process.cwd(), 'new-service-name', 'serverless.yml');
          writeFileSync(slsYml, 'service: sample-service');
          callback();
        },
      });

      return expect(downloadTemplateFromRepo(url, name)).to.be.fulfilled.then((serviceName) => {
        expect(spawnStub.calledOnce).to.equal(true);
        expect(downloadStub.calledOnce).to.equal(false);
        expect(spawnStub.args[0][0]).to.equal('git');
        expect(spawnStub.args[0][1][0]).to.equal('clone');
        expect(spawnStub.args[0][1][1]).to.equal('--');
        expect(spawnStub.args[0][1][2]).to.equal(url);
        const yml = readFileSync(path.join(newServicePath, 'serverless.yml'));
        expect(yml.service).to.equal(name);
        expect(serviceName).to.equal('sample-service');
      });
    });

    it('should download the service based on a regular .git URL start with git@', async () => {
      const url = 'git@example.com/sample-service.git';

      return expect(downloadTemplateFromRepo(url)).to.be.fulfilled.then(() => {
        expect(spawnStub.calledOnce).to.equal(true);
        expect(downloadStub.calledOnce).to.equal(false);
        expect(spawnStub.args[0][0]).to.equal('git');
        expect(spawnStub.args[0][1][0]).to.equal('clone');
        expect(spawnStub.args[0][1][1]).to.equal('--');
        expect(spawnStub.args[0][1][2]).to.equal(url);
      });
    });

    it('should download and rename the service based on a regular .git URL start with git@', async () => {
      const url = 'git@example.com/sample-service.git';
      const name = 'new-service-name';

      spawnStub.resolves({
        then: (callback) => {
          const slsYml = path.join(process.cwd(), 'new-service-name', 'serverless.yml');
          writeFileSync(slsYml, 'service: sample-service');
          callback();
        },
      });

      return expect(downloadTemplateFromRepo(url, name)).to.be.fulfilled.then((serviceName) => {
        expect(spawnStub.calledOnce).to.equal(true);
        expect(downloadStub.calledOnce).to.equal(false);
        expect(spawnStub.args[0][0]).to.equal('git');
        expect(spawnStub.args[0][1][0]).to.equal('clone');
        expect(spawnStub.args[0][1][1]).to.equal('--');
        expect(spawnStub.args[0][1][2]).to.equal(url);
        const yml = readFileSync(path.join(newServicePath, 'serverless.yml'));
        expect(yml.service).to.equal(name);
        expect(serviceName).to.equal('sample-service');
      });
    });

    it('should download the service based on the GitHub URL', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';

      return expect(downloadTemplateFromRepo(url)).to.be.fulfilled.then(() => {
        expect(downloadStub.calledOnce).to.equal(true);
        expect(downloadStub.args[0][0]).to.equal(`${url}/archive/master.zip`);
      });
    });

    it('should download and rename the service based on the GitHub URL', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      const name = 'new-service-name';

      downloadStub.resolves({
        then: (callback) => {
          const slsYml = path.join(process.cwd(), 'new-service-name', 'serverless.yml');
          writeFileSync(slsYml, 'service: service-name');
          callback();
        },
      });

      return expect(downloadTemplateFromRepo(url, name)).to.be.fulfilled.then((serviceName) => {
        expect(downloadStub.calledOnce).to.equal(true);
        expect(downloadStub.args[0][1]).to.contain(name);
        expect(downloadStub.args[0][0]).to.equal(`${url}/archive/master.zip`);
        const yml = readFileSync(path.join(newServicePath, 'serverless.yml'));
        expect(yml.service).to.equal(name);
        expect(serviceName).to.equal('service-to-be-downloaded');
      });
    });

    it('passes the GitHub auth redirect allowlist through to the downloader', async () => {
      const url = 'https://username:password@github.com/serverless/serverless';

      await downloadTemplateFromRepo(url);

      expect(downloadStub.calledOnce).to.equal(true);
      expect(downloadStub.firstCall.args[2]).to.deep.include({
        username: 'username',
        password: 'password',
      });
      expect(downloadStub.firstCall.args[2].allowedAuthRedirectHostnames).to.deep.equal([
        'codeload.github.com',
      ]);
      expect(downloadStub.firstCall.args[2]).to.not.have.property('mode');
    });

    it('should download into the provided path and rename the service to the provided name', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      const name = 'new-service-name';
      const downloadPath = 'custom-target-directory';
      const targetPath = path.join(serviceDir, downloadPath);

      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        expect(downloadUrl).to.equal(`${url}/archive/master.zip`);
        expect(destinationPath).to.equal(targetPath);
        writeFileSync(path.join(destinationPath, 'serverless.yml'), 'service: service-name');
      });

      return expect(downloadTemplateFromRepo(url, name, downloadPath)).to.be.fulfilled.then(
        (serviceName) => {
          const yml = readFileSync(path.join(targetPath, 'serverless.yml'));
          expect(yml.service).to.equal(name);
          expect(serviceName).to.equal('service-to-be-downloaded');
        }
      );
    });

    it('should default the service name to the target directory basename when only path is provided', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      const downloadPath = path.join('nested', 'custom-target-directory');
      const targetPath = path.join(serviceDir, downloadPath);

      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        expect(downloadUrl).to.equal(`${url}/archive/master.zip`);
        expect(destinationPath).to.equal(targetPath);
        writeFileSync(path.join(destinationPath, 'serverless.yml'), 'service: service-name');
      });

      return expect(downloadTemplateFromRepo(url, undefined, downloadPath)).to.be.fulfilled.then(
        (serviceName) => {
          const yml = readFileSync(path.join(targetPath, 'serverless.yml'));
          expect(yml.service).to.equal('custom-target-directory');
          expect(serviceName).to.equal('service-to-be-downloaded');
        }
      );
    });

    it('should expand a home-relative download path', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      const fakeHome = getTmpDirPath();
      const downloadPath = '~/nested/custom-target-directory';
      const targetPath = path.join(fakeHome, 'nested', 'custom-target-directory');
      const downloadTemplateFromRepoWithFakeHome = proxyquire(
        '../../../../lib/utils/download-template-from-repo',
        {
          './serverless-utils/download': downloadStub,
          './spawn': spawnStub,
          './fs/remove': { removeSync: removeSyncStub },
          './untildify': loadUntildifyWithHome(fakeHome),
        }
      ).downloadTemplateFromRepo;

      try {
        downloadStub.callsFake(async (downloadUrl, destinationPath) => {
          expect(downloadUrl).to.equal(`${url}/archive/master.zip`);
          expect(destinationPath).to.equal(targetPath);
          writeFileSync(path.join(destinationPath, 'serverless.yml'), 'service: service-name');
        });

        return expect(
          downloadTemplateFromRepoWithFakeHome(url, undefined, downloadPath)
        ).to.be.fulfilled.then((serviceName) => {
          const yml = readFileSync(path.join(targetPath, 'serverless.yml'));
          expect(yml.service).to.equal('custom-target-directory');
          expect(serviceName).to.equal('service-to-be-downloaded');
        });
      } finally {
        fs.rmSync(fakeHome, { recursive: true, force: true });
      }
    });

    it('should stop before downloading when download path expansion fails', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      const expansionError = new ServerlessError(
        'Cannot expand path "~/target": home directory could not be resolved.',
        'HOME_DIRECTORY_UNAVAILABLE'
      );
      const downloadTemplateFromRepoWithFailingUntildify = proxyquire(
        '../../../../lib/utils/download-template-from-repo',
        {
          './serverless-utils/download': downloadStub,
          './spawn': spawnStub,
          './fs/remove': { removeSync: removeSyncStub },
          './untildify': sinon.stub().throws(expansionError),
        }
      ).downloadTemplateFromRepo;

      try {
        await downloadTemplateFromRepoWithFailingUntildify(url, undefined, '~/target');
      } catch (error) {
        expect(error).to.equal(expansionError);
        expect(downloadStub).to.not.have.been.called;
        expect(spawnStub).to.not.have.been.called;
        return;
      }

      throw new Error('Expected downloadTemplateFromRepo to reject');
    });

    it('should report the original home-relative path when the expanded target exists', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      const fakeHome = getTmpDirPath();
      const downloadPath = '~/existing-service';
      const expandedPath = path.join(fakeHome, 'existing-service');
      const downloadTemplateFromRepoWithFakeHome = proxyquire(
        '../../../../lib/utils/download-template-from-repo',
        {
          './serverless-utils/download': downloadStub,
          './spawn': spawnStub,
          './fs/remove': { removeSync: removeSyncStub },
          './untildify': loadUntildifyWithHome(fakeHome),
        }
      ).downloadTemplateFromRepo;
      fs.mkdirSync(expandedPath, { recursive: true });

      try {
        await downloadTemplateFromRepoWithFakeHome(url, undefined, downloadPath);
      } catch (error) {
        expect(error).to.have.property('code', 'TARGET_FOLDER_ALREADY_EXISTS');
        expect(error).to.have.property(
          'message',
          'A folder named "~/existing-service" already exists.'
        );
        return;
      } finally {
        fs.rmSync(fakeHome, { recursive: true, force: true });
      }

      throw new Error('Expected downloadTemplateFromRepo to reject');
    });

    it('should treat --name as a literal target directory name when --path is omitted', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      const name = '~/service';
      const targetPath = path.join(serviceDir, name);

      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        expect(downloadUrl).to.equal(`${url}/archive/master.zip`);
        expect(destinationPath).to.equal(targetPath);
        writeFileSync(path.join(destinationPath, 'serverless.yml'), 'service: service-name');
      });

      return expect(downloadTemplateFromRepo(url, name)).to.be.fulfilled.then((serviceName) => {
        const yml = readFileSync(path.join(targetPath, 'serverless.yml'));
        expect(yml.service).to.equal(name);
        expect(serviceName).to.equal('service-to-be-downloaded');
      });
    });

    it('should download and rename the service based directories in the GitHub URL', async () => {
      const url = 'https://github.com/serverless/examples/tree/master/rest-api-with-dynamodb';
      const name = 'new-service-name';

      let temporaryDownloadPath;
      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        temporaryDownloadPath = destinationPath;
        fs.rmSync(newServicePath, { recursive: true, force: true });
        writeFileSync(
          path.join(destinationPath, 'rest-api-with-dynamodb', 'serverless.yml'),
          'service: service-name'
        );
      });

      return expect(downloadTemplateFromRepo(url, name)).to.be.fulfilled.then((serviceName) => {
        expect(downloadStub.calledOnce).to.equal(true);
        expect(temporaryDownloadPath).to.include(os.tmpdir());
        expect(temporaryDownloadPath).to.not.equal(path.join(os.tmpdir(), 'examples'));
        expect(fs.existsSync(temporaryDownloadPath)).to.equal(false);
        const yml = readFileSync(path.join(newServicePath, 'serverless.yml'));
        expect(yml.service).to.equal(name);
        expect(serviceName).to.equal('rest-api-with-dynamodb');
      });
    });

    it('should rename subdirectory downloads to the folder name when no name or path is provided', async () => {
      const url = 'https://github.com/serverless/examples/tree/master/rest-api-with-dynamodb';
      const targetPath = path.join(serviceDir, 'rest-api-with-dynamodb');

      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        writeFileSync(
          path.join(destinationPath, 'rest-api-with-dynamodb', 'serverless.yml'),
          'service: service-name'
        );
      });

      return expect(downloadTemplateFromRepo(url)).to.be.fulfilled.then((serviceName) => {
        const yml = readFileSync(path.join(targetPath, 'serverless.yml'));
        expect(yml.service).to.equal('rest-api-with-dynamodb');
        expect(serviceName).to.equal('rest-api-with-dynamodb');
      });
    });

    it('should rename subdirectory downloads even when the requested name matches the repo name', async () => {
      const url = 'https://github.com/serverless/examples/tree/master/rest-api-with-dynamodb';
      const name = 'examples';
      const targetPath = path.join(serviceDir, name);

      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        writeFileSync(
          path.join(destinationPath, 'rest-api-with-dynamodb', 'serverless.yml'),
          'service: service-name'
        );
      });

      return expect(downloadTemplateFromRepo(url, name)).to.be.fulfilled.then((serviceName) => {
        const yml = readFileSync(path.join(targetPath, 'serverless.yml'));
        expect(yml.service).to.equal(name);
        expect(serviceName).to.equal('rest-api-with-dynamodb');
      });
    });

    it('should throw an error if the same service name exists as directory in Github', () => {
      const url = 'https://github.com/serverless/examples/tree/master/rest-api-with-dynamodb';
      const serviceDirName = path.join(serviceDir, 'rest-api-with-dynamodb');
      fs.mkdirSync(serviceDirName, { recursive: true });

      return expect(
        downloadTemplateFromRepo(null, url)
      ).to.be.eventually.rejected.and.have.property('code', 'MISSING_TEMPLATE_URL');
    });

    it('uses a different temporary directory for repeated subdirectory downloads', async () => {
      const url = 'https://github.com/serverless/examples/tree/master/rest-api-with-dynamodb';
      const temporaryDownloadPaths = [];

      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        temporaryDownloadPaths.push(destinationPath);
        writeFileSync(
          path.join(destinationPath, 'rest-api-with-dynamodb', 'serverless.yml'),
          'service: service-name'
        );
      });

      await downloadTemplateFromRepo(url, 'first-service');
      await downloadTemplateFromRepo(url, 'second-service');

      expect(temporaryDownloadPaths).to.have.length(2);
      expect(temporaryDownloadPaths[0]).to.not.equal(temporaryDownloadPaths[1]);
      for (const temporaryDownloadPath of temporaryDownloadPaths) {
        expect(fs.existsSync(temporaryDownloadPath)).to.equal(false);
      }
      fs.rmSync(path.join(serviceDir, 'first-service'), { recursive: true, force: true });
      fs.rmSync(path.join(serviceDir, 'second-service'), { recursive: true, force: true });
    });

    it('removes the temporary directory when subdirectory download fails', async () => {
      const url = 'https://github.com/serverless/examples/tree/master/rest-api-with-dynamodb';
      let temporaryDownloadPath;
      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        temporaryDownloadPath = destinationPath;
        writeFileSync(path.join(destinationPath, 'marker'), 'marker');
        throw new Error('Download failed');
      });

      await expect(downloadTemplateFromRepo(url, 'failed-service')).to.be.rejectedWith(
        'Download failed'
      );

      expect(fs.existsSync(temporaryDownloadPath)).to.equal(false);
    });

    it('preserves the primary error when temporary directory cleanup fails', async () => {
      const url = 'https://github.com/serverless/examples/tree/master/rest-api-with-dynamodb';
      let temporaryDownloadPath;
      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        temporaryDownloadPath = destinationPath;
        writeFileSync(path.join(destinationPath, 'marker'), 'marker');
        throw new Error('Download failed');
      });
      removeSyncStub.callsFake(() => {
        throw new Error('Cleanup failed');
      });

      try {
        await expect(downloadTemplateFromRepo(url, 'failed-service')).to.be.rejectedWith(
          'Download failed'
        );
        expect(removeSyncStub).to.have.been.calledOnceWith(temporaryDownloadPath);
      } finally {
        fs.rmSync(temporaryDownloadPath, { recursive: true, force: true });
      }
    });

    it('removes the temporary directory when subdirectory copy fails', async () => {
      const url = 'https://github.com/serverless/examples/tree/master/rest-api-with-dynamodb';
      let temporaryDownloadPath;
      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        temporaryDownloadPath = destinationPath;
        fs.mkdirSync(destinationPath, { recursive: true });
      });

      await expect(downloadTemplateFromRepo(url, 'failed-service')).to.be.rejected;

      expect(fs.existsSync(temporaryDownloadPath)).to.equal(false);
    });

    it('removes the temporary directory when subdirectory rename fails', async () => {
      const url = 'https://github.com/serverless/examples/tree/master/rest-api-with-dynamodb';
      let temporaryDownloadPath;
      downloadStub.callsFake(async (downloadUrl, destinationPath) => {
        temporaryDownloadPath = destinationPath;
        fs.mkdirSync(path.join(destinationPath, 'rest-api-with-dynamodb'), { recursive: true });
      });

      await expect(
        downloadTemplateFromRepo(url, 'failed-service')
      ).to.be.eventually.rejected.and.have.property('code', 'MISSING_SERVICE_FILE');

      expect(fs.existsSync(temporaryDownloadPath)).to.equal(false);
      fs.rmSync(path.join(serviceDir, 'failed-service'), { recursive: true, force: true });
    });
  });

  describe('parseRepoURL', () => {
    it('should reject an error if no URL is provided', () => {
      return expect(parseRepoURL()).to.be.eventually.rejected.and.have.property(
        'code',
        'MISSING_TEMPLATE_URL'
      );
    });

    it('should reject an error if URL is not valid', () => {
      return expect(parseRepoURL('non_valid_url')).to.be.eventually.rejected.and.have.property(
        'code',
        'INVALID_TEMPLATE_URL'
      );
    });

    it('should throw an error if URL is not of valid provider', () => {
      return expect(
        parseRepoURL('https://kostasbariotis.com/repo/owner')
      ).to.be.eventually.rejected.and.have.property('code', 'INVALID_TEMPLATE_PROVIDER');
    });

    it('should parse a valid GitHub URL', async () => {
      return expect(parseRepoURL('https://github.com/serverless/serverless')).to.be.fulfilled.then(
        (output) => {
          expect(output).to.deep.eq({
            owner: 'serverless',
            repo: 'serverless',
            branch: 'master',
            downloadUrl: 'https://github.com/serverless/serverless/archive/master.zip',
            isSubdirectory: false,
            pathToDirectory: '',
            username: '',
            password: '',
          });
        }
      );
    });

    it('should parse a valid GitHub URL with subdirectory', async () => {
      return expect(
        parseRepoURL('https://github.com/serverless/serverless/tree/master/assets')
      ).to.be.fulfilled.then((output) => {
        expect(output).to.deep.eq({
          owner: 'serverless',
          repo: 'serverless',
          branch: 'master',
          downloadUrl: 'https://github.com/serverless/serverless/archive/master.zip',
          isSubdirectory: true,
          pathToDirectory: 'assets',
          username: '',
          password: '',
        });
      });
    });

    it('rejects unsafe GitHub URL path segments and invalid route markers', async () => {
      const invalidUrls = [
        'https://github.com/%2e%2e/serverless',
        'https://github.com/serverless/%2e%2e',
        'https://github.com/serverless/serverless/blob/master/assets',
        'https://github.com/serverless/serverless/tree/master/%2e%2e',
        'https://github.com/serverless/serverless/tree/master/a%2Fb',
        'https://github.com/serverless/serverless/tree/master/a%5Cb',
      ];

      for (const url of invalidUrls) {
        await expect(parseRepoURL(url)).to.be.eventually.rejected.and.have.property(
          'code',
          'INVALID_TEMPLATE_URL'
        );
      }
    });

    it('should parse a valid GitHub Enterprise URL', async () => {
      return expect(
        parseRepoURL('https://github.mydomain.com/serverless/serverless')
      ).to.be.fulfilled.then((output) => {
        expect(output).to.deep.eq({
          owner: 'serverless',
          repo: 'serverless',
          branch: 'master',
          downloadUrl: 'https://github.mydomain.com/serverless/serverless/archive/master.zip',
          isSubdirectory: false,
          pathToDirectory: '',
          username: '',
          password: '',
        });
      });
    });

    it('should parse a valid GitHub Enterprise with subdirectory', async () => {
      return expect(
        parseRepoURL('https://github.mydomain.com/serverless/serverless/tree/master/assets')
      ).to.be.fulfilled.then((output) => {
        expect(output).to.deep.eq({
          owner: 'serverless',
          repo: 'serverless',
          branch: 'master',
          downloadUrl: 'https://github.mydomain.com/serverless/serverless/archive/master.zip',
          isSubdirectory: true,
          pathToDirectory: 'assets',
          username: '',
          password: '',
        });
      });
    });

    it('rejects invalid GitHub Enterprise route markers', async () => {
      await expect(
        parseRepoURL('https://github.mydomain.com/serverless/serverless/blob/master/assets')
      ).to.be.eventually.rejected.and.have.property('code', 'INVALID_TEMPLATE_URL');
    });

    it('should parse a valid GitHub Enterprise URL with authentication', async () => {
      return expect(
        parseRepoURL('https://username:password@github.com/serverless/serverless/')
      ).to.be.fulfilled.then((output) => {
        expect(output).to.deep.eq({
          owner: 'serverless',
          repo: 'serverless',
          branch: 'master',
          downloadUrl: 'https://github.com/serverless/serverless/archive/master.zip',
          isSubdirectory: false,
          username: 'username',
          password: 'password',
          pathToDirectory: '',
        });
      });
    });

    it('should parse a valid BitBucket URL', async () => {
      return parseRepoURL('https://bitbucket.org/atlassian/localstack').then((output) => {
        expect(output).to.deep.eq({
          owner: 'atlassian',
          repo: 'localstack',
          branch: 'master',
          downloadUrl: 'https://bitbucket.org/atlassian/localstack/get/master.zip',
          isSubdirectory: false,
          pathToDirectory: '',
          username: '',
          password: '',
        });
      });
    });

    it('should parse a valid BitBucket URL with subdirectory', async () => {
      return parseRepoURL(
        'https://bitbucket.org/atlassian/localstack/src/85870856fd6941ae75c0fa946a51cf756ff2f53a/localstack/dashboard/?at=mvn'
      ).then((output) => {
        expect(output).to.deep.eq({
          owner: 'atlassian',
          repo: 'localstack',
          branch: 'mvn',
          downloadUrl: 'https://bitbucket.org/atlassian/localstack/get/mvn.zip',
          isSubdirectory: true,
          pathToDirectory: `localstack${path.sep}dashboard`,
          username: '',
          password: '',
        });
      });
    });

    it('rejects unsafe Bitbucket Cloud URL path segments, route markers, and raw queries', async () => {
      const invalidUrls = [
        'https://bitbucket.org/%2e%2e/localstack',
        'https://bitbucket.org/atlassian/%2e%2e',
        'https://bitbucket.org/atlassian/localstack/branch/main/localstack',
        'https://bitbucket.org/atlassian/localstack/src/main/%2e%2e?at=mvn',
        'https://bitbucket.org/atlassian/localstack/src/main/a%2Fb?at=mvn',
        'https://bitbucket.org/atlassian/localstack/src/main/dashboard?at=%E0%A4%A',
        'https://bitbucket.org/atlassian/localstack/src/main/dashboard?at=feature%00branch',
      ];

      for (const url of invalidUrls) {
        await expect(parseRepoURL(url)).to.be.eventually.rejected.and.have.property(
          'code',
          'INVALID_TEMPLATE_URL'
        );
      }
    });

    it('should parse a valid Bitbucket Server URL', async () => {
      return parseRepoURL(
        'https://user:pass@mybitbucket.server.ltd/rest/api/latest/projects/myproject/repos/myrepo/archive?at=refs%2Fheads%2Fdevelop'
      ).then((output) => {
        expect(output).to.deep.eq({
          owner: 'myproject',
          repo: 'myrepo',
          branch: 'refs/heads/develop',
          downloadUrl:
            'https://mybitbucket.server.ltd/rest/api/latest/projects/myproject/repos/myrepo/archive?at=refs%2Fheads%2Fdevelop&format=zip',
          isSubdirectory: false,
          pathToDirectory: '',
          username: 'user',
          password: 'pass',
        });
      });
    });

    it('defaults Bitbucket Server URLs without a query to master and a valid archive URL', async () => {
      return parseRepoURL(
        'https://mybitbucket.server.ltd/rest/api/latest/projects/myproject/repos/myrepo/archive'
      ).then((output) => {
        expect(output).to.deep.include({
          owner: 'myproject',
          repo: 'myrepo',
          branch: 'master',
          downloadUrl:
            'https://mybitbucket.server.ltd/rest/api/latest/projects/myproject/repos/myrepo/archive?format=zip',
        });
      });
    });

    it('rejects unsafe Bitbucket Server URL paths and malformed queries', async () => {
      const invalidUrls = [
        'https://mybitbucket.server.ltd/rest/api/latest/projects/%2e%2e/repos/myrepo/archive?at=main',
        'https://mybitbucket.server.ltd/rest/api/latest/projects/myproject/repos/%2e%2e/archive?at=main',
        'https://mybitbucket.server.ltd/rest/api/latest/projects/myproject/notrepos/myrepo/archive?at=main',
        'https://mybitbucket.server.ltd/rest/api/latest/projects/myproject/repos/myrepo/archive?at=%E0%A4%A',
      ];

      for (const url of invalidUrls) {
        await expect(parseRepoURL(url)).to.be.eventually.rejected.and.have.property(
          'code',
          'INVALID_TEMPLATE_URL'
        );
      }
    });

    it('should parse a valid GitLab URL ', async () => {
      return parseRepoURL('https://gitlab.com/serverless/serverless').then((output) => {
        expect(output).to.deep.eq({
          owner: 'serverless',
          repo: 'serverless',
          branch: 'master',
          downloadUrl:
            'https://gitlab.com/serverless/serverless/-/archive/master/serverless-master.zip',
          isSubdirectory: false,
          pathToDirectory: '',
          username: '',
          password: '',
        });
      });
    });

    it('should parse a valid GitLab URL with subdirectory', async () => {
      return parseRepoURL('https://gitlab.com/serverless/serverless/tree/dev/subdir').then(
        (output) => {
          expect(output).to.deep.eq({
            owner: 'serverless',
            repo: 'serverless',
            branch: 'dev',
            downloadUrl:
              'https://gitlab.com/serverless/serverless/-/archive/dev/serverless-dev.zip',
            isSubdirectory: true,
            pathToDirectory: 'subdir',
            username: '',
            password: '',
          });
        }
      );
    });

    it('rejects unsafe GitLab URL path segments and invalid route markers', async () => {
      const invalidUrls = [
        'https://gitlab.com/%2e%2e/serverless',
        'https://gitlab.com/serverless/%2e%2e',
        'https://gitlab.com/serverless/serverless/blob/dev/subdir',
        'https://gitlab.com/serverless/serverless/tree/dev/%2e%2e',
      ];

      for (const url of invalidUrls) {
        await expect(parseRepoURL(url)).to.be.eventually.rejected.and.have.property(
          'code',
          'INVALID_TEMPLATE_URL'
        );
      }
    });

    it('rejects unsafe plain git repository names', async () => {
      const invalidUrls = [
        'https://example.com/%2e%2e.git',
        'https://example.com/a%2Fb.git',
        'https://example.com/a%5Cb.git',
      ];

      for (const url of invalidUrls) {
        await expect(parseRepoURL(url)).to.be.eventually.rejected.and.have.property(
          'code',
          'INVALID_TEMPLATE_URL'
        );
      }
    });
  });
});
