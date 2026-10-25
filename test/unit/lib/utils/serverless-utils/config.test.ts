'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');
const requireUncached = require('../../../../utils/require-uncached');
const sinon = require('sinon');
const { overrideEnv, overrideCwd } = require('../../../../utils/process');
const { ensureDir, pathExists, remove } = require('../../../../utils/fs');

const loadConfigModule = () =>
  requireUncached(() => require('../../../../../lib/utils/serverless-utils/config'));

const withIsolatedHome = async (name, callback) => {
  const homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${name}-home-`));

  return overrideEnv({ asCopy: true }, async () => {
    const homedirStub = sinon.stub(os, 'homedir').returns(homeDir);

    try {
      return await callback(homeDir);
    } finally {
      homedirStub.restore();
      await remove(homeDir);
    }
  });
};

const withLocalDir = async (homeDir, name, callback) => {
  const localDir = path.join(homeDir, name);
  await ensureDir(localDir);

  const { restoreCwd } = overrideCwd(localDir);

  try {
    return await callback(localDir);
  } finally {
    restoreCwd();
  }
};

describe('serverless-utils/config', () => {
  afterEach(() => {
    delete Object.prototype.polluted;
  });

  it('exports the generic config helpers only', () => {
    const config = loadConfigModule();

    expect(config).to.have.keys(['CONFIG_FILE_NAME', 'delete', 'get', 'getConfig', 'set']);
    expect(config).to.not.have.property('getLoggedInUser');
  });

  it('prefers the default global config when both global locations exist', async () => {
    await withIsolatedHome('config-both-globals', async (homeDir) => {
      const config = loadConfigModule();
      const homeConfigDir = path.join(homeDir, '.config');
      const homeConfigPath = path.join(homeConfigDir, config.CONFIG_FILE_NAME);
      const defaultGlobalPath = path.join(homeDir, config.CONFIG_FILE_NAME);

      await withLocalDir(homeDir, 'service', async () => {
        await ensureDir(homeConfigDir);
        await Promise.all([
          fs.promises.writeFile(homeConfigPath, JSON.stringify({ featureFlag: 'home' }, null, 2)),
          fs.promises.writeFile(
            defaultGlobalPath,
            JSON.stringify({ featureFlag: 'default', releaseChannel: 'stable' }, null, 2)
          ),
        ]);

        expect(config.getConfig()).to.deep.equal({
          featureFlag: 'default',
          releaseChannel: 'stable',
        });
      });
    });
  });

  it('merges local and global config and updates only the local config on set/delete', async () => {
    await withIsolatedHome('config-local-and-global', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async (localDir) => {
        const localConfigPath = path.join(localDir, config.CONFIG_FILE_NAME);
        const globalConfigPath = path.join(homeDir, config.CONFIG_FILE_NAME);

        await Promise.all([
          fs.promises.writeFile(localConfigPath, JSON.stringify({ featureFlag: true }, null, 2)),
          fs.promises.writeFile(
            globalConfigPath,
            JSON.stringify({ featureFlag: false, releaseChannel: 'stable' }, null, 2)
          ),
        ]);

        expect(config.getConfig()).to.deep.equal({
          featureFlag: true,
          releaseChannel: 'stable',
        });

        config.set('custom.value', 'somevalue');
        expect(
          JSON.parse(await fs.promises.readFile(localConfigPath, 'utf8')).custom.value
        ).to.equal('somevalue');
        expect(
          JSON.parse(await fs.promises.readFile(globalConfigPath, 'utf8'))
        ).to.not.have.property('custom');

        config.delete('featureFlag');
        expect(
          JSON.parse(await fs.promises.readFile(localConfigPath, 'utf8'))
        ).to.not.have.property('featureFlag');
        expect(JSON.parse(await fs.promises.readFile(globalConfigPath, 'utf8'))).to.have.property(
          'featureFlag'
        );
      });
    });
  });

  it('creates a Bref-compatible default global config when no config files exist', async () => {
    await withIsolatedHome('config-create-default', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        const globalConfigPath = path.join(homeDir, config.CONFIG_FILE_NAME);

        expect(config.get('meta.created_at')).to.be.a('number');
        expect(config.get('frameworkId')).to.be.a('string');
        expect((await fs.promises.stat(globalConfigPath)).isFile()).to.equal(true);

        const result = config.getConfig();
        expect(result.frameworkId).to.be.a('string');
        expect(result.meta.created_at).to.be.a('number');
        expect(result.meta.updated_at).to.be.a('number');

        delete result.frameworkId;
        delete result.meta;
        expect(result).to.deep.equal({});
      });
    });
  });

  it('preserves an existing frameworkId when updating config', async () => {
    await withIsolatedHome('config-preserve-framework-id', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        const globalConfigPath = path.join(homeDir, config.CONFIG_FILE_NAME);
        const legacyFrameworkId = 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';

        await fs.promises.writeFile(
          globalConfigPath,
          JSON.stringify(
            {
              frameworkId: legacyFrameworkId,
              meta: {
                created_at: 123,
                updated_at: 123,
              },
            },
            null,
            2
          )
        );

        expect(config.get('frameworkId')).to.equal(legacyFrameworkId);

        config.set('custom.value', 'somevalue');

        const storedConfig = JSON.parse(await fs.promises.readFile(globalConfigPath, 'utf8'));
        expect(storedConfig.frameworkId).to.equal(legacyFrameworkId);
      });
    });
  });

  it('uses the ~/.config global config when it exists alone', async () => {
    await withIsolatedHome('config-home-config-only', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        const homeConfigDir = path.join(homeDir, '.config');
        const homeConfigPath = path.join(homeConfigDir, config.CONFIG_FILE_NAME);
        const defaultGlobalPath = path.join(homeDir, config.CONFIG_FILE_NAME);

        await ensureDir(homeConfigDir);
        await fs.promises.writeFile(
          homeConfigPath,
          JSON.stringify({ featureFlag: true, releaseChannel: 'beta' }, null, 2)
        );

        expect(config.getConfig()).to.deep.equal({
          featureFlag: true,
          releaseChannel: 'beta',
        });
        expect(await pathExists(defaultGlobalPath)).to.equal(false);
      });
    });
  });

  it('backs up malformed local config files and treats them as empty', async () => {
    await withIsolatedHome('config-malformed-local', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async (localDir) => {
        const localConfigPath = path.join(localDir, config.CONFIG_FILE_NAME);

        await fs.promises.writeFile(localConfigPath, '{"broken"');

        const result = config.getConfig();

        expect(result.frameworkId).to.be.a('string');
        expect(await pathExists(`${localConfigPath}.bak`)).to.equal(true);
      });
    });
  });

  it('backs up malformed ~/.config global files and recreates the default global config', async () => {
    await withIsolatedHome('config-malformed-global', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        const homeConfigDir = path.join(homeDir, '.config');
        const homeConfigPath = path.join(homeConfigDir, config.CONFIG_FILE_NAME);
        const defaultGlobalPath = path.join(homeDir, config.CONFIG_FILE_NAME);

        await ensureDir(homeConfigDir);
        await fs.promises.writeFile(homeConfigPath, '{"broken"');

        const result = config.getConfig();

        expect(result.frameworkId).to.be.a('string');
        expect(await pathExists(`${homeConfigPath}.bak`)).to.equal(true);
        expect(await pathExists(defaultGlobalPath)).to.equal(true);
      });
    });
  });

  it('supports deleting nested property paths', async () => {
    await withIsolatedHome('config-nested-delete', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        const globalConfigPath = path.join(homeDir, config.CONFIG_FILE_NAME);

        await fs.promises.writeFile(
          globalConfigPath,
          JSON.stringify(
            {
              items: {
                id1: { name: 'John' },
                id2: { name: 'James' },
              },
              otherItems: {
                firstKey: { prop: 'nested' },
                secondKey: { prop: 'secondnested' },
              },
            },
            null,
            2
          )
        );

        config.delete(['items.id1', 'otherItems.secondKey']);

        expect(config.getConfig()).to.deep.include({
          items: {
            id2: { name: 'James' },
          },
          otherItems: {
            firstKey: { prop: 'nested' },
          },
        });
      });
    });
  });

  it('supports dot and bracket paths with array indices', async () => {
    await withIsolatedHome('config-array-paths', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        const globalConfigPath = path.join(homeDir, config.CONFIG_FILE_NAME);

        config.set('users.0.name', 'Jane');
        config.set('users[1].name', 'John');

        expect(config.get('users.0.name')).to.equal('Jane');
        expect(config.get('users[1].name')).to.equal('John');

        const stored = JSON.parse(await fs.promises.readFile(globalConfigPath, 'utf8'));

        expect(stored.users).to.deep.equal([{ name: 'Jane' }, { name: 'John' }]);

        config.delete('users[0].name');
        expect(config.getConfig().users[0]).to.deep.equal({});
      });
    });
  });

  it('returns undefined for an undefined path', async () => {
    await withIsolatedHome('config-undefined-path', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        expect(config.get(undefined)).to.equal(undefined);
      });
    });
  });

  it('preserves existing legacy keys when updating config', async () => {
    await withIsolatedHome('config-preserve-legacy', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        const globalConfigPath = path.join(homeDir, config.CONFIG_FILE_NAME);

        await fs.promises.writeFile(
          globalConfigPath,
          JSON.stringify(
            {
              trackingDisabled: true,
              enterpriseDisabled: true,
              userId: 'user-1',
              users: {
                'user-1': {
                  dashboard: {
                    username: 'jdoe',
                  },
                },
              },
            },
            null,
            2
          )
        );

        config.set('custom.value', 'somevalue');

        const stored = JSON.parse(await fs.promises.readFile(globalConfigPath, 'utf8'));

        expect(stored).to.include({
          trackingDisabled: true,
          enterpriseDisabled: true,
          userId: 'user-1',
        });
        expect(stored.users['user-1'].dashboard.username).to.equal('jdoe');
        expect(stored.custom.value).to.equal('somevalue');
      });
    });
  });

  it('uses a stage-specific config filename for non-prod platform stages', async () => {
    await overrideEnv({ asCopy: true }, async () => {
      process.env.SERVERLESS_PLATFORM_STAGE = 'staging';

      const config = loadConfigModule();

      expect(config.CONFIG_FILE_NAME).to.equal('.serverlessstagingrc');
    });
  });

  it('uses the default config filename for the prod platform stage', async () => {
    await overrideEnv({ asCopy: true }, async () => {
      process.env.SERVERLESS_PLATFORM_STAGE = 'prod';

      const config = loadConfigModule();

      expect(config.CONFIG_FILE_NAME).to.equal('.serverlessrc');
    });
  });

  it('supports quoted bracket keys containing dots', async () => {
    await withIsolatedHome('config-quoted-dot-key', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        config.set('users["jane.doe"].dashboard.username', 'jdoe');

        expect(config.get('users["jane.doe"].dashboard.username')).to.equal('jdoe');
        expect(config.getConfig()).to.deep.include({
          users: {
            'jane.doe': {
              dashboard: {
                username: 'jdoe',
              },
            },
          },
        });
      });
    });
  });

  it('does not allow prototype pollution through string paths', async () => {
    await withIsolatedHome('config-unsafe-set', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        config.set('__proto__.polluted', 'yes');

        expect(config.get('__proto__.polluted')).to.equal(undefined);
        expect({}.polluted).to.equal(undefined);
      });
    });
  });

  it('does not allow constructor.prototype pollution through string paths', async () => {
    await withIsolatedHome('config-unsafe-constructor-set', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async () => {
        config.set('constructor.prototype.polluted', 'yes');

        expect({}.polluted).to.equal(undefined);
      });
    });
  });

  it('drops unsafe keys when merging config files', async () => {
    await withIsolatedHome('config-unsafe-merge', async (homeDir) => {
      const config = loadConfigModule();

      await withLocalDir(homeDir, 'service', async (localDir) => {
        const localConfigPath = path.join(localDir, config.CONFIG_FILE_NAME);
        const globalConfigPath = path.join(homeDir, config.CONFIG_FILE_NAME);

        await Promise.all([
          fs.promises.writeFile(
            globalConfigPath,
            '{"releaseChannel":"stable","__proto__":{"polluted":"yes"}}'
          ),
          fs.promises.writeFile(localConfigPath, '{"featureFlag":true}'),
        ]);

        expect(config.getConfig()).to.deep.equal({
          featureFlag: true,
          releaseChannel: 'stable',
        });
        expect({}.polluted).to.equal(undefined);
      });
    });
  });
});
