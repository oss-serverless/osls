'use strict';

const path = require('path');
const sinon = require('sinon');
const { overrideEnv } = require('../../../utils/process');
const fsp = require('fs').promises;
const loadEnv = require('../../../../lib/cli/load-dotenv');
const dotenv = require('dotenv');
const ServerlessError = require('../../../../lib/serverless-error');

const expect = require('chai').expect;

describe('test/unit/lib/cli/load-dotenv.test.js', () => {
  let restoreEnv;

  before(async () => {
    const stage = 'testing';
    const stageFileContent = [
      'FROM_STAGE=valuefromstage',
      'EXPANDED_FROM_STAGE=expanded-$FROM_STAGE',
    ].join('\n');
    await fsp.writeFile(path.join(process.cwd(), `.env.${stage}`), stageFileContent);

    const defaultFileContent = [
      'FROM_DEFAULT=valuefromdefault',
      'EXPANDED_FROM_DEFAULT=expanded-$FROM_DEFAULT',
    ].join('\n');
    await fsp.writeFile(path.join(process.cwd(), '.env'), defaultFileContent);
  });

  beforeEach(() => {
    restoreEnv = overrideEnv().restoreEnv;
  });

  afterEach(() => {
    restoreEnv && restoreEnv();
  });

  it('should load matching stage env file if present', async () => {
    await loadEnv('testing');
    expect(process.env).to.not.have.property('FROM_DEFAULT');
    expect(process.env.FROM_STAGE).to.equal('valuefromstage');
  });

  it('should load from default env file if present and no matching stage file found', async () => {
    await loadEnv('nonmatchingstage');
    expect(process.env.FROM_DEFAULT).to.equal('valuefromdefault');
    expect(process.env).to.not.have.property('FROM_STAGE');
  });

  it('should load dotenv files quietly', () => {
    const dotenvResult = sinon.stub(dotenv, 'config').returns({ parsed: {} });

    try {
      loadEnv('testing');

      expect(dotenvResult).to.have.been.calledOnce;
      expect(dotenvResult.firstCall.args[0]).to.deep.equal({
        path: path.join(process.cwd(), '.env.testing'),
        quiet: true,
      });
    } finally {
      dotenvResult.restore();
    }
  });

  it('should not write dotenv runtime logs while falling back to default .env', async () => {
    const logStub = sinon.stub(console, 'log');
    const errorStub = sinon.stub(console, 'error');

    try {
      await loadEnv('nonmatchingstage');

      expect(logStub).to.not.have.been.called;
      expect(errorStub).to.not.have.been.called;
    } finally {
      logStub.restore();
      errorStub.restore();
    }
  });

  it('should expand variables from the selected dotenv file', async () => {
    await loadEnv('testing');

    expect(process.env.EXPANDED_FROM_STAGE).to.equal('expanded-valuefromstage');
    expect(process.env).to.not.have.property('EXPANDED_FROM_DEFAULT');
  });

  it('should preserve existing environment values over dotenv file values', async () => {
    process.env.FROM_STAGE = 'valuefromshell';

    await loadEnv('testing');

    expect(process.env.FROM_STAGE).to.equal('valuefromshell');
    expect(process.env.EXPANDED_FROM_STAGE).to.equal('expanded-valuefromshell');
  });

  it('should throw ServerlessError if dotenv returns error other than missing file', () => {
    const errorMessage = 'Unexpected error while loading env';
    const dotenvResult = sinon.stub(dotenv, 'config').returns({ error: new Error(errorMessage) });

    try {
      expect(() => loadEnv('testing'))
        .to.throw(ServerlessError)
        .with.property('code', 'DOTENV_LOAD_ERROR');
    } finally {
      dotenvResult.restore();
    }
  });

  it('should reject invalid stage before reading dotenv files', () => {
    const dotenvResult = sinon.stub(dotenv, 'config');

    try {
      expect(() => loadEnv('foo/../../tmp/x'))
        .to.throw(ServerlessError)
        .with.property('code', 'INVALID_STAGE');
      expect(dotenvResult).to.not.have.been.called;
    } finally {
      dotenvResult.restore();
    }
  });

  for (const stage of ['café', 'foo\nbar']) {
    it(`should reject invalid dotenv stage ${JSON.stringify(stage)}`, () => {
      expect(() => loadEnv(stage))
        .to.throw(ServerlessError)
        .with.property('code', 'INVALID_STAGE');
    });
  }
});
