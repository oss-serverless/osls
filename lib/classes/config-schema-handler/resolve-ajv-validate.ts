import ajvModule from 'ajv';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import standaloneModule from 'ajv/dist/standalone/index.js';
import addFormats from 'ajv-formats';
import { log } from '../../utils/serverless-utils/log.ts';
import resolveFrom from '../../utils/resolve-from.ts';
import regexpKeyword from './regexp-keyword.ts';
import { promises as fsp } from 'node:fs';
import resolveTmpdir from '../../utils/resolve-process-tmp-dir.ts';
import safeMoveFile from '../../utils/fs/safe-move-file.ts';
import getSchemaHash from './schema-hash.ts';
import ensureExists from '../../utils/ensure-exists.ts';
import ServerlessError from '../../serverless-error.ts';
import ajvPackageJson from 'ajv/package.json' with { type: 'json' };
import ajvFormatsPackageJson from 'ajv-formats/package.json' with { type: 'json' };
const Ajv = ajvModule.default;
const standaloneCode = standaloneModule.default;
const ajvVersion = ajvPackageJson.version;
const ajvFormatsVersion = ajvFormatsPackageJson.version;

const getCacheDir = () => {
  return path.resolve(
    process.env.SLS_SCHEMA_CACHE_BASE_DIR || os.homedir(),
    `.serverless/artifacts/ajv-validate-ajv-${ajvVersion}-ajv-formats-${ajvFormatsVersion}`
  );
};

// AJV standalone code references its runtime helpers (and the formats configured below) with
// `require("...")` calls. They are replaced with imports of the files those requests resolve to
// from this package, so they resolve against our dependencies and not the cache location, and
// the validator is evaluated as an ES module. The cached code stays free of absolute paths
const importValidatorModule = async (code) => {
  const dependencies = new Map();
  const body = code.replace(/require\("([^"\\]+)"\)/g, (match, request) => {
    if (!dependencies.has(request)) dependencies.set(request, `__dependency${dependencies.size}`);
    return dependencies.get(request);
  });
  const imports = Array.from(dependencies, ([request, name]) => {
    const url = pathToFileURL(resolveFrom(import.meta.dirname, request)).href;
    return `import ${name} from ${JSON.stringify(url)};`;
  });
  const source = `${imports.join('\n')}\n${body}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
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
  const filename = `${schemaHash}.mjs`;
  const cachePath = path.resolve(getCacheDir(), filename);

  const generate = async () => {
    const ajv = new Ajv({
      allErrors: true,
      coerceTypes: 'array',
      verbose: true,
      strict: true,
      strictRequired: false,
      code: { source: true, esm: true },
    });
    addFormats.default(ajv);
    // Ensure AJV related packages work well when there are multiple AJV installations around
    // See: https://github.com/ajv-validator/ajv/issues/1390#issuecomment-763138202
    ajv.opts.code.formats = Ajv._`require("ajv-formats/dist/formats").fullFormats`;
    ajv.addKeyword(regexpKeyword);
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
  const validator = (await importValidatorModule(loadedModuleCode)).default;
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
