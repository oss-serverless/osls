import * as chai from 'chai';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import readConfiguration from '../../../../lib/configuration/read.ts';
import { createTmpDir, ensureFile, outputFile } from '../../../utils/fs.ts';
import { overrideCwd } from '../../../utils/process.ts';

const { expect } = chai;

const commonJsPackageJson = JSON.stringify({ type: 'commonjs' });
const esmPackageJson = JSON.stringify({ type: 'module' });

// import() caches modules by URL, so every JavaScript and TypeScript configuration is written
// to a fresh directory
const setupService = async (files) => {
  const serviceDir = createTmpDir();
  for (const [fileName, content] of Object.entries(files)) {
    await outputFile(path.join(serviceDir, fileName), content);
  }
  return serviceDir;
};

describe('test/unit/lib/configuration/read.test.ts', () => {
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
    const configuration = {
      service: 'test-js',
      provider: { name: 'aws' },
    };
    const serviceDir = await setupService({
      'serverless.js': `module.exports = ${JSON.stringify(configuration)}`,
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.js'))).to.deep.equal(
      configuration
    );
  });

  it('should read "serverless.js" as CJS in a "type": "commonjs" package', async () => {
    const configuration = {
      service: 'test-js',
      provider: { name: 'aws' },
    };
    const serviceDir = await setupService({
      'package.json': commonJsPackageJson,
      'serverless.js': `module.exports = ${JSON.stringify(configuration)}`,
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.js'))).to.deep.equal(
      configuration
    );
  });

  it('should read "serverless.js" as ESM in a "type": "module" package', async () => {
    const configuration = {
      service: 'test-js',
      provider: { name: 'aws' },
    };
    const serviceDir = await setupService({
      'package.json': esmPackageJson,
      'serverless.js': `export default ${JSON.stringify(configuration)}`,
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.js'))).to.deep.equal(
      configuration
    );
  });

  it('should read "serverless.cjs" as CJS', async () => {
    const configuration = {
      service: 'test-js',
      provider: { name: 'aws' },
    };
    // A "type": "module" package must not affect ".cjs" files
    const serviceDir = await setupService({
      'package.json': esmPackageJson,
      'serverless.cjs': `module.exports = ${JSON.stringify(configuration)}`,
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.cjs'))).to.deep.equal(
      configuration
    );
  });

  it('should read "serverless.mjs" as ESM', async () => {
    const configuration = {
      service: 'test-js',
      provider: { name: 'aws' },
    };
    // A "type": "commonjs" package must not affect ".mjs" files
    const serviceDir = await setupService({
      'package.json': commonJsPackageJson,
      'serverless.mjs': `export default ${JSON.stringify(configuration)}`,
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.mjs'))).to.deep.equal(
      configuration
    );
  });

  it('should read ESM configuration whose path contains URL-significant characters', async () => {
    const configuration = {
      service: 'test-js',
      provider: { name: 'aws' },
    };
    const serviceDir = await setupService({
      'serverless#hash.mjs': `export default ${JSON.stringify(configuration)}`,
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless#hash.mjs'))).to.deep.equal(
      configuration
    );
  });

  it('should read "serverless.ts" as CJS', async () => {
    const configuration = {
      service: 'test-ts',
      provider: { name: 'aws' },
    };
    const serviceDir = await setupService({
      'package.json': commonJsPackageJson,
      'serverless.ts': `const configuration: { service: string } = ${JSON.stringify(
        configuration
      )};\nmodule.exports = configuration;\n`,
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.ts'))).to.deep.equal(
      configuration
    );
  });

  it('should read "serverless.ts" as ESM', async () => {
    const configuration = {
      service: 'test-ts',
      provider: { name: 'aws' },
    };
    const serviceDir = await setupService({
      'package.json': esmPackageJson,
      'serverless.ts': `const configuration: { service: string } = ${JSON.stringify(
        configuration
      )};\nexport default configuration;\n`,
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.ts'))).to.deep.equal(
      configuration
    );
  });

  it('should read "serverless.mts" as ESM', async () => {
    const configuration = {
      service: 'test-mts',
      provider: { name: 'aws' },
    };
    const serviceDir = await setupService({
      'package.json': commonJsPackageJson,
      'serverless.mts': `const configuration: { service: string } = ${JSON.stringify(
        configuration
      )};\nexport default configuration;\n`,
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.mts'))).to.deep.equal(
      configuration
    );
  });

  it('should fall back to tsx for TypeScript that type stripping cannot run', async () => {
    const serviceDir = await setupService({
      'package.json': esmPackageJson,
      'serverless.ts': [
        "enum Runtime { Node = 'nodejs22.x' }",
        "export default { service: 'test-ts-enum', provider: { name: 'aws', runtime: Runtime.Node } };",
        '',
      ].join('\n'),
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.ts'))).to.deep.equal({
      service: 'test-ts-enum',
      provider: { name: 'aws', runtime: 'nodejs22.x' },
    });
  });

  it('should fall back to tsx for ESM syntax "serverless.ts" in a CommonJS package', async () => {
    const serviceDir = await setupService({
      'package.json': commonJsPackageJson,
      'serverless.ts': [
        "enum Runtime { Node = 'nodejs22.x' }",
        "export default { service: 'test-ts-cjs-enum', provider: { name: 'aws', runtime: Runtime.Node } };",
        '',
      ].join('\n'),
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.ts'))).to.deep.equal({
      service: 'test-ts-cjs-enum',
      provider: { name: 'aws', runtime: 'nodejs22.x' },
    });
  });

  it('should support tsconfig.paths', async () => {
    const serviceDir = await setupService({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          paths: {
            '@/test': ['./test.ts'],
          },
        },
        include: ['**/*.ts'],
      }),
      'test.ts': "export const service = 'test-ts';",
      'serverless.ts': `import { service } from '@/test';

        export default {
          service: service,
          provider: { name: 'aws' },
        }`,
    });
    // tsx resolves "tsconfig.json" from the current working directory
    const result = await overrideCwd(serviceDir, () =>
      readConfiguration(path.join(serviceDir, 'serverless.ts'))
    );
    expect(result).to.deep.equal({
      service: 'test-ts',
      provider: { name: 'aws' },
    });
  });

  it('should support deferred configuration result', async () => {
    const configuration = {
      service: 'test-deferred',
      provider: { name: 'aws' },
    };
    const serviceDir = await setupService({
      'serverless.js': `module.exports = Promise.resolve(${JSON.stringify(configuration)})`,
    });
    expect(await readConfiguration(path.join(serviceDir, 'serverless.js'))).to.deep.equal(
      configuration
    );
  });

  it('should reject not existing file', async () => {
    await expect(readConfiguration('serverless.yml')).to.eventually.be.rejected.and.have.property(
      'code',
      'CONFIGURATION_NOT_FOUND'
    );
    await expect(readConfiguration('serverless.js')).to.eventually.be.rejected.and.have.property(
      'code',
      'CONFIGURATION_NOT_FOUND'
    );
    await expect(readConfiguration('serverless.ts')).to.eventually.be.rejected.and.have.property(
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
    const serviceDir = await setupService({
      'serverless-errored.js': 'throw new Error("Stop!")',
    });
    await expect(
      readConfiguration(path.join(serviceDir, 'serverless-errored.js'))
    ).to.eventually.be.rejected.and.have.property('code', 'CONFIGURATION_INITIALIZATION_ERROR');
  });

  it('should reject TypeScript initialization error', async () => {
    const serviceDir = await setupService({
      'package.json': esmPackageJson,
      'serverless-errored.ts': 'const message: string = "Stop!";\nthrow new Error(message);\n',
    });
    await expect(
      readConfiguration(path.join(serviceDir, 'serverless-errored.ts'))
    ).to.eventually.be.rejected.and.have.property('code', 'CONFIGURATION_INITIALIZATION_ERROR');
  });

  it('should reject non object configuration', async () => {
    configurationPath = 'serverless.json';
    await fsp.writeFile(configurationPath, JSON.stringify([]));
    await expect(readConfiguration(configurationPath)).to.eventually.be.rejected.and.have.property(
      'code',
      'INVALID_CONFIGURATION_EXPORT'
    );
  });
  it('should reject ES module configuration without default export', async () => {
    const serviceDir = await setupService({
      'serverless.mjs': "export const service = 'test-js';",
    });
    await expect(
      readConfiguration(path.join(serviceDir, 'serverless.mjs'))
    ).to.eventually.be.rejected.and.have.property('code', 'INVALID_CONFIGURATION_EXPORT');
  });

  it('should reject non JSON like structures', async () => {
    const serviceDir = await setupService({
      'serverless-custom.js': 'exports.foo = exports',
    });
    await expect(
      readConfiguration(path.join(serviceDir, 'serverless-custom.js'))
    ).to.eventually.be.rejected.and.have.property('code', 'INVALID_CONFIGURATION_STRUCTURE');
  });
});
