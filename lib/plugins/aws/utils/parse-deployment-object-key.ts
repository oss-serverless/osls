'use strict';

const isDeploymentDirToken = RegExp.prototype.test.bind(
  /^[\d]+-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
);

module.exports = (key, prefix, service, stage) => {
  if (!key) return null;

  const base = `${prefix}/${service}/${stage}/`;
  if (!key.startsWith(base)) return null;

  const rest = key.slice(base.length);
  const slashIndex = rest.indexOf('/');
  if (slashIndex <= 0) return null;

  const directory = rest.slice(0, slashIndex);
  const file = rest.slice(slashIndex + 1);
  if (!isDeploymentDirToken(directory) || !file) return null;

  return { directory, file };
};
