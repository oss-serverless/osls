'use strict';

const chai = require('chai');
const net = require('net');
const proxyquire = require('proxyquire');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { overrideEnv } = require('../../../utils/process');
const { buildHttpOptions } = require('../../../../lib/aws/config');

const { expect } = chai;

describe('test/unit/lib/aws/config.test.js', () => {
  function loadConfig() {
    function FakeNodeHttpHandler(options) {
      this.options = options;
    }

    function FakeHttpsProxyAgent(proxy, options) {
      this.proxy = proxy;
      this.options = options;
    }

    class FakeHttpsAgent {
      constructor(options) {
        this.options = options;
      }
    }

    return proxyquire('../../../../lib/aws/config', {
      '@smithy/node-http-handler': { NodeHttpHandler: FakeNodeHttpHandler },
      'https-proxy-agent': { HttpsProxyAgent: FakeHttpsProxyAgent },
      'https': { Agent: FakeHttpsAgent },
    });
  }

  it('preserves explicit maxAttempts values including zero', async () => {
    await overrideEnv(async () => {
      const { buildClientConfig } = loadConfig();

      expect(buildClientConfig({ maxAttempts: 0 }).maxAttempts).to.equal(0);
      expect(buildClientConfig({ maxAttempts: 1 }).maxAttempts).to.equal(1);
    });
  });

  it('maps Serverless retry count to SDK v3 maxAttempts', async () => {
    await overrideEnv(async () => {
      const { buildClientConfig } = loadConfig();

      expect(buildClientConfig().maxAttempts).to.equal(5);

      process.env.SLS_AWS_REQUEST_MAX_RETRIES = '0';
      expect(buildClientConfig().maxAttempts).to.equal(1);

      process.env.SLS_AWS_REQUEST_MAX_RETRIES = '2';
      expect(buildClientConfig().maxAttempts).to.equal(3);
    });
  });

  it('falls back to environment region only when region is undefined', async () => {
    await overrideEnv(async () => {
      process.env.AWS_REGION = 'eu-west-1';
      const { buildClientConfig } = loadConfig();

      expect(buildClientConfig().region).to.equal('eu-west-1');
      expect(buildClientConfig({ region: undefined }).region).to.equal('eu-west-1');
      expect(buildClientConfig({ region: '' }).region).to.equal('');
      expect(buildClientConfig({ region: null }).region).to.equal(null);
    });
  });

  it('uses NodeHttpHandler for timeout config', async () => {
    await overrideEnv(async () => {
      process.env.AWS_CLIENT_TIMEOUT = '1234';
      const { buildClientConfig } = loadConfig();

      const config = buildClientConfig();

      expect(config.requestHandler.options).to.deep.equal({ socketTimeout: 1234 });
    });
  });

  it('preserves explicit zero timeout config', async () => {
    await overrideEnv(async () => {
      process.env.AWS_CLIENT_TIMEOUT = '0';
      const { buildClientConfig } = loadConfig();

      const config = buildClientConfig();

      expect(config.requestHandler.options).to.deep.equal({ socketTimeout: 0 });
    });
  });

  it('defaults to a 120 second socket timeout and always constructs a request handler', async () => {
    await overrideEnv(async () => {
      const { buildClientConfig } = loadConfig();

      const config = buildClientConfig();

      expect(config.requestHandler.options).to.deep.equal({ socketTimeout: 120000 });
    });
  });

  it('assigns the proxy agent for both http and https requests', async () => {
    await overrideEnv(async () => {
      process.env.HTTPS_PROXY = 'https://proxy.example.com:1234';
      const { buildClientConfig } = loadConfig();

      const config = buildClientConfig();

      expect(config.requestHandler.options.httpAgent).to.equal(
        config.requestHandler.options.httpsAgent
      );
      expect(config.requestHandler.options.httpsAgent.proxy).to.equal(
        'https://proxy.example.com:1234'
      );
    });
  });

  it('enforces the socket inactivity timeout with the real transport', async () => {
    await overrideEnv(async () => {
      process.env.AWS_CLIENT_TIMEOUT = '500';
      const sockets = new Set();
      const server = net.createServer((socket) => {
        // Accept the connection and never respond
        sockets.add(socket);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const handler = new NodeHttpHandler(buildHttpOptions());

      try {
        const error = await handler
          .handle({
            protocol: 'http:',
            hostname: '127.0.0.1',
            port: server.address().port,
            method: 'GET',
            path: '/',
            headers: {},
          })
          .then(
            () => null,
            (handleError) => handleError
          );

        expect(error).to.exist;
        expect(error.name).to.equal('TimeoutError');
      } finally {
        handler.destroy();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  it('passes proxy and CA options when constructing the proxy agent', async () => {
    await overrideEnv(async () => {
      process.env.HTTPS_PROXY = 'https://proxy.example.com:1234';
      process.env.HTTPS_CA = 'certificate';
      const { buildClientConfig } = loadConfig();

      const config = buildClientConfig();

      expect(config.requestHandler.options.httpsAgent.proxy).to.equal(
        'https://proxy.example.com:1234'
      );
      expect(config.requestHandler.options.httpsAgent.options).to.include({
        keepAlive: true,
        rejectUnauthorized: true,
      });
      expect(config.requestHandler.options.httpsAgent.options.ca).to.deep.equal(['certificate']);
    });
  });

  it('passes CA options when constructing the native HTTPS agent', async () => {
    await overrideEnv(async () => {
      process.env.HTTPS_CA = 'certificate';
      const { buildClientConfig } = loadConfig();

      const config = buildClientConfig();

      expect(config.requestHandler.options.httpsAgent.options).to.include({
        keepAlive: true,
        rejectUnauthorized: true,
      });
      expect(config.requestHandler.options.httpsAgent.options.ca).to.deep.equal(['certificate']);
    });
  });

  it('passes custom user agent config through', () => {
    const { buildClientConfig } = loadConfig();

    expect(buildClientConfig({ customUserAgent: 'custom-agent' }).customUserAgent).to.equal(
      'custom-agent'
    );
  });

  it('passes SDK v3 client options through', () => {
    const { buildClientConfig } = loadConfig();
    const requestHandler = {};

    expect(
      buildClientConfig({
        endpoint: 'http://localhost:4566',
        forcePathStyle: true,
        requestHandler,
      })
    ).to.include({
      endpoint: 'http://localhost:4566',
      forcePathStyle: true,
      requestHandler,
    });
  });
});
