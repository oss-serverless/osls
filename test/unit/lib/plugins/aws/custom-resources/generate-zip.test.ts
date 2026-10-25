import path from 'node:path';
import glob from '../../../../../../lib/utils/glob.ts';
import { listZipFiles } from '../../../../../utils/fs.ts';
import { expect } from 'chai';
import esmock from 'esmock';

// The directory that holds the files that generateZip zips up
const resourcesDir = path.resolve(
  import.meta.dirname,
  '../../../../../../lib/plugins/aws/custom-resources/resources/'
);
const generateZipPath = '../../../../../../lib/plugins/aws/custom-resources/generate-zip.ts';
const escapedPathSep = path.sep.replace(/\\/g, '\\\\');

// A fresh module instance, as the module computes its state on first use
const loadGenerateZip = async () => (await esmock(generateZipPath)).default;

describe('test/unit/lib/plugins/aws/customResources/generateZip.test.ts', () => {
  describe('when generating a zip file', () => {
    it('should generate a zip file with the contents of the resources directory', async () => {
      const zipFilePath = await (await loadGenerateZip())();

      // List the files in the zip to make sure it is valid
      const filesInZip = await listZipFiles(zipFilePath);

      // TypeScript sources are zipped as JavaScript (types stripped), declaration and map files
      // are left out, and a package.json marks the files as ES modules
      const filesInResourceDir = (await glob('**', { cwd: resourcesDir }))
        .filter((filePath) => !filePath.endsWith('.d.ts') && !filePath.endsWith('.map'))
        .map((filePath) => filePath.replace(/\.ts$/, '.js'));
      expect(filesInZip).to.have.all.members([...filesInResourceDir, 'package.json']);
    });

    it('should store the zip in a content-addressed cache directory', async () => {
      const zipFilePath = await (await loadGenerateZip())();

      expect(zipFilePath).to.match(
        new RegExp(
          `${escapedPathSep}\\.serverless${escapedPathSep}artifacts${escapedPathSep}` +
            `custom-resources-[a-f0-9]{32}${escapedPathSep}custom-resources\\.zip$`
        )
      );
    });

    it('should return the same content-addressed path on repeated calls', async () => {
      const generateZip = await loadGenerateZip();
      const firstPath = await generateZip();
      const secondPath = await generateZip();

      expect(secondPath).to.equal(firstPath);
    });

    it('should change the cache directory when resource content changes', async () => {
      const artifactVersions = [];
      const makeGenerateZip = async (content) =>
        (
          await esmock(generateZipPath, {
            'node:fs': {
              readdirSync: () => [
                {
                  name: 'handler.js',
                  isDirectory: () => false,
                },
              ],
              readFileSync: () => Buffer.from(content),
            },
            '../../../../../../lib/utils/ensure-artifact.ts': async (
              artifactName,
              generate,
              options
            ) => {
              artifactVersions.push(options.artifactVersion);
              return path.resolve('/tmp/cache', options.artifactVersion);
            },
          })
        ).default;

      await (
        await makeGenerateZip('first')
      )();
      await (
        await makeGenerateZip('second')
      )();

      expect(artifactVersions[0]).to.match(/^custom-resources-[a-f0-9]{32}$/);
      expect(artifactVersions[1]).to.match(/^custom-resources-[a-f0-9]{32}$/);
      expect(artifactVersions[1]).to.not.equal(artifactVersions[0]);
    });
  });
});
