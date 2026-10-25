'use strict';

const dns = require('dns');
const dnsPromises = dns.promises;
const net = require('net');
const { Agent } = require('undici');
const {
  createExternalRefAccessDeniedError,
  denyExternalRef,
  getExternalRefAccessDeniedError,
} = require('./external-ref-errors');

const DEFAULT_HTTP_REDIRECTS = 5;
const DEFAULT_HTTP_TIMEOUT = 60000;
const HTTP_REF_POLICY_HINT =
  'The code calling yamlParser.parse can allow this host by adding it to ' +
  'externalRefs.http.allowedUnsafeHosts.';
const UNSAFE_HOSTNAME_SUFFIXES = ['.local', '.internal', '.intranet', '.corp', '.home', '.lan'];
const UNSAFE_IP_BLOCKS = [
  ['subnet', '0.0.0.0', 8, 'ipv4'],
  ['subnet', '10.0.0.0', 8, 'ipv4'],
  ['subnet', '100.64.0.0', 10, 'ipv4'],
  ['subnet', '127.0.0.0', 8, 'ipv4'],
  ['subnet', '169.254.0.0', 16, 'ipv4'],
  ['subnet', '172.16.0.0', 12, 'ipv4'],
  ['subnet', '192.0.0.0', 24, 'ipv4'],
  ['subnet', '192.0.2.0', 24, 'ipv4'],
  ['subnet', '192.168.0.0', 16, 'ipv4'],
  ['subnet', '198.18.0.0', 15, 'ipv4'],
  ['subnet', '198.51.100.0', 24, 'ipv4'],
  ['subnet', '203.0.113.0', 24, 'ipv4'],
  ['subnet', '224.0.0.0', 4, 'ipv4'],
  ['subnet', '240.0.0.0', 4, 'ipv4'],
  ['address', '::', 'ipv6'],
  ['address', '::1', 'ipv6'],
  ['subnet', '64:ff9b::', 96, 'ipv6'],
  ['subnet', '64:ff9b:1::', 48, 'ipv6'],
  ['subnet', '100::', 64, 'ipv6'],
  ['subnet', '2001::', 32, 'ipv6'],
  ['subnet', '2001:db8::', 32, 'ipv6'],
  ['subnet', '2002::', 16, 'ipv6'],
  ['subnet', 'fc00::', 7, 'ipv6'],
  ['subnet', 'fe80::', 10, 'ipv6'],
  ['subnet', 'fec0::', 10, 'ipv6'],
  ['subnet', 'ff00::', 8, 'ipv6'],
];

let safeHttpAgent;

const createUnsafeIpBlockList = () => {
  const blockList = new net.BlockList();

  for (const entry of UNSAFE_IP_BLOCKS) {
    if (entry[0] === 'address') {
      blockList.addAddress(entry[1], entry[2]);
    } else {
      blockList.addSubnet(entry[1], entry[2], entry[3]);
    }
  }

  return blockList;
};

const unsafeIpBlockList = createUnsafeIpBlockList();

const isAllowedUnsafeHttpHost = (documentUrl, allowedUnsafeHosts) => {
  const url = new URL(documentUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const normalizedHostname = normalizeHostname(hostname);
  const hostCandidates = [host, hostname, normalizedHostname];

  if (url.port) {
    hostCandidates.push(`${normalizedHostname}:${url.port}`);
  }

  return allowedUnsafeHosts.some((allowedHost) => hostCandidates.includes(allowedHost));
};

const normalizeHostname = (hostname) =>
  hostname
    .toLowerCase()
    .replace(/^\[(.*)]$/, '$1')
    .replace(/\.$/, '');

const isUnsafeHostname = (hostname) => {
  const normalizedHostname = normalizeHostname(hostname);

  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    UNSAFE_HOSTNAME_SUFFIXES.some((suffix) => normalizedHostname.endsWith(suffix))
  );
};

const getMappedIPv4Address = (address) => {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address.toLowerCase());
  return match && match[1];
};

const isUnsafeIpAddress = (address) => {
  const normalizedAddress = normalizeHostname(address);
  const mappedIPv4Address = getMappedIPv4Address(normalizedAddress);

  if (mappedIPv4Address) return isUnsafeIpAddress(mappedIPv4Address);

  const ipVersion = net.isIP(normalizedAddress);
  if (!ipVersion) return false;

  return unsafeIpBlockList.check(normalizedAddress, ipVersion === 6 ? 'ipv6' : 'ipv4');
};

const createUnsafeHttpRefAccessDeniedError = (message) =>
  createExternalRefAccessDeniedError(`${message}. ${HTTP_REF_POLICY_HINT}`);

const denyUnsafeHttpRef = (message) => {
  throw createUnsafeHttpRefAccessDeniedError(message);
};

const validateResolvedAddress = (hostname, address) => {
  if (!isUnsafeIpAddress(address)) return;

  throw createUnsafeHttpRefAccessDeniedError(
    `Blocked unsafe YAML $ref host resolution: ${hostname} resolved to ${address}`
  );
};

const getSafeHttpAgent = () => {
  if (!safeHttpAgent) {
    safeHttpAgent = new Agent({
      connect: {
        lookup(hostname, options, callback) {
          dns.lookup(hostname, options, (error, address, family) => {
            if (error) {
              callback(error);
              return;
            }

            try {
              if (Array.isArray(address)) {
                for (const entry of address) validateResolvedAddress(hostname, entry.address);
              } else {
                validateResolvedAddress(hostname, address);
              }
            } catch (validationError) {
              callback(validationError);
              return;
            }

            callback(null, address, family);
          });
        },
      },
    });
  }

  return safeHttpAgent;
};

const assertHttpRefResolvesSafely = async (documentUrl) => {
  const { hostname, protocol } = new URL(documentUrl);
  const normalizedHostname = normalizeHostname(hostname);

  if (protocol !== 'http:' && protocol !== 'https:') {
    denyExternalRef(`Blocked unsupported YAML $ref URL: ${documentUrl}`);
  }

  if (isUnsafeHostname(normalizedHostname) || isUnsafeIpAddress(normalizedHostname)) {
    denyUnsafeHttpRef(`Blocked unsafe YAML $ref URL: ${documentUrl}`);
  }

  if (net.isIP(normalizedHostname)) return;

  const addresses = await dnsPromises.lookup(normalizedHostname, { all: true, order: 'verbatim' });

  if (addresses.some(({ address }) => isUnsafeIpAddress(address))) {
    denyUnsafeHttpRef(`Blocked unsafe YAML $ref URL: ${documentUrl}`);
  }
};

const assertHttpRefAllowed = async (documentUrl, options) => {
  if (isAllowedUnsafeHttpHost(documentUrl, options.allowedUnsafeHosts)) return;
  await assertHttpRefResolvesSafely(documentUrl);
};

const requestHttpDocument = async (documentUrl, dispatcher) => {
  let timeoutId;
  let controller;

  if (typeof AbortController !== 'undefined') {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), DEFAULT_HTTP_TIMEOUT);
  }

  try {
    const fetchOptions = {
      method: 'GET',
      redirect: 'manual',
      signal: controller ? controller.signal : null,
    };

    if (dispatcher) fetchOptions.dispatcher = dispatcher;

    const response = await fetch(documentUrl, fetchOptions);

    if (response.status >= 300 && response.status < 400) {
      return {
        redirectLocation: response.headers.get('location'),
        status: response.status,
      };
    }

    if (response.status >= 400) {
      throw new Error(`HTTP ERROR ${response.status}`);
    }

    return { document: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    const accessDeniedError = getExternalRefAccessDeniedError(error);
    if (accessDeniedError) throw accessDeniedError;
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const readHttpDocumentSafely = async (documentUrl, options) => {
  let currentUrl = documentUrl;

  for (let redirectCount = 0; ; redirectCount += 1) {
    await assertHttpRefAllowed(currentUrl, options);

    const dispatcher = isAllowedUnsafeHttpHost(currentUrl, options.allowedUnsafeHosts)
      ? null
      : getSafeHttpAgent();
    const result = await requestHttpDocument(currentUrl, dispatcher);

    if (result.redirectLocation !== undefined) {
      if (redirectCount >= DEFAULT_HTTP_REDIRECTS) {
        throw new Error(`Too many redirects while resolving ${documentUrl}`);
      }

      if (!result.redirectLocation) {
        throw new Error(`HTTP ${result.status} redirect with no location header`);
      }

      currentUrl = new URL(result.redirectLocation, currentUrl).href;
      continue;
    }

    return result.document;
  }
};

const readHttpRef = async (documentUrl, fileInfo, HTTPResolver, options) => {
  if (options.allowUnsafeUrls) {
    const httpResolver = { ...HTTPResolver, safeUrlResolver: false };
    return httpResolver.read(fileInfo);
  }

  return readHttpDocumentSafely(documentUrl, options);
};

module.exports = {
  readHttpRef,
};
