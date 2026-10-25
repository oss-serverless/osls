'use strict';

const http = require('http');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const ServerlessError = require('../../../../../lib/serverless-error');
const { ensureDir, getTmpDirPath, remove } = require('../../../../utils/fs');
const runServerless = require('../../../../utils/run-serverless');

const { expect } = require('chai');

const fixturesPath = path.resolve(__dirname, '../../../../fixtures/programmatic');

const loadCreate = ({ downloadTemplateFromRepoStub, dirExistsSyncStub, untildifyStub } = {}) => {
  const noticeStub = sinon.stub();
  noticeStub.success = sinon.stub();
  const copyDirContentsSyncStub = sinon.stub();
  const renameServiceStub = sinon.stub();

  const stubs = {
    '../../utils/download-template-from-repo': {
      downloadTemplateFromRepo: downloadTemplateFromRepoStub || sinon.stub(),
    },
    '../../utils/fs/dir-exists-sync': dirExistsSyncStub || sinon.stub().returns(false),
    '../../utils/fs/copy-dir-contents-sync': copyDirContentsSyncStub,
    '../../utils/rename-service': {
      renameService: renameServiceStub,
    },
    '../../utils/serverless-utils/log': {
      progress: {
        get: () => ({ notice: sinon.stub() }),
      },
      log: {
        notice: noticeStub,
      },
      style: {
        aside: () => '',
      },
    },
  };
  if (untildifyStub) stubs['../../utils/untildify'] = untildifyStub;

  const Create = proxyquire.noCallThru().load('../../../../../lib/plugins/create/create', stubs);

  return {
    Create,
    copyDirContentsSyncStub,
    noticeSuccessStub: noticeStub.success,
    renameServiceStub,
  };
};

describe('test/unit/lib/plugins/create/create.test.js', () => {
  it('should generate scaffolding for local template in provided path and rename service', async () => {
    const tmpDir = getTmpDirPath();
    await runServerless({
      noService: true,
      command: 'create',
      options: {
        'template-path': path.join(fixturesPath, 'aws'),
        'path': tmpDir,
        'name': 'new-service-name',
      },
    });
    const dirContent = await fsp.readdir(tmpDir);
    expect(dirContent).to.include('serverless.yml');

    const serverlessYmlfileContent = (
      await fsp.readFile(path.join(tmpDir, 'serverless.yml'))
    ).toString();
    expect(serverlessYmlfileContent).to.include('service: new-service-name');
  });

  it('should error out when trying to create project in already existing directory (other than current working dir)', async () => {
    const tmpDir = getTmpDirPath();
    await ensureDir(tmpDir);
    await expect(
      runServerless({
        noService: true,
        command: 'create',
        options: {
          'template-path': path.join(fixturesPath, 'aws'),
          'path': tmpDir,
        },
      })
    ).to.eventually.be.rejected.and.have.property('code', 'TARGET_FOLDER_ALREADY_EXISTS');
  });

  it('should error out when no template source is provided', async () => {
    await expect(
      runServerless({
        noService: true,
        command: 'create',
        options: {},
      })
    ).to.eventually.be.rejected.and.have.property('code', 'MISSING_TEMPLATE_CLI_PARAM');
  });

  describe('remote template URL flow', () => {
    let Create;
    let downloadTemplateFromRepoStub;
    let noticeSuccessStub;

    const createInstance = (options) =>
      new Create(
        {
          pluginManager: {
            commandRunStartTime: Date.now(),
          },
        },
        options
      );

    beforeEach(() => {
      downloadTemplateFromRepoStub = sinon.stub();
      ({ Create, noticeSuccessStub } = loadCreate({ downloadTemplateFromRepoStub }));
    });

    it('should report the name-based target directory when --name is provided without --path', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      downloadTemplateFromRepoStub.resolves('service-to-be-downloaded');

      await createInstance({ 'template-url': url, 'name': 'new-service-name' }).create();

      expect(
        downloadTemplateFromRepoStub.calledOnceWithExactly(url, 'new-service-name', undefined)
      ).to.equal(true);
      expect(noticeSuccessStub.calledOnce).to.equal(true);
      expect(noticeSuccessStub.firstCall.args[0]).to.contain(
        'Project successfully created in "./new-service-name"'
      );
    });

    it('should report the provided target path when both --path and --name are set', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      downloadTemplateFromRepoStub.resolves('service-to-be-downloaded');

      await createInstance({
        'template-url': url,
        'path': 'nested/service-directory',
        'name': 'new-service-name',
      }).create();

      expect(
        downloadTemplateFromRepoStub.calledOnceWithExactly(
          url,
          'new-service-name',
          'nested/service-directory'
        )
      ).to.equal(true);
      expect(noticeSuccessStub.calledOnce).to.equal(true);
      expect(noticeSuccessStub.firstCall.args[0]).to.contain(
        'Project successfully created in "nested/service-directory"'
      );
    });

    it('should preserve ServerlessError details from the download helper', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      const helperError = new ServerlessError(
        'The URL you passed is not valid',
        'INVALID_TEMPLATE_URL'
      );
      downloadTemplateFromRepoStub.rejects(helperError);

      try {
        await createInstance({ 'template-url': url }).create();
      } catch (error) {
        expect(error).to.equal(helperError);
        return;
      }

      throw new Error('Expected create() to reject');
    });

    it('should wrap generic download errors with a clean message', async () => {
      const url = 'https://github.com/johndoe/service-to-be-downloaded';
      downloadTemplateFromRepoStub.rejects(new Error('Download exploded'));

      try {
        await createInstance({ 'template-url': url }).create();
      } catch (error) {
        expect(error).to.have.property('code', 'BOILERPLATE_GENERATION_ERROR');
        expect(error).to.have.property('message', 'Download exploded');
        return;
      }

      throw new Error('Expected create() to reject');
    });
  });

  describe('remote template URL integration', () => {
    it('should create from --template-url through the real downloader stack and default the service name to the target basename', async () => {
      const zip = new AdmZip();
      zip.addFile('template-main/serverless.yml', Buffer.from('service: template-name\n'));
      zip.addFile(
        'template-main/package.json',
        Buffer.from(JSON.stringify({ name: 'template-name' }, null, 2))
      );
      zip.addFile(
        'template-main/handler.js',
        Buffer.from("'use strict';\nmodule.exports.hello = async () => 'ok';\n")
      );
      const zipBuffer = zip.toBuffer();
      const requests = [];
      const expectedTemplateUrl = 'https://github.com/johndoe/template/archive/master.zip';
      const tempRoot = getTmpDirPath();
      const targetDir = path.join(tempRoot, 'nested', 'custom-target-directory');
      const originalFetch = globalThis.fetch;
      const server = http.createServer((req, res) => {
        requests.push(req.url);

        if (req.url === '/archive.zip') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/zip');
          res.end(zipBuffer);
          return;
        }

        res.statusCode = 404;
        res.end();
      });

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const requestedUrls = [];
      globalThis.fetch = async (uri, options) => {
        const stringUri = String(uri);
        requestedUrls.push(stringUri);
        return originalFetch(
          stringUri === expectedTemplateUrl ? `${baseUrl}/archive.zip` : stringUri,
          options
        );
      };

      try {
        await runServerless({
          noService: true,
          command: 'create',
          options: {
            'template-url': 'https://github.com/johndoe/template',
            'path': targetDir,
          },
        });

        const serverlessYml = await fsp.readFile(path.join(targetDir, 'serverless.yml'), 'utf8');
        const packageJson = JSON.parse(
          await fsp.readFile(path.join(targetDir, 'package.json'), 'utf8')
        );

        expect(serverlessYml).to.include('service: custom-target-directory');
        expect(packageJson.name).to.equal('custom-target-directory');
        expect(requestedUrls).to.deep.equal([expectedTemplateUrl]);
        expect(requests).to.deep.equal(['/archive.zip']);
      } finally {
        globalThis.fetch = originalFetch;
        await new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
        await remove(tempRoot);
      }
    });
  });

  describe('local template path flow', () => {
    it('should default the target directory to the template folder name', async () => {
      const { Create, copyDirContentsSyncStub, noticeSuccessStub, renameServiceStub } =
        loadCreate();

      await new Create(
        {
          pluginManager: {
            commandRunStartTime: Date.now(),
          },
        },
        {
          'template-path': path.join(fixturesPath, 'aws'),
        }
      ).create();

      expect(copyDirContentsSyncStub.calledOnce).to.equal(true);
      expect(copyDirContentsSyncStub.firstCall.args[0]).to.equal(path.join(fixturesPath, 'aws'));
      expect(copyDirContentsSyncStub.firstCall.args[1]).to.equal(path.join(process.cwd(), 'aws'));
      expect(renameServiceStub.called).to.equal(false);
      expect(noticeSuccessStub.calledOnce).to.equal(true);
      expect(noticeSuccessStub.firstCall.args[0]).to.contain(
        'Project successfully created in "./aws"'
      );
    });

    it('should expand a home-relative local template path before copying', async () => {
      const { Create, copyDirContentsSyncStub, noticeSuccessStub, renameServiceStub } =
        loadCreate();

      await new Create(
        {
          pluginManager: {
            commandRunStartTime: Date.now(),
          },
        },
        {
          'template-path': '~/aws',
        }
      ).create();

      expect(copyDirContentsSyncStub.calledOnce).to.equal(true);
      expect(path.normalize(copyDirContentsSyncStub.firstCall.args[0])).to.equal(
        path.join(os.homedir(), 'aws')
      );
      expect(copyDirContentsSyncStub.firstCall.args[1]).to.equal(path.join(process.cwd(), 'aws'));
      expect(renameServiceStub.called).to.equal(false);
      expect(noticeSuccessStub.firstCall.args[0]).to.contain(
        'Project successfully created in "./aws"'
      );
    });

    it('should stop before copying when local template path expansion fails', async () => {
      const expansionError = new ServerlessError(
        'Cannot expand path "~/aws": home directory could not be resolved.',
        'HOME_DIRECTORY_UNAVAILABLE'
      );
      const { Create, copyDirContentsSyncStub, renameServiceStub } = loadCreate({
        untildifyStub: sinon.stub().throws(expansionError),
      });

      try {
        await new Create(
          {
            pluginManager: {
              commandRunStartTime: Date.now(),
            },
          },
          {
            'template-path': '~/aws',
          }
        ).create();
      } catch (error) {
        expect(error).to.equal(expansionError);
        expect(copyDirContentsSyncStub).to.not.have.been.called;
        expect(renameServiceStub).to.not.have.been.called;
        return;
      }

      throw new Error('Expected create() to reject');
    });

    it('should default the service name to the target directory basename when only --path is provided', async () => {
      const { Create, copyDirContentsSyncStub, noticeSuccessStub, renameServiceStub } =
        loadCreate();
      const targetPath = 'nested/service-directory';
      const expectedServiceDir = path.resolve(process.cwd(), targetPath);

      await new Create(
        {
          pluginManager: {
            commandRunStartTime: Date.now(),
          },
        },
        {
          'template-path': path.join(fixturesPath, 'aws'),
          'path': targetPath,
        }
      ).create();

      expect(copyDirContentsSyncStub.calledOnce).to.equal(true);
      expect(copyDirContentsSyncStub.firstCall.args[0]).to.equal(path.join(fixturesPath, 'aws'));
      expect(copyDirContentsSyncStub.firstCall.args[1]).to.equal(expectedServiceDir);
      expect(
        renameServiceStub.calledOnceWithExactly('service-directory', expectedServiceDir)
      ).to.equal(true);
      expect(noticeSuccessStub.calledOnce).to.equal(true);
      expect(noticeSuccessStub.firstCall.args[0]).to.contain(
        'Project successfully created in "nested/service-directory"'
      );
    });

    it('should expand a home-relative local target path while reporting the original path', async () => {
      const { Create, copyDirContentsSyncStub, noticeSuccessStub, renameServiceStub } =
        loadCreate();
      const targetPath = '~/nested/service-directory';
      const expectedServiceDir = path.join(os.homedir(), 'nested', 'service-directory');

      await new Create(
        {
          pluginManager: {
            commandRunStartTime: Date.now(),
          },
        },
        {
          'template-path': path.join(fixturesPath, 'aws'),
          'path': targetPath,
        }
      ).create();

      expect(copyDirContentsSyncStub.calledOnce).to.equal(true);
      expect(copyDirContentsSyncStub.firstCall.args[1]).to.equal(expectedServiceDir);
      expect(
        renameServiceStub.calledOnceWithExactly('service-directory', expectedServiceDir)
      ).to.equal(true);
      expect(noticeSuccessStub.firstCall.args[0]).to.contain(
        'Project successfully created in "~/nested/service-directory"'
      );
    });

    it('should report the provided local target path when the directory already exists', async () => {
      const { Create } = loadCreate({
        dirExistsSyncStub: sinon.stub().returns(true),
      });

      try {
        await new Create(
          {
            pluginManager: {
              commandRunStartTime: Date.now(),
            },
          },
          {
            'template-path': path.join(fixturesPath, 'aws'),
            'path': 'nested/service-directory',
          }
        ).create();
      } catch (error) {
        expect(error).to.have.property('code', 'TARGET_FOLDER_ALREADY_EXISTS');
        expect(error).to.have.property(
          'message',
          'A folder named "nested/service-directory" already exists.'
        );
        return;
      }

      throw new Error('Expected create() to reject');
    });
  });
});
