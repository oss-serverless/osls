'use strict';

const Ajv = require('ajv').default;
const path = require('path');
const os = require('os');
const Module = require('module');
const standaloneCode = require('ajv/dist/standalone').default;
const { log } = require('../../utils/serverless-utils/log');
const fsp = require('fs').promises;
const resolveTmpdir = require('../../utils/resolve-process-tmp-dir');
const safeMoveFile = require('../../utils/fs/safe-move-file');
const getSchemaHash = require('./schema-hash');
const ensureExists = require('../../utils/ensure-exists');
const ServerlessError = require('../../serverless-error');
const ajvVersion = require('ajv/package').version;
const ajvFormatsVersion = require('ajv-formats/package').version;

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
    require('ajv-formats').default(ajv);
    // Ensure AJV related packages work well when there are multiple AJV installations around
    // See: https://github.com/ajv-validator/ajv/issues/1390#issuecomment-763138202
    ajv.opts.code.formats = Ajv._`require("ajv-formats/dist/formats").fullFormats`;
    ajv.addKeyword(require('./regexp-keyword'));
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
    path.resolve(__dirname, `[generated-ajv-validate]${filename}`)
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

module.exports = getValidate;
