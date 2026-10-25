'use strict';

const path = require('path');
const semver = require('semver');
const ServerlessError = require('../../lib/serverless-error');

const maxNpmPackageNameLength = 214;
const npmPackageNamePattern = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const npmDistTagPattern = /^[A-Za-z][A-Za-z0-9._-]*$/;
const forbiddenVersionCharactersPattern = /[\0\r\n"'`$;&\\/:]/;

const validatePluginName = (name) => {
  if (
    typeof name !== 'string' ||
    name.length > maxNpmPackageNameLength ||
    !npmPackageNamePattern.test(name)
  ) {
    throw new ServerlessError(
      `Invalid plugin name "${name}". Plugin names must be valid npm package names.`,
      'INVALID_PLUGIN_NAME'
    );
  }
};

const splitPackageSpec = (input) => {
  if (input.startsWith('@')) {
    const slashIndex = input.indexOf('/');
    const atIndex = slashIndex === -1 ? -1 : input.indexOf('@', slashIndex + 1);
    if (atIndex === -1) return { name: input, version: undefined };
    return { name: input.slice(0, atIndex), version: input.slice(atIndex + 1) };
  }

  const atIndex = input.indexOf('@');
  if (atIndex === -1) return { name: input, version: undefined };
  return { name: input.slice(0, atIndex), version: input.slice(atIndex + 1) };
};

const validateInstallVersion = (version) => {
  if (version == null) return 'latest';

  if (version === '' || forbiddenVersionCharactersPattern.test(version)) {
    throw new ServerlessError(`Invalid plugin version "${version}".`, 'INVALID_PLUGIN_VERSION');
  }

  if (!semver.validRange(version) && !npmDistTagPattern.test(version)) {
    throw new ServerlessError(`Invalid plugin version "${version}".`, 'INVALID_PLUGIN_VERSION');
  }

  return version;
};

const parsePluginInstallSpec = (raw) => {
  if (typeof raw !== 'string' || raw.trim() !== raw || raw === '') {
    throw new ServerlessError(`Invalid plugin spec "${raw}".`, 'INVALID_PLUGIN_NAME');
  }

  const { name, version } = splitPackageSpec(raw);
  validatePluginName(name);

  const normalizedVersion = validateInstallVersion(version);

  return {
    name,
    version: normalizedVersion,
    installSpec: `${name}@${normalizedVersion}`,
  };
};

const parsePluginUninstallSpec = (raw) => {
  if (typeof raw !== 'string' || raw.trim() !== raw || raw === '') {
    throw new ServerlessError(`Invalid plugin name "${raw}".`, 'INVALID_PLUGIN_NAME');
  }

  const { name, version } = splitPackageSpec(raw);
  validatePluginName(name);

  if (version != null) {
    throw new ServerlessError(
      'Plugin uninstall accepts a package name, not a versioned package spec.',
      'INVALID_PLUGIN_UNINSTALL_SPEC'
    );
  }

  return { name };
};

module.exports = {
  validate({ serviceDir }) {
    if (!serviceDir) {
      throw new ServerlessError(
        'This command can only be run inside a service directory',
        'MISSING_SERVICE_DIRECTORY'
      );
    }
  },

  getServerlessFilePath({ serviceDir, configurationFilename }) {
    if (configurationFilename) {
      return path.resolve(serviceDir, configurationFilename);
    }
    throw new ServerlessError(
      'Could not find any serverless service definition file.',
      'MISSING_SERVICE_CONFIGURATION_FILE'
    );
  },

  parsePluginInstallSpec,
  parsePluginUninstallSpec,
  splitPackageSpec,
  validatePluginName,
};
