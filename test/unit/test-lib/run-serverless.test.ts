'use strict';

const { expect } = require('chai');
const runServerless = require('../../utils/run-serverless');

describe('test/lib/run-serverless.test.js', () => {
  it('does not overwrite caller-provided https-proxy-agent module stubs', async () => {
    const createdAgents = [];

    class FakeHttpsProxyAgent {
      constructor(proxyUrl, options) {
        createdAgents.push({ proxyUrl, options });
      }
    }

    await runServerless({
      fixture: 'function',
      command: 'package',
      env: {
        proxy: 'http://127.0.0.1:8888',
      },
      modulesCacheStub: {
        'https-proxy-agent': { HttpsProxyAgent: FakeHttpsProxyAgent },
      },
      hooks: {
        beforeInstanceRun: async (serverless) => {
          await serverless.getProvider('aws').getAwsSdkV3Config();
        },
      },
    });

    expect(createdAgents).to.not.be.empty;
    for (const createdAgent of createdAgents) {
      expect(createdAgent.proxyUrl).to.equal('http://127.0.0.1:8888');
    }
  });
});
