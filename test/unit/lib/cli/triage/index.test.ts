'use strict';

const { expect } = require('chai');
const fs = require('fs');
const { overrideCwd, overrideEnv, overrideArgv } = require('../../../../utils/process');
const path = require('path');
const triage = require('../../../../../lib/cli/triage');

const fixturesDirname = path.resolve(__dirname, 'fixtures');

describe('test/unit/lib/cli/triage/index.test.js', () => {
  before(() => overrideEnv({ variables: { SLS_GEO_LOCATION: 'us' } }));

  describe('CLI params', () => {
    it('should favor "serverless" in other cases', async () => {
      await overrideArgv({ args: ['sls', 'print'] }, async () => {
        expect(await triage()).to.equal('serverless');
      });
      await overrideArgv({ args: ['sls', 'deploy'] }, async () => {
        expect(await triage()).to.equal('serverless');
      });
      await overrideArgv({ args: ['sls'] }, async () => {
        expect(await triage()).to.equal('serverless');
      });
      await overrideArgv({ args: ['sls', '--help'] }, async () => {
        expect(await triage()).to.equal('serverless');
      });
    });
  });

  describe('Service configuration', () => {
    let restoreArgv;
    before(() => {
      ({ restoreArgv } = overrideArgv({ args: ['sls', 'deploy'] }));
    });
    after(() => restoreArgv());

    for (const cliName of ['serverless', '@osls/compose']) {
      for (const extension of fs.readdirSync(path.resolve(fixturesDirname, cliName))) {
        for (const fixtureName of fs.readdirSync(
          path.resolve(fixturesDirname, cliName, extension)
        )) {
          const testName = `should recognize "${cliName}" at "${cliName}/${extension}/${fixtureName}"`;
          it(testName, async () =>
            overrideCwd(
              path.resolve(fixturesDirname, cliName, extension, fixtureName),
              async () => {
                expect(await triage()).to.equal(cliName);
              }
            )
          );
        }
      }
    }
  });

  describe('Service configuration with CLI params', () => {
    describe('regular commands', () => {
      let restoreArgv;
      before(() => {
        ({ restoreArgv } = overrideArgv({ args: ['sls', 'doctor'] }));
      });
      after(() => restoreArgv());

      it('should not resolve to `@osls/compose` with compose config present when command should be ignored', async () => {
        await overrideCwd(
          path.resolve(fixturesDirname, '@osls/compose', 'yml', 'project'),
          async () => {
            expect(await triage()).to.equal('serverless');
          }
        );
      });

      it('should not resolve to `@osls/compose` for "config" when compose config is present', async () => {
        await overrideArgv({ args: ['sls', 'config'] }, async () =>
          overrideCwd(
            path.resolve(fixturesDirname, '@osls/compose', 'yml', 'project'),
            async () => {
              expect(await triage()).to.equal('serverless');
            }
          )
        );
      });

      it('should not resolve to `@osls/compose` for "config credentials" when compose config is present', async () => {
        await overrideArgv({ args: ['sls', 'config', 'credentials'] }, async () =>
          overrideCwd(
            path.resolve(fixturesDirname, '@osls/compose', 'yml', 'project'),
            async () => {
              expect(await triage()).to.equal('serverless');
            }
          )
        );
      });

      it('should not resolve to `@osls/compose` for "config --help" when compose config is present', async () => {
        await overrideArgv({ args: ['sls', 'config', '--help'] }, async () =>
          overrideCwd(
            path.resolve(fixturesDirname, '@osls/compose', 'yml', 'project'),
            async () => {
              expect(await triage()).to.equal('serverless');
            }
          )
        );
      });

      it('should not resolve to `@osls/compose` for "config credentials --help" when compose config is present', async () => {
        await overrideArgv({ args: ['sls', 'config', 'credentials', '--help'] }, async () =>
          overrideCwd(
            path.resolve(fixturesDirname, '@osls/compose', 'yml', 'project'),
            async () => {
              expect(await triage()).to.equal('serverless');
            }
          )
        );
      });
    });

    describe('--help handling', () => {
      let restoreArgv;
      before(() => {
        ({ restoreArgv } = overrideArgv({ args: ['sls', '--help'] }));
      });
      after(() => restoreArgv());

      it('should resolve to `@osls/compose` with `--help` when compose config present', async () => {
        await overrideCwd(
          path.resolve(fixturesDirname, '@osls/compose', 'yml', 'project'),
          async () => {
            expect(await triage()).to.equal('@osls/compose');
          }
        );
      });
    });
  });
});
