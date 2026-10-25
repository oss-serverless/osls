'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');
const setupProgrammaticFixture = require('../../utils/setup-programmatic-fixture');

describe('test/utils/setup-programmatic-fixture', () => {
  it('sets up a mutable copied fixture with config extensions and serviceName', async () => {
    const { servicePath, serviceConfig, updateConfig } = await setupProgrammaticFixture(
      'function',
      {
        serviceName: 'stable-service-name',
        configExt: {
          custom: { first: true },
          functions: {
            extra: { handler: 'extra.handler' },
          },
        },
      }
    );

    expect(serviceConfig.service).to.equal('stable-service-name');
    expect(serviceConfig.custom).to.deep.equal({ first: true });
    expect(serviceConfig.functions.extra).to.deep.equal({ handler: 'extra.handler' });

    await updateConfig({ custom: { second: true } });

    expect(serviceConfig.custom).to.deep.equal({ first: true, second: true });
    expect(servicePath).to.not.equal(
      path.resolve(__dirname, '../../fixtures/programmatic/function')
    );
  });

  it('writes files inside the copied service', async () => {
    const { servicePath, writeFile } = await setupProgrammaticFixture('function', {
      files: [{ to: 'fixtures/input.json', contents: '{"ok":true}\n' }],
    });

    const filePath = await writeFile('nested/output.txt', 'output');

    expect(filePath.startsWith(`${servicePath}${path.sep}`)).to.equal(true);
    expect(
      await fs.promises.readFile(path.join(servicePath, 'fixtures/input.json'), 'utf8')
    ).to.equal('{"ok":true}\n');
    expect(await fs.promises.readFile(filePath, 'utf8')).to.equal('output');
  });

  it('rejects file writes outside the copied service', async () => {
    const { writeFile } = await setupProgrammaticFixture('function');

    await expect(writeFile('../outside.txt', 'nope')).to.be.rejectedWith(
      'Expected path inside fixture service'
    );
  });

  it('rejects conflicting service name options', async () => {
    await expect(
      setupProgrammaticFixture('function', {
        serviceName: 'from-option',
        configExt: { service: 'from-config' },
      })
    ).to.be.rejectedWith('Use either `serviceName` or `configExt.service`, not both');
  });
});
