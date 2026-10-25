'use strict';

// https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-bucket-intro.html
const s3UriPattern = /^s3:\/\/(?<bucket>[^/?#@\s]+)\/(?<key>[^?#]+)(?:[?#].*)?$/;
const urlPattern = /^(?:https?:\/\/)?(?<host>[^/?#@\s]+)(?<path>\/[^?#]+)(?:[?#].*)?$/i;
const virtualHostedStyleHostPattern = /^(?<bucket>.+)\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i;
const pathStyleHostPattern = /^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i;

const pathStylePathPattern = /^\/(?<bucket>[^/]+)\/(?<key>.+)$/;

module.exports = (url) => {
  if (typeof url !== 'string') return null;

  const s3UriMatch = url.match(s3UriPattern);
  if (s3UriMatch) {
    return {
      Bucket: s3UriMatch.groups.bucket,
      Key: s3UriMatch.groups.key,
    };
  }

  const urlMatch = url.match(urlPattern);
  if (!urlMatch) return null;

  const { host, path } = urlMatch.groups;
  const virtualHostedStyleHostMatch = host.match(virtualHostedStyleHostPattern);

  if (virtualHostedStyleHostMatch) {
    return {
      Bucket: virtualHostedStyleHostMatch.groups.bucket,
      Key: path.slice(1),
    };
  }

  if (pathStyleHostPattern.test(host)) {
    const pathStylePathMatch = path.match(pathStylePathPattern);
    if (!pathStylePathMatch) return null;

    return {
      Bucket: pathStylePathMatch.groups.bucket,
      Key: pathStylePathMatch.groups.key,
    };
  }

  return null;
};
