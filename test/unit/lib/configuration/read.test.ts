'use strict';

const chai = require('chai');

const { expect } = chai;

const fsp = require('fs').promises;
const readConfiguration = require('../../../../lib/configuration/read');
const { ensureDir, ensureFile, outputFile, remove } = require('../../../utils/fs');

describe('test/unit/lib/configuration/read.test.js', () => {
  let configurationPath;

  afterEach(async () => {
    if (configurationPath) await fsp.unlink(configurationPath);
    configurationPath = null;
  });

  it('should read "serverless.yml"', async () => {
    configurationPath = 'serverless.yml';
    await fsp.writeFile(configurationPath, 'service: test-yml\nprovider:\n  name: aws\n');
    expect(await readConfiguration(configurationPath)).to.deep.equal({
      service: 'test-yml',
      provider: { name: 'aws' },
    });
  });

  it('should read "serverless.yaml"', async () => {
    configurationPath = 'serverless.yaml';
    await fsp.writeFile(configurationPath, 'service: test-yaml\nprovider:\n  name: aws\n');
    expect(await readConfiguration(configurationPath)).to.deep.equal({
      service: 'test-yaml',
      provider: { name: 'aws' },
    });
  });

  it('should support AWS CloudFormation shortcut syntax', async () => {
    configurationPath = 'serverless.yml';
    await fsp.writeFile(
      configurationPath,
      'service: test-cf-shortcut\nprovider:\n  name: aws\n  cfProperty: !GetAtt MyResource.Arn'
    );
    expect(await readConfiguration(configurationPath)).to.deep.equal({
      service: 'test-cf-shortcut',
      provider: { name: 'aws', cfProperty: { 'Fn::GetAtt': ['MyResource', 'Arn'] } },
    });
  });

  it('should preserve date-shaped YAML values as strings', async () => {
    configurationPath = 'serverless.yml';
    await fsp.writeFile(
      configurationPath,
      [
        'service: test-date-strings',
        'provider:',
        '  name: aws',
        '  unquotedDate: 2020-12-12',
        "  quotedDate: '2020-12-12'",
        '  explicitlyTaggedDate: !!str 2020-12-12',
        '  unquotedDateTime: 2020-12-12T00:00:00Z',
        '  spacedDateTime: 2020-12-12 00:00:00',
        '',
      ].join('\n')
    );
    expect(await readConfiguration(configurationPath)).to.deep.equal({
      service: 'test-date-strings',
      provider: {
        name: 'aws',
        unquotedDate: '2020-12-12',
        quotedDate: '2020-12-12',
        explicitlyTaggedDate: '2020-12-12',
        unquotedDateTime: '2020-12-12T00:00:00Z',
        spacedDateTime: '2020-12-12 00:00:00',
      },
    });
  });

  it('should read "serverless.json"', async () => {
    configurationPath = 'serverless.json';
    const configuration = {
      service: 'test-json',
      provider: { name: 'aws' },
    };
    await fsp.writeFile(configurationPath, JSON.stringify(configuration));
    expect(await readConfiguration(configurationPath)).to.deep.equal(configuration);
  });

  it('should read "serverless.js" as CJS', async () => {
    configurationPath = 'serverless.js';
    const configuration = {
      service: 'test-js',
      provider: { name: 'aws' },
    };
    await fsp.writeFile(configurationPath, `module.exports = ${JSON.stringify(configuration)}`);
    expect(await readConfiguration(configurationPath)).to.deep.equal(configuration);
  });

  it('should read "serverless.cjs" as CJS', async () => {
    configurationPath = 'serverless.cjs';
    const configuration = {
      service: 'test-js',
      provider: { name: 'aws' },
    };
    await fsp.writeFile(configurationPath, `module.exports = ${JSON.stringify(configuration)}`);
    expect(await readConfiguration(configurationPath)).to.deep.equal(configuration);
  });

  it('should read "serverless.mjs" as ESM', async () => {
    configurationPath = 'serverless.mjs';
    const configuration = {
      service: 'test-js',
      provider: { name: 'aws' },
    };
    await fsp.writeFile(configurationPath, `export default ${JSON.stringify(configuration)}`);
    expect(await readConfiguration(configurationPath)).to.deep.equal(configuration);
  });

  it('should read ESM configuration whose path contains URL-significant characters', async () => {
    configurationPath = 'serverless#hash.mjs';
    const configuration = {
      service: 'test-js',
      provider: { name: 'aws' },
    };
    await fsp.writeFile(configurationPath, `export default ${JSON.stringify(configuration)}`);
    expect(await readConfiguration(configurationPath)).to.deep.equal(configuration);
  });

  it('should read "serverless.ts" as CJS', async () => {
    await ensureDir('node_modules');
    try {
      configurationPath = 'serverless.ts';
      const configuration = {
        service: 'test-ts',
        provider: { name: 'aws' },
      };
      await fsp.writeFile(configurationPath, `module.exports = ${JSON.stringify(configuration)}`);
      expect(await readConfiguration(configurationPath)).to.deep.equal(configuration);
    } finally {
      await remove('node_modules');
    }
  });

  it('should read "serverless.ts" as ESM', async () => {
    await ensureDir('node_modules');
    try {
      configurationPath = 'serverless.ts';
      const configuration = {
        service: 'test-ts',
        provider: { name: 'aws' },
      };
      await fsp.writeFile(configurationPath, `export default ${JSON.stringify(configuration)}`);
      expect(await readConfiguration(configurationPath)).to.deep.equal(configuration);
    } finally {
      await remove('node_modules');
    }
  });

  it('should support tsconfig.paths', async () => {
    await ensureDir('node_modules');
    const tsconfigPath = 'tsconfig.json';
    const servicePath = 'test.ts';

    try {
      await outputFile(
        tsconfigPath,
        JSON.stringify({
          compilerOptions: {
            paths: {
              '@/test': ['./test.ts'],
            },
          },
          include: ['**/*.ts'],
        })
      );

      await outputFile(servicePath, "export const service = 'test-ts';");

      configurationPath = 'serverless.ts';
      const configuration = {
        service: 'test-ts',
        provider: { name: 'aws' },
      };

      await fsp.writeFile(
        configurationPath,
        `import { service } from '@/test';

        export default {
          service: service,
          provider: { name: 'aws' },
        }`
      );
      const result = await readConfiguration(configurationPath);
      expect(result).to.deep.equal(configuration);
    } finally {
      await remove('node_modules');
      await fsp.unlink(tsconfigPath);
      await fsp.unlink(servicePath);
    }
  });

  it('should support deferred configuration result', async () => {
    // JS configurations are required (so immune to modules caching).
    // In this tests we cannot use same JS configuration path twice for testing
    configurationPath = 'serverless-deferred.js';
    const configuration = {
      service: 'test-deferred',
      provider: { name: 'aws' },
    };
    await fsp.writeFile(
      configurationPath,
      `module.exports = Promise.resolve(${JSON.stringify(configuration)})`
    );
    expect(await readConfiguration(configurationPath)).to.deep.equal(configuration);
  });

  it('should reject not existing file', async () => {
    await expect(readConfiguration('serverless.yml')).to.eventually.be.rejected.and.have.property(
      'code',
      'CONFIGURATION_NOT_FOUND'
    );
  });

  it('should reject unknown type', async () => {
    configurationPath = 'serverless.foo';

    await ensureFile(configurationPath);
    await expect(readConfiguration(configurationPath)).to.eventually.be.rejected.and.have.property(
      'code',
      'UNSUPPORTED_CONFIGURATION_TYPE'
    );
  });

  it('should reject YAML syntax error', async () => {
    configurationPath = 'serverless.yaml';
    await fsp.writeFile(configurationPath, 'service: test-yaml\np [\nr\novider:\n  name: aws\n');
    await expect(readConfiguration(configurationPath)).to.eventually.be.rejected.and.have.property(
      'code',
      'CONFIGURATION_PARSE_ERROR'
    );
  });

  it('should reject JSON syntax error', async () => {
    configurationPath = 'serverless.json';
    await fsp.writeFile(configurationPath, '{foom,sdfs}');
    await expect(readConfiguration(configurationPath)).to.eventually.be.rejected.and.have.property(
      'code',
      'CONFIGURATION_PARSE_ERROR'
    );
  });

  it('should reject JS initialization error', async () => {
    configurationPath = 'serverless-errored.js';
    await fsp.writeFile(configurationPath, 'throw new Error("Stop!")');
    await expect(readConfiguration(configurationPath)).to.eventually.be.rejected.and.have.property(
      'code',
      'CONFIGURATION_INITIALIZATION_ERROR'
    );
  });

  it('should reject non object configuration', async () => {
    configurationPath = 'serverless.json';
    await fsp.writeFile(configurationPath, JSON.stringify([]));
    await expect(readConfiguration(configurationPath)).to.eventually.be.rejected.and.have.property(
      'code',
      'INVALID_CONFIGURATION_EXPORT'
    );
  });
  it('should reject non JSON like structures', async () => {
    configurationPath = 'serverless-custom.js';
    await fsp.writeFile(configurationPath, 'exports.foo = exports');
    await expect(readConfiguration(configurationPath)).to.eventually.be.rejected.and.have.property(
      'code',
      'INVALID_CONFIGURATION_STRUCTURE'
    );
  });
});
