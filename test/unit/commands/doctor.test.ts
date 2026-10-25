'use strict';

const path = require('path');
const spawn = require('../../../lib/utils/spawn');
const { expect } = require('chai');
const setupProgrammaticFixture = require('../../utils/setup-programmatic-fixture');

const serverlessPath = path.resolve(__dirname, '../../../scripts/serverless.js');

describe('test/unit/commands/doctor.test.js', async () => {
  before(() => {
    process.env.SLS_DEPRECATION_NOTIFICATION_MODE = 'warn:summary';
  });

  it('should print health status after command which triggered deprecation', async () => {
    const { servicePath: serviceDir } = await setupProgrammaticFixture('http-api', {
      configExt: {
        provider: {
          httpApi: {
            useProviderTags: true,
          },
        },
      },
    });
    // Trigger deprecation
    await spawn('node', [serverlessPath, 'print'], { cwd: serviceDir });

    // Gather Health status
    const output = String((await spawn('node', [serverlessPath, 'doctor'])).stdoutBuffer);

    expect(output).to.include('deprecation triggered in the last command');
    expect(output).to.include(
      'More info: https://github.com/oss-serverless/osls/blob/4.x/docs/guides/deprecations.md#AWS_HTTP_API_USE_PROVIDER_TAGS_PROPERTY'
    );
  });

  it('should inform of no issues when no health status found', async () => {
    // Trigger command that reports no issues
    await spawn('node', [serverlessPath, 'config', '--help']);

    // Gather Health status
    expect(String((await spawn('node', [serverlessPath, 'doctor'])).stdoutBuffer)).to.be.empty;
  });
});
