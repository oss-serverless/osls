'use strict';

const chai = require('chai');
const sinon = require('sinon');
const pluginUtilsModule = require('../../../../../../lib/plugins/plugin/lib/utils.js');
const { log } = require('../../../../../../lib/utils/serverless-utils/log');
const observeOutput = require('../../../../../lib/observe-output');

const expect = chai.expect;

describe('PluginUtils', () => {
  const plugins = [
    {
      name: 'serverless-plugin-1',
      description: 'Serverless Plugin 1',
      githubUrl: 'https://github.com/serverless/serverless-plugin-1',
    },
    {
      name: 'serverless-plugin-2',
      description: 'Serverless Plugin 2',
      githubUrl: 'https://github.com/serverless/serverless-plugin-2',
    },
    {
      name: 'serverless-existing-plugin',
      description: 'Serverless Existing plugin',
      githubUrl: 'https://github.com/serverless/serverless-existing-plugin',
    },
  ];

  describe('#getPlugins()', () => {
    let fetchStub;
    let originalFetch;

    beforeEach(() => {
      fetchStub = sinon.stub().returns(
        Promise.resolve({
          json: sinon.stub().returns(Promise.resolve(plugins)),
        })
      );
      originalFetch = globalThis.fetch;
      globalThis.fetch = fetchStub;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should fetch and return the plugins from the plugins repository', async () => {
      const endpoint = 'https://raw.githubusercontent.com/serverless/plugins/master/plugins.json';

      return pluginUtilsModule.getPlugins().then((result) => {
        expect(fetchStub.calledOnce).to.equal(true);
        expect(fetchStub.args[0][0]).to.equal(endpoint);
        expect(result).to.deep.equal(plugins);
      });
    });
  });

  describe('#display()', () => {
    it('should display the plugins if present', async () => {
      const output = await observeOutput(() => pluginUtilsModule.display(plugins));
      let expectedMessage = '';
      expectedMessage += 'serverless-existing-plugin Serverless Existing plugin\n';
      expectedMessage += 'serverless-plugin-1 Serverless Plugin 1\n';
      expectedMessage += 'serverless-plugin-2 Serverless Plugin 2\n\n';
      expectedMessage += 'Install a plugin by running:\n';
      expectedMessage += '  serverless plugin install --name ...\n\n';
      expectedMessage +=
        'It will be automatically downloaded and added to package.json and serverless.yml\n';
      expect(output).to.equal(expectedMessage);
    });

    it('should ignore malformed plugin records and still display valid plugins', async () => {
      const output = await observeOutput(() =>
        pluginUtilsModule.display([
          {
            name: 'serverless-plugin-2',
            description: 'Serverless Plugin 2',
          },
          {
            description: 'Missing name',
          },
          {
            name: 'serverless-plugin-1',
            description: 'Serverless Plugin 1',
          },
        ])
      );

      let expectedMessage = '';
      expectedMessage += 'serverless-plugin-1 Serverless Plugin 1\n';
      expectedMessage += 'serverless-plugin-2 Serverless Plugin 2\n\n';
      expectedMessage += 'Install a plugin by running:\n';
      expectedMessage += '  serverless plugin install --name ...\n\n';
      expectedMessage +=
        'It will be automatically downloaded and added to package.json and serverless.yml\n';

      expect(output).to.equal(expectedMessage);
    });

    it('should log the empty-state message when no displayable plugins remain', async () => {
      const originalSkipDescriptor = Object.getOwnPropertyDescriptor(log.notice, 'skip');
      const skipSpy = sinon.spy();

      Object.defineProperty(log.notice, 'skip', {
        value: skipSpy,
        configurable: true,
      });

      try {
        const output = await observeOutput(() =>
          pluginUtilsModule.display([
            null,
            {
              description: 'Missing name',
            },
            {
              name: 7,
              description: 'Numeric name',
            },
          ])
        );

        expect(output).to.equal('');
        expect(skipSpy.calledOnce).to.equal(true);
        expect(skipSpy.args[0][0]).to.equal('There are no plugins available to display');
      } finally {
        Object.defineProperty(log.notice, 'skip', originalSkipDescriptor);
      }
    });
  });
});
