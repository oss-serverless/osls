import { promises as fsp } from 'node:fs';
import path from 'node:path';
import * as sandbox from 'sinon';
import { expect } from 'chai';
import { overrideEnv } from '../../../utils/process.ts';
import { getTmpDirPath, pathExists } from '../../../utils/fs.ts';
import ServerlessError from '../../../../lib/serverless-error.ts';
import healthStatusFilename from '../../../../lib/utils/health-status-filename.ts';
import esmock from 'esmock';

// A fresh module instance, so no deprecation is reported as triggered or buffered already
const loadLogDeprecation = async () =>
  (await esmock('../../../../lib/utils/log-deprecation.ts')).default;

describe('test/unit/lib/utils/logDeprecation.test.ts', () => {
  let restoreEnv;

  beforeEach(() => {
    ({ restoreEnv } = overrideEnv({
      whitelist: ['APPDATA', 'HOME', 'PATH', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE'],
    }));
  });

  afterEach(async () => {
    sandbox.restore();
    await fsp.unlink(healthStatusFilename).catch(() => null);
    restoreEnv();
  });

  it('should throw on deprecation if error notifications mode set in service config', async () => {
    const logDeprecation = await loadLogDeprecation();
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

  it('should honor env notification mode set after module load', async () => {
    const logDeprecation = await loadLogDeprecation();
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

  it('should honor env disabled deprecations set after module load', async () => {
    const logDeprecation = await loadLogDeprecation();

    process.env.SLS_DEPRECATION_DISABLE = 'CODE_DYNAMIC_ENV_DISABLE';

    expect(() =>
      logDeprecation('CODE_DYNAMIC_ENV_DISABLE', 'Dynamic env disable', {
        serviceConfig: { deprecationNotificationMode: 'error' },
      })
    ).to.not.throw();
  });

  it('should write deprecation docs URL to summary output', async () => {
    const logDeprecation = await loadLogDeprecation();

    logDeprecation('CODE1', 'Start using deprecation log');
    await logDeprecation.printSummary();

    const summary = await fsp.readFile(healthStatusFilename, 'utf8');

    expect(summary).to.include('Start using deprecation log');
    expect(summary).to.include(
      'More info: https://github.com/oss-serverless/osls/blob/4.x/docs/guides/deprecations.md#CODE1'
    );
  });

  it('should create the health status parent directory before writing summary output', async () => {
    const tmpHealthStatusFilename = path.join(
      getTmpDirPath(),
      '.serverless',
      'last-command-health-status'
    );
    const logDeprecation = (
      await esmock('../../../../lib/utils/log-deprecation.ts', {
        // A primitive default export has to be passed as `default`
        '../../../../lib/utils/health-status-filename.ts': { default: tmpHealthStatusFilename },
      })
    ).default;

    expect(await pathExists(path.dirname(tmpHealthStatusFilename))).to.equal(false);

    logDeprecation('CODE1', 'Start using deprecation log');
    await logDeprecation.printSummary();

    expect(await fsp.readFile(tmpHealthStatusFilename, 'utf8')).to.include(
      'Start using deprecation log'
    );
  });
});
