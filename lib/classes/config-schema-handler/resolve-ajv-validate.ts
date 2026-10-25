import ajv2 from 'ajv';
import path from 'node:path';
import os from 'node:os';
import Module from 'node:module';
import distStandalone from 'ajv/dist/standalone';
import log2 from '../../utils/serverless-utils/log.ts';
import { promises as fsp } from 'node:fs';
import resolveTmpdir from '../../utils/resolve-process-tmp-dir.ts';
import safeMoveFile from '../../utils/fs/safe-move-file.ts';
import getSchemaHash from './schema-hash.ts';
import ensureExists from '../../utils/ensure-exists.ts';
import ServerlessError from '../../serverless-error.ts';
import packageModule from 'ajv/package.json' with { type: 'json' };
import packageModule2 from 'ajv-formats/package.json' with { type: 'json' };
const Ajv = ajv2.default;
const standaloneCode = distStandalone.default;
const { log } = log2;
const ajvVersion = packageModule.version;
const ajvFormatsVersion = packageModule2.version;

const getCacheDir = () => {
  return path.resolve(
    process.env.SLS_SCHEMA_CACHE_BASE_DIR || os.homedir(),
    `.serverless/artifacts/ajv-validate-ajv-${ajvVersion}-ajv-formats-${ajvFormatsVersion}`
  );
};

// The filename must point inside this package so that requires in the
// generated code resolve against our dependencies and not the cache location
const loadModuleFromString = (code, filename) => {
  const generatedModule = new Module(filename);
  generatedModule.filename = filename;
  generatedModule.paths = Module._nodeModulePaths(path.dirname(filename));
  generatedModule._compile(code, filename);
  return generatedModule.exports;
};

// Validators are cached by schema hash for the purpose
// of speeding up tests and reducing their memory footprint.
// If that solution proves to not be enough, we can improve it
// with `uni-global` package.
const cachedValidatorsBySchemaHash = {};

const getValidate = async (schema) => {
  const schemaHash = getSchemaHash(schema);
  if (cachedValidatorsBySchemaHash[schemaHash]) {
    return cachedValidatorsBySchemaHash[schemaHash];
  }
  const filename = `${schemaHash}.js`;
  const cachePath = path.resolve(getCacheDir(), filename);

  const generate = async () => {
    const ajv = new Ajv({
      allErrors: true,
      coerceTypes: 'array',
      verbose: true,
      strict: true,
      strictRequired: false,
      code: { source: true },
    });
    (await import('ajv-formats')).default.default(ajv);
    // Ensure AJV related packages work well when there are multiple AJV installations around
    // See: https://github.com/ajv-validator/ajv/issues/1390#issuecomment-763138202
    ajv.opts.code.formats = Ajv._`require("ajv-formats/dist/formats").fullFormats`;
    ajv.addKeyword((await import('./regexp-keyword.ts')).default);
    let validate;
    try {
      validate = ajv.compile(schema);
    } catch (err) {
      if (err.message && err.message.includes('strict mode')) {
        throw new ServerlessError(
          'At least one of the plugins defines a validation schema that is invalid. Try disabling plugins one by one to identify the problematic plugin and report it to the plugin maintainers.',
          'SCHEMA_FAILS_STRICT_MODE'
        );
      }
      throw err;
    }
    const moduleCode = standaloneCode(ajv, validate);

    const tmpCachePath = path.resolve(await resolveTmpdir(), filename);
    await fsp.writeFile(tmpCachePath, moduleCode);
    await safeMoveFile(tmpCachePath, cachePath);
  };
  const loadValidatorModuleCode = async () => {
    await ensureExists(cachePath, generate);
    return fsp.readFile(cachePath, 'utf-8');
  };

  let loadedModuleCode;
  try {
    loadedModuleCode = await loadValidatorModuleCode();
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
    // The cached validator lives in ~/.serverless/artifacts, which can be
    // cleaned up externally at any time. Treat a read of a just-removed file
    // as a cache miss: regenerate once and retry.
    loadedModuleCode = await loadValidatorModuleCode();
  }
  const validator = loadModuleFromString(
    loadedModuleCode,
    path.resolve(import.meta.dirname, `[generated-ajv-validate]${filename}`)
  );
  if (typeof validator !== 'function') {
    log.error('Unexpected validator %o, resolved from source %s', validator, loadedModuleCode);
    throw new Error(
      'Unexpected non-function AJV validator type. Please report at https://github.com/oss-serverless/osls including all the logs output'
    );
  }
  cachedValidatorsBySchemaHash[schemaHash] = validator;
  return validator;
};

export default getValidate;
