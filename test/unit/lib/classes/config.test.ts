'use strict';

const expect = require('chai').expect;
const Config = require('../../../../lib/classes/config');
const Serverless = require('../../../../lib/serverless');

const serverless = new Serverless({ commands: [], options: {} });

describe('Config', () => {
  afterEach(() => {
    delete Object.prototype.polluted;
  });

  describe('#constructor()', () => {
    it('should attach serverless instance', () => {
      const configInstance = new Config(serverless);
      expect(typeof configInstance.serverless.version).to.be.equal('string');
    });

    it('should add config if provided', () => {
      const configInstance = new Config(serverless, { servicePath: 'string' });
      expect(configInstance.servicePath).to.be.equal('string');
    });
  });

  describe('#update()', () => {
    it('should update config', () => {
      const configInstance = new Config(serverless, { servicePath: 'config1' });
      expect(configInstance.servicePath).to.be.equal('config1');

      configInstance.update({ servicePath: 'config2' });
      expect(configInstance.servicePath).to.be.equal('config2');
    });

    it('should preserve sibling nested properties on repeated updates', () => {
      const configInstance = new Config(serverless, {
        custom: {
          first: 'value-1',
        },
      });

      configInstance.update({
        custom: {
          second: 'value-2',
        },
      });

      expect(configInstance.custom).to.deep.equal({
        first: 'value-1',
        second: 'value-2',
      });
    });

    it('should ignore unsafe keys on update', () => {
      const configInstance = new Config(serverless);

      configInstance.update(JSON.parse('{"__proto__":{"polluted":"yes"},"custom":{"safe":true}}'));

      expect(configInstance.custom).to.deep.equal({ safe: true });
      expect({}.polluted).to.equal(undefined);
    });
  });
});
