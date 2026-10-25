import * as chai from 'chai';
import resolveAjvValidate from '../../../../../lib/classes/config-schema-handler/resolve-ajv-validate.ts';
import getSchemaHash from '../../../../../lib/classes/config-schema-handler/schema-hash.ts';
import path from 'node:path';
import os from 'node:os';
import { promises as fsp } from 'node:fs';
import packageModule from 'ajv/package.json' with { type: 'json' };
import packageModule2 from 'ajv-formats/package.json' with { type: 'json' };
import esmock from 'esmock';

const expect = chai.expect;

const getExpectedCachePath = (schemaHash) => {
  return path.resolve(
    process.env.SLS_SCHEMA_CACHE_BASE_DIR || os.homedir(),
    `.serverless/artifacts/ajv-validate-ajv-${packageModule.version}-ajv-formats-${
      packageModule2.version
    }`,
    // Validators are cached as ES modules
    `${schemaHash}.mjs`
  );
};

describe('test/unit/lib/classes/ConfigSchemaHandler/resolveAjvValidate.test.ts', () => {
  const schema = {
    $id: 'https://example.com/person.schema.json',
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'TestSchema',
    type: 'object',
    properties: {
      firstProp: {
        type: 'string',
      },
    },
  };

  it('generates schema validation file', async () => {
    await resolveAjvValidate(schema);
    const schemaHash = getSchemaHash(schema);

    const fileStat = await fsp.lstat(getExpectedCachePath(schemaHash));
    expect(fileStat.isFile()).to.be.true;
  });

  it('regenerates schema validation file if schema changes', async () => {
    await resolveAjvValidate(schema);
    const updatedSchema = {
      ...schema,
      title: 'ChangedTitle',
    };
    await resolveAjvValidate(updatedSchema);
    const schemaHash = getSchemaHash(updatedSchema);

    const fileStat = await fsp.lstat(getExpectedCachePath(schemaHash));
    expect(fileStat.isFile()).to.be.true;
  });

  it('regenerates the cached validator module if removed externally', async () => {
    const realFsp = fsp;
    let injectedRemoval = false;
    const resolveAjvValidateFresh = (
      await esmock('../../../../../lib/classes/config-schema-handler/resolve-ajv-validate.ts', {
        'node:fs': {
          promises: {
            ...realFsp,
            readFile: async (filePath, ...args) => {
              if (!injectedRemoval && String(filePath).includes('ajv-validate')) {
                injectedRemoval = true;
                await realFsp.unlink(filePath);
              }
              return realFsp.readFile(filePath, ...args);
            },
          },
        },
      })
    ).default;

    const uniqueSchema = { ...schema, title: 'ExternallyRemovedCache' };
    const validate = await resolveAjvValidateFresh(uniqueSchema);

    expect(injectedRemoval).to.equal(true);
    expect(typeof validate).to.equal('function');
    expect(validate({ firstProp: 'value' })).to.equal(true);

    const schemaHash = getSchemaHash(uniqueSchema);
    expect((await realFsp.lstat(getExpectedCachePath(schemaHash))).isFile()).to.be.true;
  });

  it('validates date-time formats with ajv-formats v3 semantics', async () => {
    const validate = await resolveAjvValidate({
      $id: 'https://example.com/date-time.schema.json',
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'DateTimeSchema',
      type: 'object',
      properties: {
        timestamp: {
          type: 'string',
          format: 'date-time',
        },
      },
      required: ['timestamp'],
      additionalProperties: false,
    });

    expect(validate({ timestamp: '2026-05-02T00:00:00Z' })).to.equal(true);
    expect(validate.errors).to.equal(null);

    expect(validate({ timestamp: '2026-05-02T00:00:00' })).to.equal(false);
    expect(
      validate.errors.some(
        (error) =>
          error.instancePath === '/timestamp' &&
          error.keyword === 'format' &&
          error.params.format === 'date-time'
      )
    ).to.equal(true);
  });
});
