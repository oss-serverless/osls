import ensureString from 'type/string/ensure.js';
import ensurePlainObject from 'type/plain-object/ensure.js';
import ServerlessError from '../../serverless-error.ts';
import resolveMeta from './resolve-meta.ts';
import resolve from './resolve.ts';
import env2 from './sources/env.ts';
import file2 from './sources/file.ts';
import opt2 from './sources/opt.ts';
import self2 from './sources/self.ts';
import strToBool2 from './sources/str-to-bool.ts';
import getSls from './sources/instance-dependent/get-sls.ts';

const defaultSources = {
  env: env2,
  file: file2,
  opt: opt2,
  self: self2,
  strToBool: strToBool2,
  sls: getSls(),
};

const reportEventualErrors = (variablesMeta) => {
  const resolutionErrors = new Set(
    Array.from(variablesMeta.values(), ({ error }) => error).filter(Boolean)
  );

  if (!resolutionErrors.size) return;

  throw new ServerlessError(
    `Variables resolution errored with:${Array.from(
      resolutionErrors,
      (error) => `\n  - ${error.message}`
    )}`,
    'VARIABLES_RESOLUTION_ERROR'
  );
};

export default async ({ serviceDir, servicePath, configuration, options, sources = null }) => {
  serviceDir = ensureString(serviceDir || servicePath);
  ensurePlainObject(configuration);
  options = ensurePlainObject(options, { default: {} });

  const variablesMeta = resolveMeta(configuration);
  reportEventualErrors(variablesMeta);

  if (!sources) sources = defaultSources;
  await resolve({
    serviceDir,
    configuration,
    variablesMeta,
    sources,
    options,
    fulfilledSources: new Set(Object.keys(sources)),
  });

  reportEventualErrors(variablesMeta);
};
