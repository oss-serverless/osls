'use strict';

const path = require('path');
const chai = require('chai');
const fs = require('fs');
const fsp = require('fs').promises;
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();
const sinon = require('sinon');
const { load: yamlParse } = require('js-yaml');
const createFromLocalTemplate = require('../../../../lib/utils/create-from-local-template');
const ServerlessError = require('../../../../lib/serverless-error');
const { ensureDir, getTmpDirPath, outputFile, pathExists, remove } = require('../../../utils/fs');
const skipOnDisabledSymlinksInWindows = require('../../../lib/skip-on-disabled-symlinks-in-windows');

const fixturesPath = path.resolve(__dirname, '../../../fixtures/programmatic');

const expect = chai.expect;

const loadUntildifyWithHome = (homeDirectory) =>
  proxyquire('../../../../lib/utils/untildify', {
    os: {
      homedir: () => homeDirectory,
      userInfo: () => ({ username: 'test-user' }),
    },
  });

describe('test/unit/lib/utils/create-from-local-template.test.js', () => {
  describe('Without `projectName` provided', () => {
    it('should create from template referenced locally', async () => {
      const tmpDirPath = path.join(getTmpDirPath(), 'some-service');
      await createFromLocalTemplate({
        templatePath: path.join(fixturesPath, 'function'),
        projectDir: tmpDirPath,
      });
      const stats = await fsp.lstat(path.join(tmpDirPath, 'serverless.yml'));
      expect(stats.isFile()).to.be.true;
    });

    it('should expand a home-relative template path', async () => {
      const fakeHome = getTmpDirPath();
      const templateDirName = 'test-template';
      const homeTemplatePath = path.join(fakeHome, templateDirName);
      const projectDir = path.join(getTmpDirPath(), 'some-service');
      const createFromLocalTemplateWithFakeHome = proxyquire(
        '../../../../lib/utils/create-from-local-template',
        {
          './untildify': loadUntildifyWithHome(fakeHome),
        }
      );

      try {
        await outputFile(path.join(homeTemplatePath, 'serverless.yml'), 'service: source\n');

        await createFromLocalTemplateWithFakeHome({
          templatePath: `~/${templateDirName}`,
          projectDir,
        });

        const stats = await fsp.lstat(path.join(projectDir, 'serverless.yml'));
        expect(stats.isFile()).to.equal(true);
      } finally {
        await remove(fakeHome);
        await remove(projectDir);
      }
    });

    it('should stop before copying when template path expansion fails', async () => {
      const expansionError = new ServerlessError(
        'Cannot expand path "~/template": home directory could not be resolved.',
        'HOME_DIRECTORY_UNAVAILABLE'
      );
      const copyStub = sinon.stub().resolves();
      const createFromLocalTemplateWithFailingUntildify = proxyquire(
        '../../../../lib/utils/create-from-local-template',
        {
          './untildify': sinon.stub().throws(expansionError),
          './fs/copy': copyStub,
        }
      );

      try {
        await createFromLocalTemplateWithFailingUntildify({
          templatePath: '~/template',
          projectDir: path.join(getTmpDirPath(), 'some-service'),
        });
      } catch (error) {
        expect(error).to.equal(expansionError);
        expect(copyStub).to.not.have.been.called;
        return;
      }

      throw new Error('Expected createFromLocalTemplate to reject');
    });

    it('skips symlinks when creating from a local template', async function () {
      const tmpRoot = getTmpDirPath();
      const templatePath = path.join(tmpRoot, 'template');
      const targetPath = path.join(templatePath, 'target.txt');
      const linkPath = path.join(templatePath, 'link.txt');
      const projectDir = path.join(tmpRoot, 'project');

      try {
        await ensureDir(templatePath);
        await outputFile(path.join(templatePath, 'serverless.yml'), 'service: source\n');
        await outputFile(targetPath, 'target');
        try {
          await fsp.symlink(targetPath, linkPath);
        } catch (error) {
          skipOnDisabledSymlinksInWindows(error, this, () => remove(tmpRoot));
          throw error;
        }

        await createFromLocalTemplate({ templatePath, projectDir });

        expect(await fsp.readFile(path.join(projectDir, 'target.txt'), 'utf8')).to.equal('target');
        expect(await pathExists(path.join(projectDir, 'link.txt'))).to.equal(false);
        expect(fs.lstatSync(path.join(projectDir, 'target.txt')).isSymbolicLink()).to.equal(false);
      } finally {
        await remove(tmpRoot);
      }
    });
  });

  describe('When `templatePath` does not exist', () => {
    it('should result in an error', async () => {
      const tmpDirPath = path.join(getTmpDirPath(), 'some-service');
      await expect(
        createFromLocalTemplate({
          templatePath: path.join(fixturesPath, 'nonexistent'),
          projectDir: tmpDirPath,
        })
      ).to.eventually.be.rejected.and.have.property('code', 'INVALID_TEMPLATE_PATH');
    });
  });

  describe('With `projectName` provided', () => {
    let tmpDirPath;

    before(async () => {
      tmpDirPath = path.join(getTmpDirPath(), 'some-service');
      await createFromLocalTemplate({
        templatePath: path.join(fixturesPath, 'function-msk'),
        projectDir: tmpDirPath,
        projectName: 'testproj',
      });
    });

    it('should set service name in serverless.yml', async () =>
      expect(
        yamlParse(await fsp.readFile(path.join(tmpDirPath, 'serverless.yml'))).service
      ).to.equal('testproj'));

    it('should set name in package.json', async () =>
      expect(JSON.parse(await fsp.readFile(path.join(tmpDirPath, 'package.json'))).name).to.equal(
        'testproj'
      ));
  });
});
