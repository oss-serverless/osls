'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { expect } = require('chai');
const { getTmpDirPath } = require('../../../../utils/fs');
const {
  normalizeExternalRefOptions,
  normalizeHttpRefOptions,
} = require('../../../../../lib/classes/yaml-parser/external-ref-options');

describe('yaml-parser/external-ref-options', () => {
  const expectOptionsError = (error) => {
    expect(error.code).to.equal('YAML_REF_OPTIONS_ERROR');
  };
  const expectSyncOptionsError = (fn) => {
    expect(fn).to.throw(Error).with.property('code', 'YAML_REF_OPTIONS_ERROR');
  };

  it('defaults to safe external ref behavior', async () => {
    const yamlFilePath = path.join(getTmpDirPath(), 'serverless.yml');
    const options = await normalizeExternalRefOptions(yamlFilePath);

    expect(options.file.allowedRoots.map((root) => root.path)).to.deep.equal([
      path.dirname(yamlFilePath),
    ]);
    expect(options.http).to.deep.equal({
      allowUnsafeUrls: false,
      allowedUnsafeHosts: [],
    });
  });

  it('allows explicit legacy-compatible external ref behavior', async () => {
    const options = await normalizeExternalRefOptions(
      path.join(getTmpDirPath(), 'serverless.yml'),
      {
        externalRefs: {
          file: { allowedRoots: null },
          http: { allowUnsafeUrls: true },
        },
      }
    );

    expect(options.file.allowedRoots).to.equal(null);
    expect(options.http).to.deep.equal({
      allowUnsafeUrls: true,
      allowedUnsafeHosts: [],
    });
  });

  it('uses safe defaults for empty external ref option objects', async () => {
    const yamlFilePath = path.join(getTmpDirPath(), 'serverless.yml');
    const options = await normalizeExternalRefOptions(yamlFilePath, {
      externalRefs: {
        file: {},
        http: {},
      },
    });

    expect(options.file.allowedRoots.map((root) => root.path)).to.deep.equal([
      path.dirname(yamlFilePath),
    ]);
    expect(options.http).to.deep.equal({
      allowUnsafeUrls: false,
      allowedUnsafeHosts: [],
    });
  });

  it('uses safe defaults for undefined option leaves', async () => {
    const yamlFilePath = path.join(getTmpDirPath(), 'serverless.yml');
    const options = await normalizeExternalRefOptions(yamlFilePath, {
      externalRefs: {
        file: { allowedRoots: undefined },
        http: {
          allowUnsafeUrls: undefined,
          allowedUnsafeHosts: undefined,
        },
      },
    });

    expect(options.file.allowedRoots.map((root) => root.path)).to.deep.equal([
      path.dirname(yamlFilePath),
    ]);
    expect(options.http).to.deep.equal({
      allowUnsafeUrls: false,
      allowedUnsafeHosts: [],
    });
  });

  it('normalizes file allowed roots relative to the parsed document', async () => {
    const tmpDirPath = getTmpDirPath();
    const serviceDirPath = path.join(tmpDirPath, 'service');
    const sharedDirPath = path.join(tmpDirPath, 'shared');
    const options = await normalizeExternalRefOptions(path.join(serviceDirPath, 'serverless.yml'), {
      externalRefs: {
        file: {
          allowedRoots: ['.', pathToFileURL(sharedDirPath).href],
        },
      },
    });

    expect(options.file.allowedRoots.map((root) => root.path)).to.deep.equal([
      serviceDirPath,
      sharedDirPath,
    ]);
  });

  it('normalizes allowed unsafe HTTP hosts', () => {
    const options = normalizeHttpRefOptions({
      allowUnsafeUrls: false,
      allowedUnsafeHosts: [
        ' LOCALHOST:3000 ',
        'https://Example.com/ref.yml',
        '//Intranet.local:8080/ref.yml',
        '',
      ],
    });

    expect(options).to.deep.equal({
      allowUnsafeUrls: false,
      allowedUnsafeHosts: ['localhost:3000', 'example.com', 'intranet.local:8080'],
    });
  });

  it('rejects invalid root options', async () => {
    await expect(
      normalizeExternalRefOptions(path.join(getTmpDirPath(), 'serverless.yml'), null)
    ).to.be.rejected.then(expectOptionsError);
  });

  it('rejects null where option objects are expected', async () => {
    const yamlFilePath = path.join(getTmpDirPath(), 'serverless.yml');

    await expect(
      normalizeExternalRefOptions(yamlFilePath, { externalRefs: null })
    ).to.be.rejected.then(expectOptionsError);
    await expect(
      normalizeExternalRefOptions(yamlFilePath, { externalRefs: { file: null } })
    ).to.be.rejected.then(expectOptionsError);
    await expect(
      normalizeExternalRefOptions(yamlFilePath, { externalRefs: { http: null } })
    ).to.be.rejected.then(expectOptionsError);
  });

  it('rejects arrays where objects are expected', async () => {
    const yamlFilePath = path.join(getTmpDirPath(), 'serverless.yml');

    await expect(normalizeExternalRefOptions(yamlFilePath, [])).to.be.rejected.then(
      expectOptionsError
    );
    await expect(
      normalizeExternalRefOptions(yamlFilePath, { externalRefs: [] })
    ).to.be.rejected.then(expectOptionsError);
    await expect(
      normalizeExternalRefOptions(yamlFilePath, { externalRefs: { file: [] } })
    ).to.be.rejected.then(expectOptionsError);
    await expect(
      normalizeExternalRefOptions(yamlFilePath, { externalRefs: { http: [] } })
    ).to.be.rejected.then(expectOptionsError);
  });

  it('rejects unknown option keys', async () => {
    const yamlFilePath = path.join(getTmpDirPath(), 'serverless.yml');

    await expect(normalizeExternalRefOptions(yamlFilePath, { unknown: true })).to.be.rejected.then(
      expectOptionsError
    );
    await expect(
      normalizeExternalRefOptions(yamlFilePath, { externalRefs: { unknown: true } })
    ).to.be.rejected.then(expectOptionsError);
    await expect(
      normalizeExternalRefOptions(yamlFilePath, {
        externalRefs: { file: { unknown: true } },
      })
    ).to.be.rejected.then(expectOptionsError);
    await expect(
      normalizeExternalRefOptions(yamlFilePath, {
        externalRefs: { http: { allowUnsafeURLs: false } },
      })
    ).to.be.rejected.then(expectOptionsError);
  });

  it('rejects unsupported HTTP redirects and timeout options', async () => {
    const yamlFilePath = path.join(getTmpDirPath(), 'serverless.yml');

    await expect(
      normalizeExternalRefOptions(yamlFilePath, { externalRefs: { http: { redirects: 0 } } })
    ).to.be.rejected.then(expectOptionsError);
    await expect(
      normalizeExternalRefOptions(yamlFilePath, { externalRefs: { http: { timeout: 1 } } })
    ).to.be.rejected.then(expectOptionsError);
  });

  it('rejects invalid HTTP options', () => {
    expectSyncOptionsError(() => normalizeHttpRefOptions([]));
    expectSyncOptionsError(() => normalizeHttpRefOptions({ allowUnsafeUrls: null }));
    expectSyncOptionsError(() => normalizeHttpRefOptions({ allowUnsafeUrls: 'false' }));
    expectSyncOptionsError(() => normalizeHttpRefOptions({ allowedUnsafeHosts: null }));
    expectSyncOptionsError(() => normalizeHttpRefOptions({ allowedUnsafeHosts: [true] }));
  });
});
