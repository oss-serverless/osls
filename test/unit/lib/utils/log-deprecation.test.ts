'use strict';

const fsp = require('fs').promises;
const path = require('path');
const proxyquire = require('proxyquire');
const sandbox = require('sinon');
const expect = require('chai').expect;
const { overrideEnv } = require('../../../utils/process');
const { getTmpDirPath, pathExists } = require('../../../utils/fs');
const ServerlessError = require('../../../../lib/serverless-error');

describe('test/unit/lib/utils/logDeprecation.test.js', () => {
  let restoreEnv;

  beforeEach(() => {
    delete require.cache[require.resolve('../../../../lib/utils/log-deprecation')];
    delete require.cache[require.resolve('../../../../lib/utils/health-status-filename')];
    ({ restoreEnv } = overrideEnv({
      whitelist: ['APPDATA', 'HOME', 'PATH', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE'],
    }));
  });

  afterEach(async () => {
    sandbox.restore();
    const healthStatusFilename = require('../../../../lib/utils/health-status-filename');
    await fsp.unlink(healthStatusFilename).catch(() => null);
    restoreEnv();
  });

  it('should throw on deprecation if error notifications mode set in service config', () => {
    const logDeprecation = require('../../../../lib/utils/log-deprecation');
    let error;

    try {
      logDeprecation('CODE1', 'Start using deprecation log', {
        serviceConfig: { deprecationNotificationMode: 'error' },
      });
    } catch (thrownError) {
      error = thrownError;
    }

    expect(error).to.be.instanceOf(ServerlessError);
    expect(error).to.have.property('code', 'REJECTED_DEPRECATION_CODE1');
    expect(error.message).to.include('Start using deprecation log');
    expect(error.message).to.include(
      'More Info: https://github.com/oss-serverless/osls/blob/4.x/docs/guides/deprecations.md#CODE1'
    );
  });

  it('should honor env notification mode set after module load', () => {
    const logDeprecation = require('../../../../lib/utils/log-deprecation');
    let error;

    process.env.SLS_DEPRECATION_NOTIFICATION_MODE = 'error';

    try {
      logDeprecation('CODE_DYNAMIC_ENV_MODE', 'Dynamic env mode');
    } catch (thrownError) {
      error = thrownError;
    }

    expect(error).to.be.instanceOf(ServerlessError);
    expect(error).to.have.property('code', 'REJECTED_DEPRECATION_CODE_DYNAMIC_ENV_MODE');
    expect(error.message).to.include('Dynamic env mode');
  });

  it('should honor env disabled deprecations set after module load', () => {
    const logDeprecation = require('../../../../lib/utils/log-deprecation');

    process.env.SLS_DEPRECATION_DISABLE = 'CODE_DYNAMIC_ENV_DISABLE';

    expect(() =>
      logDeprecation('CODE_DYNAMIC_ENV_DISABLE', 'Dynamic env disable', {
        serviceConfig: { deprecationNotificationMode: 'error' },
      })
    ).to.not.throw();
  });

  it('should write deprecation docs URL to summary output', async () => {
    const logDeprecation = require('../../../../lib/utils/log-deprecation');
    const healthStatusFilename = require('../../../../lib/utils/health-status-filename');

    logDeprecation('CODE1', 'Start using deprecation log');
    await logDeprecation.printSummary();

    const summary = await fsp.readFile(healthStatusFilename, 'utf8');

    expect(summary).to.include('Start using deprecation log');
    expect(summary).to.include(
      'More info: https://github.com/oss-serverless/osls/blob/4.x/docs/guides/deprecations.md#CODE1'
    );
  });

  it('should create the health status parent directory before writing summary output', async () => {
    const healthStatusFilename = path.join(
      getTmpDirPath(),
      '.serverless',
      'last-command-health-status'
    );
    const logDeprecation = proxyquire('../../../../lib/utils/log-deprecation', {
      './health-status-filename': healthStatusFilename,
    });

    expect(await pathExists(path.dirname(healthStatusFilename))).to.equal(false);

    logDeprecation('CODE1', 'Start using deprecation log');
    await logDeprecation.printSummary();

    expect(await fsp.readFile(healthStatusFilename, 'utf8')).to.include(
      'Start using deprecation log'
    );
  });
});
