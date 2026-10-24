'use strict';

const ensureString = require('type/string/ensure');
const isPlainObject = require('type/plain-object/is');
const path = require('path');
const { pathToFileURL } = require('url');
const fsp = require('fs').promises;
const yaml = require('js-yaml');
const cloudformationSchema = require('../utils/serverless-utils/cloudformation-schema');
const ServerlessError = require('../serverless-error');

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
    const ts = require('typescript');
    const fs = require('fs');
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
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          configDir
        );
        compilerOptions = { ...compilerOptions, ...parsed.options };
        // Ensure we can output CommonJS
        compilerOptions.module = ts.ModuleKind.CommonJS;
      }
    }
    
    const result = ts.transpileModule(source, {
      compilerOptions,
      fileName: configurationPath,
    });
    
    const Module = require('module');
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
          const tsx = require('tsx/cjs/api');
          const content = tsx.require(configurationPath, __filename);
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

module.exports = async (configurationPath) => {
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
