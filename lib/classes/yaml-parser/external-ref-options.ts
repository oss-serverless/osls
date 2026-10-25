import path from 'node:path';
import { throwOptionsError } from './external-ref-errors.ts';
import { normalizeFileRefOptions } from './file-ref-policy.ts';
import { assertKnownOptions, assertOptionsObject } from './option-validation.ts';

const normalizeStringArrayOption = (value, optionName) => {
  if (value === undefined) return [];

  const values = Array.isArray(value) ? value : [value];

  return values.map((item) => {
    if (typeof item !== 'string') {
      throwOptionsError(`YAML parser option ${optionName} must contain only strings.`);
    }

    return item;
  });
};

const normalizeAllowedUnsafeHost = (host) => {
  const trimmedHost = host.trim().toLowerCase();

  if (!trimmedHost) return trimmedHost;
  if (!trimmedHost.includes('://') && !trimmedHost.startsWith('//')) return trimmedHost;

  try {
    return new URL(trimmedHost.startsWith('//') ? `http:${trimmedHost}` : trimmedHost).host;
  } catch {
    return trimmedHost;
  }
};

const normalizeHttpRefOptions = (options = {}) => {
  assertOptionsObject(options, 'externalRefs.http');
  assertKnownOptions(options, 'externalRefs.http', ['allowUnsafeUrls', 'allowedUnsafeHosts']);

  if (options.allowUnsafeUrls !== undefined && typeof options.allowUnsafeUrls !== 'boolean') {
    throwOptionsError('YAML parser option externalRefs.http.allowUnsafeUrls must be a boolean.');
  }

  return {
    allowUnsafeUrls: options.allowUnsafeUrls === undefined ? false : options.allowUnsafeUrls,
    allowedUnsafeHosts: normalizeStringArrayOption(
      options.allowedUnsafeHosts,
      'externalRefs.http.allowedUnsafeHosts'
    )
      .map(normalizeAllowedUnsafeHost)
      .filter(Boolean),
  };
};

const normalizeExternalRefOptions = async (yamlFilePath, options = {}) => {
  assertOptionsObject(options, 'options');
  assertKnownOptions(options, 'options', ['externalRefs']);

  const documentDir = path.dirname(path.resolve(yamlFilePath));
  const externalRefs = options.externalRefs === undefined ? {} : options.externalRefs;

  assertOptionsObject(externalRefs, 'externalRefs');
  assertKnownOptions(externalRefs, 'externalRefs', ['file', 'http']);

  return {
    file: await normalizeFileRefOptions(
      documentDir,
      externalRefs.file === undefined ? {} : externalRefs.file
    ),
    http: normalizeHttpRefOptions(externalRefs.http === undefined ? {} : externalRefs.http),
  };
};

export { normalizeExternalRefOptions, normalizeHttpRefOptions };

export default {
  normalizeExternalRefOptions,
  normalizeHttpRefOptions,
};
