import ensureString from 'type/string/ensure.js';
import isPlainObject from 'type/plain-object/is.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promises as fsp } from 'node:fs';
import * as yaml from 'js-yaml';
import cloudformationSchema from '../utils/serverless-utils/cloudformation-schema.ts';
import ServerlessError from '../serverless-error.ts';
import typescript from 'typescript';
import fs2 from 'node:fs';
import module2 from 'node:module';

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

const loadWithTypeScript = (configurationPath) => {
  try {
    const ts = typescript;
    const fs = fs2;
    const source = fs.readFileSync(configurationPath, 'utf8');

    const configDir = path.dirname(path.resolve(configurationPath));
    const tsconfigPath = ts.findConfigFile(configDir, ts.sys.fileExists, 'tsconfig.json');

    let compilerOptions = {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowJs: true,
    };

    if (tsconfigPath) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (!configFile.error) {
        const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, configDir);
        compilerOptions = { ...compilerOptions, ...parsed.options };
        // Ensure we can output CommonJS
        compilerOptions.module = ts.ModuleKind.CommonJS;
      }
    }

    const result = ts.transpileModule(source, {
      compilerOptions,
      fileName: configurationPath,
    });

    const Module = module2;
    const filename = configurationPath;
    const dirname = path.dirname(configurationPath);

    const mod = new Module(filename);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(dirname);
    mod._compile(result.outputText, filename);

    const content = mod.exports;
    return content.default !== undefined ? content.default : content;
  } catch (error) {
    throw error;
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
    case '.mts': {
      try {
        try {
          const content = loadWithTypeScript(configurationPath);
          return content;
        } catch (tsError) {
          const tsx = await import('tsx/cjs/api');
          const content = tsx.require(configurationPath, import.meta.filename);
          return content.default || content;
        }
      } catch (error) {
        throw new ServerlessError(
          `Cannot parse "${path.basename(configurationPath)}": Initialization error: ${
            error && error.stack ? error.stack : error
          }`,
          'CONFIGURATION_INITIALIZATION_ERROR'
        );
      }
    }
    // fallthrough
    case '.cjs':
    case '.js': {
      const configurationEventuallyDeferred = (() => {
        try {
          require.resolve(configurationPath);
        } catch {
          throw new ServerlessError(
            `Cannot load "${path.basename(configurationPath)}": File not found`,
            'CONFIGURATION_NOT_FOUND'
          );
        }
        try {
          return require(configurationPath);
        } catch (error) {
          throw new ServerlessError(
            `Cannot load "${path.basename(configurationPath)}": Initialization error: ${
              error && error.stack ? error.stack : error
            }`,
            'CONFIGURATION_INITIALIZATION_ERROR'
          );
        }
      })();
      try {
        return await configurationEventuallyDeferred;
      } catch (error) {
        throw new ServerlessError(
          `Cannot load "${path.basename(configurationPath)}": Initialization error: ${
            error && error.stack ? error.stack : error
          }`,
          'CONFIGURATION_INITIALIZATION_ERROR'
        );
      }
    }
    case '.mjs': {
      try {
        require.resolve(configurationPath);
      } catch {
        throw new ServerlessError(
          `Cannot load "${path.basename(configurationPath)}": File not found`,
          'CONFIGURATION_NOT_FOUND'
        );
      }
      try {
        return (await import(pathToFileURL(configurationPath).href)).default;
      } catch (error) {
        throw new ServerlessError(
          `Cannot load "${path.basename(configurationPath)}": Initialization error: ${
            error && error.stack ? error.stack : error
          }`,
          'CONFIGURATION_INITIALIZATION_ERROR'
        );
      }
    }
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
