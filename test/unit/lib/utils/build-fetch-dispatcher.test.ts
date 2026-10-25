'use strict';

const chai = require('chai');
const http = require('http');
const net = require('net');
const { EnvHttpProxyAgent, ProxyAgent } = require('undici');
const { overrideEnv } = require('../../../utils/process');
const buildFetchDispatcher = require('../../../../lib/utils/build-fetch-dispatcher');

const { expect } = chai;

describe('test/unit/lib/utils/build-fetch-dispatcher.test.js', () => {
  it('uses standard environment proxy handling by default', async () => {
    await overrideEnv(async () => {
      const dispatcher = buildFetchDispatcher();
      try {
        expect(dispatcher).to.be.an.instanceOf(EnvHttpProxyAgent);
      } finally {
        await dispatcher.close();
      }
    });
  });

  it('uses the legacy lowercase proxy variable when set', async () => {
    await overrideEnv(async () => {
      process.env.proxy = 'http://proxy.example.com:8080';
      const dispatcher = buildFetchDispatcher();
      try {
        expect(dispatcher).to.be.an.instanceOf(ProxyAgent);
      } finally {
        await dispatcher.close();
      }
    });
  });

  it('routes requests through the proxy configured in the environment', async () => {
    await overrideEnv(async () => {
      const targetServer = http.createServer((request, response) => {
        response.end('from-target');
      });
      await new Promise((resolve) => targetServer.listen(0, '127.0.0.1', resolve));

      // undici tunnels through proxies with CONNECT, also for plain-http targets
      const connectRequests = [];
      const proxyServer = http.createServer();
      proxyServer.on('connect', (request, clientSocket, head) => {
        connectRequests.push(request.url);
        const targetSocket = net.connect(targetServer.address().port, '127.0.0.1', () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          targetSocket.write(head);
          targetSocket.pipe(clientSocket);
          clientSocket.pipe(targetSocket);
        });
      });
      await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));

      try {
        process.env.HTTP_PROXY = `http://127.0.0.1:${proxyServer.address().port}`;
        const dispatcher = buildFetchDispatcher();
        try {
          // `.invalid` never resolves; a response proves the request went via the proxy
          const response = await fetch('http://target.invalid/artifact.zip', { dispatcher });
          expect(await response.text()).to.equal('from-target');
          expect(connectRequests).to.deep.equal(['target.invalid:80']);
        } finally {
          await dispatcher.close();
        }
      } finally {
        await new Promise((resolve) => proxyServer.close(resolve));
        await new Promise((resolve) => targetServer.close(resolve));
      }
    });
  });
});
