'use strict';

const path = require('path');
const { overrideEnv } = require('../../../utils/process');
const fsp = require('fs').promises;
const conditionallyLoadDotenv = require('../../../../lib/cli/conditionally-load-dotenv');

const expect = require('chai').expect;

describe('test/unit/lib/cli/conditionally-load-dotenv.test.js', () => {
  let restoreEnv;

  before(async () => {
    const defaultFileContent = 'DEFAULT_ENV_VARIABLE=valuefromdefault';
    await fsp.writeFile(path.resolve('.env'), defaultFileContent);

    const stage = 'testing';
    const stageFileContent = 'STAGE_ENV_VARIABLE=valuefromstage';
    await fsp.writeFile(path.resolve(`.env.${stage}`), stageFileContent);
  });

  beforeEach(() => {
    ({ restoreEnv } = overrideEnv());
  });
  afterEach(() => {
    restoreEnv && restoreEnv();
  });

  it('should load environment variables from default .env file if no matching stage', async () => {
    await conditionallyLoadDotenv({}, { useDotenv: true });

    expect(process.env.DEFAULT_ENV_VARIABLE).to.equal('valuefromdefault');
    expect(process.env.STAGE_ENV_VARIABLE).to.be.undefined;
  });

  it('should load environment variables from stage .env file if matching stage', async () => {
    await conditionallyLoadDotenv({ stage: 'testing' }, { useDotenv: true });
    expect(process.env.DEFAULT_ENV_VARIABLE).to.be.undefined;
    expect(process.env.STAGE_ENV_VARIABLE).to.equal('valuefromstage');
  });

  it('should reject invalid CLI stage when loading dotenv files', async () => {
    await expect(
      conditionallyLoadDotenv({ stage: 'foo/bar' }, { useDotenv: true })
    ).to.be.eventually.rejected.and.have.property('code', 'INVALID_STAGE');
  });

  it('should reject invalid configured stage when loading dotenv files', async () => {
    await expect(
      conditionallyLoadDotenv({}, { useDotenv: true, provider: { stage: 'feature.prod' } })
    ).to.be.eventually.rejected.and.have.property('code', 'INVALID_STAGE');
  });

  it('should not validate stage when dotenv loading is disabled', async () => {
    expect(await conditionallyLoadDotenv({ stage: 'foo/bar' }, { useDotenv: false })).to.equal(
      false
    );
  });
});
