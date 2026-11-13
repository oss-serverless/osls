'use strict';

const fsp = require('fs').promises;
const path = require('path');
const { expect } = require('chai');
const spawn = require('../../../../../../lib/utils/spawn');
const getWebAppStartFile = require('../../../../../../lib/plugins/aws/utils/get-web-app-start-file');
const { createTmpDir } = require('../../../../../utils/fs');

const reportProcess =
  '{ argv1: process.argv[1], port: process.env.PORT, hostname: process.env.HOSTNAME }';

describe('test/unit/lib/plugins/aws/utils/get-web-app-start-file.test.js', () => {
  let packagePath;

  const start = async (entry, env) => {
    const startFilePath = path.join(packagePath, 'start.mjs');
    await fsp.writeFile(startFilePath, getWebAppStartFile(entry));
    const { stdoutBuffer } = await spawn(process.execPath, [startFilePath], {
      env: { ...process.env, PORT: '3000', HOSTNAME: 'localhost', ...env },
    });
    return JSON.parse(String(stdoutBuffer));
  };

  before(async () => {
    packagePath = await fsp.realpath(createTmpDir());
    await fsp.mkdir(path.join(packagePath, 'src'));
    await Promise.all([
      fsp.writeFile(
        path.join(packagePath, 'server.js'),
        `console.log(JSON.stringify({ ...${reportProcess}, isMain: require.main === module }));`
      ),
      fsp.writeFile(
        path.join(packagePath, 'src', 'server.mjs'),
        `import 'node:http';\nconsole.log(JSON.stringify(${reportProcess}));`
      ),
    ]);
  });

  it('should start a CommonJS entry as the main script on the address AWS Lambda assigns', async () => {
    expect(await start('server.js', { AWS_LAMBDA_HTTP_ENDPOINT: '0.0.0.0:9000' })).to.deep.equal({
      argv1: path.join(packagePath, 'server.js'),
      port: '9000',
      hostname: '0.0.0.0',
      isMain: true,
    });
  });

  it('should start an ES module entry in a subdirectory', async () => {
    expect(
      await start('src/server.mjs', { AWS_LAMBDA_HTTP_ENDPOINT: '0.0.0.0:9000' })
    ).to.deep.equal({
      argv1: path.join(packagePath, 'src', 'server.mjs'),
      port: '9000',
      hostname: '0.0.0.0',
    });
  });

  it('should take the port after the last colon of an IPv6 address', async () => {
    expect(await start('server.js', { AWS_LAMBDA_HTTP_ENDPOINT: '[::]:9000' })).to.include({
      port: '9000',
      hostname: '::',
    });
  });

  it('should leave PORT and HOSTNAME as they are outside of AWS Lambda', async () => {
    expect(await start('server.js', { AWS_LAMBDA_HTTP_ENDPOINT: undefined })).to.include({
      port: '3000',
      hostname: 'localhost',
    });
  });
});
