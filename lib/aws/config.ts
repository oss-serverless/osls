'use strict';

const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');
const fs = require('fs');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

/**
 * Build AWS SDK v3 client configuration from environment and options
 * @param {Object} options - Configuration options
 * @param {string} options.region - AWS region
 * @param {Object|Function} options.credentials - AWS credentials or SDK v3 credential provider
 * @param {number} options.maxAttempts - Maximum retry attempts
 * @param {string} options.retryMode - Retry mode ('legacy', 'standard', 'adaptive')
 * @param {Object} options.requestHandler - Request handler override, used in place of the
 *   proxy, timeout, and certificate configuration derived from the environment
 * @returns {Object} AWS SDK v3 client configuration
 */
function buildClientConfig(options = {}) {
  const { credentials, maxAttempts, region, requestHandler, retryMode, ...clientOptions } = options;
  const config = {
    ...clientOptions,
    region:
      region === undefined
        ? process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
        : region,
    maxAttempts: maxAttempts === undefined ? getMaxAttempts() : maxAttempts,
    retryMode: retryMode || 'standard',
  };

  // Add credentials if provided
  if (credentials) {
    config.credentials = credentials;
  }

  if (requestHandler) {
    config.requestHandler = requestHandler;
  } else {
    // Configure HTTP options (proxy, timeout, certificates)
    config.requestHandler = new NodeHttpHandler(buildHttpOptions());
  }

  return config;
}

/**
 * Get maximum retry attempts from environment
 * @returns {number} Maximum retry attempts
 */
function getMaxRetries() {
  const userValue = Number(process.env.SLS_AWS_REQUEST_MAX_RETRIES);
  return userValue >= 0 ? userValue : 4;
}

function getMaxAttempts() {
  return getMaxRetries() + 1;
}

/**
 * Build HTTP options for AWS SDK v3 clients
 * @returns {Object} HTTP configuration
 */
function buildHttpOptions() {
  const httpOptions = {};

  // Socket inactivity timeout, matching the AWS SDK v2 default of 120 seconds. A bare
  // requestTimeout would be warn-only in @smithy/node-http-handler 4.4.0+.
  const timeout = process.env.AWS_CLIENT_TIMEOUT || process.env.aws_client_timeout;
  httpOptions.socketTimeout = timeout ? parseInt(timeout, 10) : 120000;

  // Configure proxy
  const proxy = getProxyUrl();

  // Configure HTTPS agent options for proxy and custom CA certificates
  const caCerts = getCACertificates();
  const agentOptions = { keepAlive: true };
  if (caCerts.length > 0) {
    Object.assign(agentOptions, {
      rejectUnauthorized: true,
      ca: caCerts,
    });
  }

  if (proxy) {
    // Assigned for both schemes; https-proxy-agent tunnels plain-http requests too
    const proxyAgent = new HttpsProxyAgent(proxy, agentOptions);
    httpOptions.httpsAgent = proxyAgent;
    httpOptions.httpAgent = proxyAgent;
  } else if (caCerts.length > 0) {
    httpOptions.httpsAgent = new https.Agent(agentOptions);
  }

  return httpOptions;
}

/**
 * Get proxy URL from environment variables
 * @returns {string|null} Proxy URL or null if not configured
 */
function getProxyUrl() {
  return (
    process.env.proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    null
  );
}

/**
 * Get CA certificates from environment variables and files
 * @returns {Array} Array of CA certificates
 */
function getCACertificates() {
  let caCerts = [];

  // Get certificates from environment variable
  const ca = process.env.ca || process.env.HTTPS_CA || process.env.https_ca;
  if (ca) {
    // Can be a single certificate or multiple, comma separated.
    const caArr = ca.split(',');
    // Replace the newline -- https://stackoverflow.com/questions/30400341
    caCerts = caCerts.concat(caArr.map((cert) => cert.replace(/\\n/g, '\n')));
  }

  // Get certificates from files
  const cafile = process.env.cafile || process.env.HTTPS_CAFILE || process.env.https_cafile;
  if (cafile) {
    // Can be a single certificate file path or multiple paths, comma separated.
    const caPathArr = cafile.split(',');
    caCerts = caCerts.concat(caPathArr.map((cafilePath) => fs.readFileSync(cafilePath.trim())));
  }

  return caCerts;
}

module.exports = {
  buildClientConfig,
  buildHttpOptions,
  getCACertificates,
  getMaxAttempts,
  getMaxRetries,
};
