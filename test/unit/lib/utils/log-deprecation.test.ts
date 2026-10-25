import { promises as fsp } from 'node:fs';
import path from 'node:path';
import proxyquire from 'proxyquire';
import * as sandbox from 'sinon';
import { expect } from 'chai';
import { overrideEnv } from '../../../utils/process.ts';
import { getTmpDirPath, pathExists } from '../../../utils/fs.ts';
import ServerlessError from '../../../../lib/serverless-error.ts';
import logDeprecation2 from '../../../../lib/utils/log-deprecation.ts';

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
    const healthStatusFilename = (await import('../../../../lib/utils/health-status-filename.ts'))
      .default;
    await fsp.unlink(healthStatusFilename).catch(() => null);
    restoreEnv();
  });

  it('should throw on deprecation if error notifications mode set in service config', () => {
    const logDeprecation = logDeprecation2;
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
    const logDeprecation = logDeprecation2;
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
    const logDeprecation = logDeprecation2;

    process.env.SLS_DEPRECATION_DISABLE = 'CODE_DYNAMIC_ENV_DISABLE';

    expect(() =>
      logDeprecation('CODE_DYNAMIC_ENV_DISABLE', 'Dynamic env disable', {
        serviceConfig: { deprecationNotificationMode: 'error' },
      })
    ).to.not.throw();
  });

  it('should write deprecation docs URL to summary output', async () => {
    const logDeprecation = (await import('../../../../lib/utils/log-deprecation.ts')).default;
    const healthStatusFilename = (await import('../../../../lib/utils/health-status-filename.ts'))
      .default;

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
