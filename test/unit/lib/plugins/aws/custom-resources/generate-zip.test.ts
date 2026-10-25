'use strict';

const path = require('path');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();
const glob = require('../../../../../../lib/utils/glob');
const requireUncached = require('../../../../../utils/require-uncached');
const { listZipFiles } = require('../../../../../utils/fs');
const { expect } = require('chai');

// The directory that holds the files that generateZip zips up
const resourcesDir = path.resolve(
  __dirname,
  '../../../../../../lib/plugins/aws/custom-resources/resources/'
);
const generateZipPath = '../../../../../../lib/plugins/aws/custom-resources/generate-zip';
const escapedPathSep = path.sep.replace(/\\/g, '\\\\');

describe('test/unit/lib/plugins/aws/customResources/generateZip.test.js', () => {
  describe('when generating a zip file', () => {
    it('should generate a zip file with the contents of the resources directory', async () => {
      const zipFilePath = await requireUncached(async () =>
        require('../../../../../../lib/plugins/aws/custom-resources/generate-zip')()
      );

      // List the files in the zip to make sure it is valid
      const filesInZip = await listZipFiles(zipFilePath);

      const filesInResourceDir = await glob('**', { cwd: resourcesDir });
      expect(filesInZip).to.have.all.members(filesInResourceDir);
    });

    it('should store the zip in a content-addressed cache directory', async () => {
      const zipFilePath = await requireUncached(async () => require(generateZipPath)());

      expect(zipFilePath).to.match(
        new RegExp(
          `${escapedPathSep}\\.serverless${escapedPathSep}artifacts${escapedPathSep}` +
            `custom-resources-[a-f0-9]{32}${escapedPathSep}custom-resources\\.zip$`
        )
      );
    });

    it('should return the same content-addressed path on repeated calls', async () => {
      const [firstPath, secondPath] = await requireUncached(async () => {
        const generateZip = require(generateZipPath);
        return [await generateZip(), await generateZip()];
      });

      expect(secondPath).to.equal(firstPath);
    });

    it('should change the cache directory when resource content changes', async () => {
      const artifactVersions = [];
      const makeGenerateZip = (content) =>
        proxyquire(generateZipPath, {
          'fs': {
            readdirSync: () => [
              {
                name: 'handler.js',
                isDirectory: () => false,
              },
            ],
            readFileSync: () => Buffer.from(content),
          },
          '../../../utils/ensure-artifact': async (artifactName, generate, options) => {
            artifactVersions.push(options.artifactVersion);
            return path.resolve('/tmp/cache', options.artifactVersion);
          },
        });

      await makeGenerateZip('first')();
      await makeGenerateZip('second')();

      expect(artifactVersions[0]).to.match(/^custom-resources-[a-f0-9]{32}$/);
      expect(artifactVersions[1]).to.match(/^custom-resources-[a-f0-9]{32}$/);
      expect(artifactVersions[1]).to.not.equal(artifactVersions[0]);
    });
  });
});
