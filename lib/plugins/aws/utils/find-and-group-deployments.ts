'use strict';

const parseDeploymentObjectKey = require('./parse-deployment-object-key');

module.exports = (s3Response, prefix, service, stage) => {
  const grouped = new Map();

  for (const s3Object of s3Response.Contents || []) {
    const entry = parseDeploymentObjectKey(s3Object.Key, prefix, service, stage);
    if (!entry) continue;

    if (!grouped.has(entry.directory)) grouped.set(entry.directory, []);
    grouped.get(entry.directory).push(entry);
  }

  return Array.from(grouped.values());
};
