'use strict';

const chai = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');

const runServerless = require('../../../utils/run-serverless');

const expect = chai.expect;

describe('test/unit/lib/plugins/print.test.js', () => {
  it('correctly prints config', async () => {
    const { output } = await runServerless({
      fixture: 'aws',
      command: 'print',
    });

    expect(output).to.include('name: aws');
  });

  it('resolves own unsafe path segments and supports falsy values', async () => {
    const writeText = sinon.spy();
    const Print = proxyquire('../../../../lib/plugins/print', {
      '../utils/serverless-utils/log': { writeText },
    });
    const serverless = {
      configurationInput: {
        custom: {
          enabled: false,
        },
      },
    };
    Object.defineProperty(serverless.configurationInput.custom, '__proto__', {
      value: { value: 'unsafe' },
      writable: true,
      enumerable: true,
      configurable: true,
    });

    await new Print(serverless, { path: 'custom.__proto__.value', format: 'text' }).print();
    expect(writeText.calledWithExactly('unsafe')).to.equal(true);

    writeText.resetHistory();
    await new Print(serverless, { path: 'custom.enabled', format: 'text' }).print();
    expect(writeText.calledWithExactly('false')).to.equal(true);
  });

  it('resolves own array properties like length', async () => {
    const writeText = sinon.spy();
    const Print = proxyquire('../../../../lib/plugins/print', {
      '../utils/serverless-utils/log': { writeText },
    });
    const serverless = {
      configurationInput: {
        custom: {
          items: ['one', 'two', 'three'],
        },
      },
    };

    await new Print(serverless, { path: 'custom.items.length', format: 'text' }).print();

    expect(writeText.calledWithExactly('3')).to.equal(true);
  });

  it('does not resolve inherited path segments', async () => {
    const writeText = sinon.spy();
    const Print = proxyquire('../../../../lib/plugins/print', {
      '../utils/serverless-utils/log': { writeText },
    });
    const serverless = { configurationInput: { custom: {} } };

    try {
      await new Print(serverless, { path: 'custom.constructor.name', format: 'text' }).print();
      throw new Error('Expected print() to reject');
    } catch (error) {
      expect(error.code).to.equal('INVALID_PATH_ARGUMENT');
    }
  });

  it('resolves Proxy-backed virtual path segments', async () => {
    const writeText = sinon.spy();
    const Print = proxyquire('../../../../lib/plugins/print', {
      '../utils/serverless-utils/log': { writeText },
    });
    const serverless = {
      configurationInput: {
        custom: {
          proxy: new Proxy(
            { own: 'own-value' },
            {
              get(target, key) {
                if (key === 'virtual') return { nested: 'proxy-virtual' };
                return target[key];
              },
            }
          ),
        },
      },
    };

    await new Print(serverless, { path: 'custom.proxy.virtual.nested', format: 'text' }).print();
    expect(writeText.calledWithExactly('proxy-virtual')).to.equal(true);

    writeText.resetHistory();
    await new Print(serverless, { path: 'custom.proxy.own', format: 'text' }).print();
    expect(writeText.calledWithExactly('own-value')).to.equal(true);
  });

  it('does not resolve unsafe path segments on Proxy-backed values', async () => {
    const writeText = sinon.spy();
    const Print = proxyquire('../../../../lib/plugins/print', {
      '../utils/serverless-utils/log': { writeText },
    });
    const serverless = {
      configurationInput: {
        custom: {
          proxy: new Proxy(
            {},
            {
              get(target, key) {
                return target[key];
              },
            }
          ),
        },
      },
    };

    try {
      await new Print(serverless, {
        path: 'custom.proxy.constructor.name',
        format: 'text',
      }).print();
      throw new Error('Expected print() to reject');
    } catch (error) {
      expect(error.code).to.equal('INVALID_PATH_ARGUMENT');
    }
  });
});
