'use strict';

const os = require('os');
const path = require('path');
const expect = require('chai').expect;
const sinon = require('sinon');
const resolveCacheDir = require('../../../../lib/utils/resolve-cache-dir');

describe('#resolveCacheDir()', () => {
  let originalLocalAppData;
  let originalXdgCacheHome;

  beforeEach(() => {
    originalLocalAppData = process.env.LOCALAPPDATA;
    originalXdgCacheHome = process.env.XDG_CACHE_HOME;
    delete process.env.LOCALAPPDATA;
    delete process.env.XDG_CACHE_HOME;
  });

  afterEach(() => {
    if (originalLocalAppData == null) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    if (originalXdgCacheHome == null) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdgCacheHome;
    sinon.restore();
  });

  it('should resolve the macOS cache directory', () => {
    sinon.stub(os, 'platform').returns('darwin');
    sinon.stub(os, 'homedir').returns(path.join(path.sep, 'home-dir'));

    expect(resolveCacheDir('serverless')).to.equal(
      path.join(path.sep, 'home-dir', 'Library', 'Caches', 'serverless')
    );
  });

  it('should resolve the Windows cache directory from LOCALAPPDATA', () => {
    sinon.stub(os, 'platform').returns('win32');
    process.env.LOCALAPPDATA = path.join(path.sep, 'local-app-data');

    expect(resolveCacheDir('serverless')).to.equal(
      path.join(path.sep, 'local-app-data', 'serverless', 'Cache')
    );
  });

  it('should resolve the Windows cache directory from the home directory', () => {
    sinon.stub(os, 'platform').returns('win32');
    sinon.stub(os, 'homedir').returns(path.join(path.sep, 'home-dir'));

    expect(resolveCacheDir('serverless')).to.equal(
      path.join(path.sep, 'home-dir', 'AppData', 'Local', 'serverless', 'Cache')
    );
  });

  it('should resolve the cache directory from XDG_CACHE_HOME on other platforms', () => {
    sinon.stub(os, 'platform').returns('linux');
    process.env.XDG_CACHE_HOME = path.join(path.sep, 'xdg-cache');

    expect(resolveCacheDir('serverless')).to.equal(path.join(path.sep, 'xdg-cache', 'serverless'));
  });

  it('should resolve the cache directory from the home directory on other platforms', () => {
    sinon.stub(os, 'platform').returns('linux');
    sinon.stub(os, 'homedir').returns(path.join(path.sep, 'home-dir'));

    expect(resolveCacheDir('serverless')).to.equal(
      path.join(path.sep, 'home-dir', '.cache', 'serverless')
    );
  });
});
