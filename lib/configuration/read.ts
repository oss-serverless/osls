import ensureString from 'type/string/ensure.js';
import isPlainObject from 'type/plain-object/is.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promises as fsp } from 'node:fs';
import * as yaml from 'js-yaml';
import cloudformationSchema from '../utils/serverless-utils/cloudformation-schema.ts';
import ServerlessError from '../serverless-error.ts';

const readConfigurationFile = async (configurationPath) => {
  try {
    return await fsp.readFile(configurationPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new ServerlessError(
        `Cannot parse "${path.basename(configurationPath)}": File not found`,
        'CONFIGURATION_NOT_FOUND'
      );
    }
    throw new ServerlessError(
      `Cannot parse "${path.basename(configurationPath)}": ${error.message}`,
      'CONFIGURATION_NOT_ACCESSIBLE'
    );
  }
};

const ensureConfigurationFile = async (configurationPath) => {
  try {
    if ((await fsp.stat(configurationPath)).isFile()) return;
  } catch {
    // Reported below
  }
  throw new ServerlessError(
    `Cannot load "${path.basename(configurationPath)}": File not found`,
    'CONFIGURATION_NOT_FOUND'
  );
};

// CommonJS configurations come through Node's interop as the default export. ES modules
// transpiled to CommonJS (eg. by tsx, when the service is not `"type": "module"`) carry
// their default export one level deeper, marked with `__esModule`
const unwrapDefaultExport = (namespace) => {
  const value = namespace.default;
  return value && value.__esModule && 'default' in value ? value.default : value;
};

const importConfiguration = async (configurationPath) =>
  unwrapDefaultExport(await import(pathToFileURL(configurationPath).href));

// Errors that Node raises while loading or linking a TypeScript module, before any of its code
// runs, when the module needs more than type stripping (enums, namespaces, parameter
// properties, extensionless imports, tsconfig paths) or type stripping is disabled
const nativeTypeScriptLimitationCodes = new Set([
  'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
  'ERR_INVALID_TYPESCRIPT_SYNTAX',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_MODULE_NOT_FOUND',
  'ERR_UNSUPPORTED_DIR_IMPORT',
  'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING',
]);

const importTypeScriptConfiguration = async (configurationPath) => {
  try {
    // Node.js 22.18+ and 24 run TypeScript natively through type stripping
    return await importConfiguration(configurationPath);
  } catch (error) {
    if (
      !(error instanceof SyntaxError) &&
      !nativeTypeScriptLimitationCodes.has(error && error.code)
    ) {
      throw error;
    }
  }
  const { tsImport } = await import('tsx/esm/api');
  return unwrapDefaultExport(
    await tsImport(pathToFileURL(configurationPath).href, import.meta.url)
  );
};

const loadModuleConfiguration = async (configurationPath, load) => {
  await ensureConfigurationFile(configurationPath);
  try {
    return await load(configurationPath);
  } catch (error) {
    throw new ServerlessError(
      `Cannot load "${path.basename(configurationPath)}": Initialization error: ${
        error && error.stack ? error.stack : error
      }`,
      'CONFIGURATION_INITIALIZATION_ERROR'
    );
  }
};

const parseConfigurationFile = async (configurationPath) => {
  switch (path.extname(configurationPath)) {
    case '.yml':
    case '.yaml': {
      const content = await readConfigurationFile(configurationPath);
      try {
        return yaml.load(content, {
          filename: configurationPath,
          schema: cloudformationSchema,
        });
      } catch (error) {
        throw new ServerlessError(
          `Cannot parse "${path.basename(configurationPath)}": ${error.message}`,
          'CONFIGURATION_PARSE_ERROR'
        );
      }
    }
    case '.json': {
      const content = await readConfigurationFile(configurationPath);
      try {
        return JSON.parse(content);
      } catch (error) {
        throw new ServerlessError(
          `Cannot parse "${path.basename(configurationPath)}": JSON parse error: ${error.message}`,
          'CONFIGURATION_PARSE_ERROR'
        );
      }
    }
    case '.ts':
    case '.mts':
      return loadModuleConfiguration(configurationPath, importTypeScriptConfiguration);
    case '.cjs':
    case '.js':
    case '.mjs':
      return loadModuleConfiguration(configurationPath, importConfiguration);
    default:
      throw new ServerlessError(
        `Cannot parse "${path.basename(configurationPath)}": Unsupported file extension`,
        'UNSUPPORTED_CONFIGURATION_TYPE'
      );
  }
};

export default async (configurationPath) => {
  configurationPath = path.resolve(
    ensureString(configurationPath, {
      name: 'configurationPath',
    })
  );

  let configuration = await parseConfigurationFile(configurationPath);

  if (!isPlainObject(configuration)) {
    throw new ServerlessError(
      `Invalid configuration at "${path.basename(configurationPath)}": Plain object expected`,
      'INVALID_CONFIGURATION_EXPORT'
    );
  }

  // Ensure no internal complex objects and no circural references
  try {
    configuration = JSON.parse(JSON.stringify(configuration));
  } catch (error) {
    throw new ServerlessError(
      `Invalid configuration at "${path.basename(
        configurationPath
      )}": Plain JSON structure expected, when parsing observed error: ${error.message}`,
      'INVALID_CONFIGURATION_STRUCTURE'
    );
  }
  return configuration;
};
