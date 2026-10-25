'use strict';

const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const { PassThrough } = require('stream');
const JsZip = require('jszip');
const glob = require('../../../../../../lib/utils/glob');
const fs = require('fs');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const isObject = require('type/object/is');
const Utils = require('../../../../../../lib/classes/utils');
const { getTmpDirPath } = require('../../../../../utils/fs');

// Configure chai
const { expect } = require('chai');

const describeLargeZipSmoke = process.env.SERVERLESS_LARGE_ZIP_SMOKE ? describe : describe.skip;

const forceGc = () => {
  expect(global.gc, 'run with --expose-gc').to.be.a('function');
  for (let index = 0; index < 3; ++index) global.gc();
};

const createServerlessLike = (serviceDir) => {
  const serverlessLike = {
    serviceDir,
    service: {
      service: 'first-service',
      package: {},
    },
  };
  serverlessLike.utils = new Utils(serverlessLike);
  return serverlessLike;
};

const resolveSpawnCall = (stub, output = '') =>
  stub.resolves({ stdoutBuffer: Buffer.from(output) });
const rejectSpawnCall = (stub) => stub.rejects(new Error('npm ls failed'));
const expectNpmListCall = (stub, index, envName) => {
  const call = stub.getCall(index);
  expect(call.args[0]).to.equal('npm');
  expect(call.args[1]).to.deep.equal([
    'ls',
    `--${envName}=true`,
    '--parseable=true',
    '--long=false',
    '--silent',
    '--all',
  ]);
  expect(call.args[2].cwd).to.match(/.+/);
  expect(call.args[2].stdio[0]).to.equal('ignore');
  expect(call.args[2].stdio[1]).to.be.a('number');
  expect(call.args[2].stdio[2]).to.equal('ignore');
  expect(call.args[2]).to.not.have.property('shell');
};

let Package;
let spawnExtStub;

describe('zipService', () => {
  let tmpDirPath;
  let serverless;
  let packagePlugin;
  let params;

  beforeEach(() => {
    tmpDirPath = getTmpDirPath();
    spawnExtStub = sinon.stub().resolves({ stdoutBuffer: Buffer.alloc(0) });
    const zipService = proxyquire('../../../../../../lib/plugins/package/lib/zip-service', {
      '../../../utils/spawn': spawnExtStub,
    });
    Package = proxyquire('../../../../../../lib/plugins/package/package', {
      './lib/zip-service': zipService,
    });
    serverless = createServerlessLike(tmpDirPath);
    packagePlugin = new Package(serverless, {});
    params = {
      include: ['user-defined-include-me'],
      exclude: ['user-defined-exclude-me'],
      zipFileName: 'my-service.zip',
    };
  });

  describe('#zipService()', () => {
    let excludeDevDependenciesStub;
    let zipStub;

    beforeEach(() => {
      excludeDevDependenciesStub = sinon.stub(packagePlugin, 'excludeDevDependencies').resolves();
      zipStub = sinon.stub(packagePlugin, 'zip').resolves();
    });

    afterEach(() => {
      packagePlugin.excludeDevDependencies.restore();
      packagePlugin.zip.restore();
    });

    it('should run promise chain in order', async () => {
      const exclude = params.exclude;
      const include = params.include;
      const zipFileName = params.zipFileName;

      return expect(packagePlugin.zipService(exclude, include, zipFileName)).to.be.fulfilled.then(
        () => {
          expect(excludeDevDependenciesStub).to.have.been.calledOnce;
          expect(zipStub).to.have.been.calledOnce;
        }
      );
    });
  });

  describe('#getFileContentAndStat()', () => {
    let serviceDir;

    beforeEach(() => {
      serviceDir = serverless.serviceDir;
      fs.mkdirSync(serviceDir);
    });

    it('should keep the file content as is', async () => {
      const buf = Buffer.from([10, 20, 30, 40, 50]);
      const filePath = path.join(serviceDir, 'bin-file');

      fs.writeFileSync(filePath, buf);

      return expect(packagePlugin.getFileContentAndStat(filePath)).to.be.fulfilled.then(
        (result) => {
          expect(result.data).to.deep.equal(buf);
        }
      );
    });
  });

  describe('#getFileContent()', () => {
    let serviceDir;

    beforeEach(() => {
      serviceDir = serverless.serviceDir;
      fs.mkdirSync(serviceDir);
    });

    it('should keep the file content as is', async () => {
      const buf = Buffer.from([10, 20, 30, 40, 50]);
      const filePath = path.join(serviceDir, 'bin-file');

      fs.writeFileSync(filePath, buf);

      return expect(packagePlugin.getFileContent(filePath)).to.be.fulfilled.then((result) => {
        expect(result).to.deep.equal(buf);
      });
    });
  });

  describe('#excludeDevDependencies()', () => {
    it('should resolve when opted out of dev dependency exclusion', async () => {
      packagePlugin.serverless.service.package.excludeDevDependencies = false;

      return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
        (updatedParams) => {
          expect(updatedParams).to.deep.equal(params);
        }
      );
    });

    describe('when dealing with Node.js runtimes', () => {
      let globSyncStub;
      let closeFileStub;
      let openFileAsyncStub;
      let readFileAsyncStub;
      let nextFileDescriptor;
      let serviceDir;

      beforeEach(() => {
        serviceDir = packagePlugin.serverless.serviceDir;
        nextFileDescriptor = 100;
        globSyncStub = sinon.stub(glob, 'sync');
        readFileAsyncStub = sinon.stub(fs.promises, 'readFile');
        closeFileStub = sinon.stub().resolves();
        openFileAsyncStub = sinon.stub(fs.promises, 'open').callsFake(async () => ({
          fd: nextFileDescriptor++,
          close: closeFileStub,
        }));
      });

      afterEach(() => {
        glob.sync.restore();
        fs.promises.readFile.restore();
        fs.promises.open.restore();
      });

      it('does not add async helpers to core modules when loaded', () => {
        const fakeFs = { promises: { readFile: () => {} } };
        const fakeSpawn = () => {};

        proxyquire.noCallThru().load('../../../../../../lib/plugins/package/lib/zip-service', {
          'fs': fakeFs,
          '../../../utils/spawn': fakeSpawn,
        });

        expect(fakeSpawn).to.not.have.property('spawnAsync');
        expect(fakeFs).to.not.have.property('readFileAsync');
      });

      it('should do nothing if no packages are used', async () => {
        const filePaths = [];

        globSyncStub.returns(filePaths);

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.have.been.calledOnce;
            expect(spawnExtStub).to.not.have.been.called;
            expect(readFileAsyncStub).to.not.have.been.called;
            expect(globSyncStub).to.have.been.calledWithExactly(['**/package.json'], {
              cwd: packagePlugin.serverless.serviceDir,
              dot: true,
              ignore: ['**/node_modules/**'],
              silent: true,
              follow: true,
              nosort: true,
            });
            expect(updatedParams.exclude).to.deep.equal(['user-defined-exclude-me']);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });

      it('should do nothing if no dependencies are found', async () => {
        const filePaths = ['package.json', 'node_modules'];

        globSyncStub.returns(filePaths);
        resolveSpawnCall(spawnExtStub);
        const depPaths = '';
        readFileAsyncStub.resolves(depPaths);

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.have.been.calledOnce;
            expect(spawnExtStub).to.have.been.calledTwice;
            expect(readFileAsyncStub).to.have.been.calledTwice;
            expect(globSyncStub).to.have.been.calledWithExactly(['**/package.json'], {
              cwd: packagePlugin.serverless.serviceDir,
              dot: true,
              ignore: ['**/node_modules/**'],
              silent: true,
              follow: true,
              nosort: true,
            });
            expectNpmListCall(spawnExtStub, 0, 'dev');
            expectNpmListCall(spawnExtStub, 1, 'prod');
            expect(openFileAsyncStub).to.have.been.calledTwice;
            expect(closeFileStub).to.have.been.calledTwice;
            expect(updatedParams.exclude).to.deep.equal(['user-defined-exclude-me']);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });

      it('does not traverse node_modules package.json files during package discovery', async () => {
        globSyncStub.returns(['package.json', path.join('packages', 'api', 'package.json')]);
        resolveSpawnCall(spawnExtStub);
        readFileAsyncStub.resolves('');

        await packagePlugin.excludeDevDependencies(params);

        expect(globSyncStub).to.have.been.calledWithExactly(['**/package.json'], {
          cwd: packagePlugin.serverless.serviceDir,
          dot: true,
          ignore: ['**/node_modules/**'],
          silent: true,
          follow: true,
          nosort: true,
        });
      });

      it('keeps node_modules package.json filtering as a backstop', async () => {
        globSyncStub.returns(['package.json', path.join('node_modules', 'dep', 'package.json')]);
        resolveSpawnCall(spawnExtStub);
        readFileAsyncStub.resolves('');

        await packagePlugin.excludeDevDependencies(params);

        expect(spawnExtStub).to.have.been.calledTwice;
      });

      it('should stream npm ls stdout to dependency files without shell redirection', async () => {
        const filePaths = ['package.json', 'node_modules'];

        globSyncStub.returns(filePaths);
        resolveSpawnCall(spawnExtStub.onCall(0));
        resolveSpawnCall(spawnExtStub.onCall(1));
        readFileAsyncStub.resolves('');

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(() => {
          expectNpmListCall(spawnExtStub, 0, 'dev');
          expectNpmListCall(spawnExtStub, 1, 'prod');
          expect(openFileAsyncStub).to.have.been.calledTwice;
          expect(openFileAsyncStub.getCalls().map((call) => call.args[1])).to.deep.equal([
            'a',
            'a',
          ]);
          const openedFiles = openFileAsyncStub
            .getCalls()
            .map((call) => path.basename(call.args[0]));
          expect(
            openedFiles.some((fileName) => /^node-dependencies-[0-9a-f]{24}-dev$/.test(fileName))
          ).to.equal(true);
          expect(
            openedFiles.some((fileName) => /^node-dependencies-[0-9a-f]{24}-prod$/.test(fileName))
          ).to.equal(true);
          expect(closeFileStub).to.have.been.calledTwice;
        });
      });

      it('should return excludes and includes if an error is thrown in the global scope', () => {
        globSyncStub.throws();

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.have.been.calledOnce;
            expect(spawnExtStub).to.not.have.been.called;
            expect(readFileAsyncStub).to.not.have.been.called;
            expect(updatedParams.exclude).to.deep.equal(['user-defined-exclude-me']);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });

      it('should return excludes and includes if an npm ls spawn is rejected', async () => {
        const filePaths = ['package.json', 'node_modules'];

        globSyncStub.returns(filePaths);
        resolveSpawnCall(spawnExtStub.onCall(0));
        rejectSpawnCall(spawnExtStub.onCall(1));
        readFileAsyncStub.resolves();

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.been.calledOnce;
            expect(spawnExtStub).to.have.been.calledTwice;
            expect(closeFileStub).to.have.been.calledTwice;
            expect(readFileAsyncStub).to.have.been.calledTwice;
            expect(updatedParams.exclude).to.deep.equal(['user-defined-exclude-me']);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });

      it('should return excludes and includes if a readFile Promise is rejected', async () => {
        const filePaths = ['package.json', 'node_modules'];

        globSyncStub.returns(filePaths);
        resolveSpawnCall(spawnExtStub);

        readFileAsyncStub.onCall(0).resolves();
        readFileAsyncStub.onCall(1).rejects();

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.been.calledOnce;
            expect(spawnExtStub).to.have.been.calledTwice;
            expect(readFileAsyncStub).to.have.been.calledTwice;
            expect(updatedParams.exclude).to.deep.equal(['user-defined-exclude-me']);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });

      it('should fail silently and continue if "npm ls" call throws an error', async () => {
        const filePaths = [
          // root of the service
          'package.json',
          'node_modules',
          // nested-dir
          // NOTE: reading the dependencies in this directory will fail in this tests
          path.join('1st', 'package.json'),
          path.join('1st', 'node_modules'),
          // nested-dir which is nested
          path.join('1st', '2nd', 'package.json'),
          path.join('1st', '2nd', 'node_modules'),
        ];

        globSyncStub.returns(filePaths);
        resolveSpawnCall(spawnExtStub.onCall(0));
        resolveSpawnCall(spawnExtStub.onCall(1));
        rejectSpawnCall(spawnExtStub.onCall(2));
        rejectSpawnCall(spawnExtStub.onCall(3));
        resolveSpawnCall(spawnExtStub.onCall(4));
        resolveSpawnCall(spawnExtStub.onCall(5));
        const depPaths = [
          path.join(serviceDir, 'node_modules', 'module-1'),
          path.join(serviceDir, 'node_modules', 'module-2'),
          path.join(serviceDir, '1st', '2nd', 'node_modules', 'module-1'),
          path.join(serviceDir, '1st', '2nd', 'node_modules', 'module-2'),
        ].join(os.EOL);
        readFileAsyncStub.withArgs(sinon.match(/dev$/)).resolves(depPaths);
        readFileAsyncStub.withArgs(sinon.match(/prod$/)).resolves([]);
        readFileAsyncStub.onCall(2).resolves('{}');
        readFileAsyncStub.onCall(3).resolves('{}');
        readFileAsyncStub.onCall(4).resolves('{}');
        readFileAsyncStub.onCall(5).resolves('{}');

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.have.been.calledOnce;
            expect(spawnExtStub.callCount).to.equal(6);
            expect(readFileAsyncStub).to.have.callCount(6);
            expect(readFileAsyncStub).to.have.been.calledWith(
              path.join(serviceDir, 'node_modules', 'module-1', 'package.json')
            );
            expect(readFileAsyncStub).to.have.been.calledWith(
              path.join(serviceDir, 'node_modules', 'module-2', 'package.json')
            );
            expect(readFileAsyncStub).to.have.been.calledWith(
              path.join(serviceDir, '1st', '2nd', 'node_modules', 'module-1', 'package.json')
            );
            expect(readFileAsyncStub).to.have.been.calledWith(
              path.join(serviceDir, '1st', '2nd', 'node_modules', 'module-1', 'package.json')
            );
            expect(globSyncStub).to.have.been.calledWithExactly(['**/package.json'], {
              cwd: packagePlugin.serverless.serviceDir,
              dot: true,
              ignore: ['**/node_modules/**'],
              silent: true,
              follow: true,
              nosort: true,
            });
            ['dev', 'prod', 'dev', 'prod', 'dev', 'prod'].forEach((envName, index) => {
              expectNpmListCall(spawnExtStub, index, envName);
            });
            expect(updatedParams.exclude).to.deep.equal([
              'user-defined-exclude-me',
              path.join('node_modules', 'module-1', '**'),
              path.join('node_modules', 'module-2', '**'),
              path.join('1st', '2nd', 'node_modules', 'module-1', '**'),
              path.join('1st', '2nd', 'node_modules', 'module-2', '**'),
            ]);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });

      it('should exclude dev dependencies in the services root directory', async () => {
        const filePaths = ['package.json', 'node_modules'];

        globSyncStub.returns(filePaths);
        resolveSpawnCall(spawnExtStub);
        const depPaths = [
          path.join(serviceDir, 'node_modules', 'module-1'),
          path.join(serviceDir, 'node_modules', 'module-2'),
        ].join(os.EOL);
        readFileAsyncStub.withArgs(sinon.match(/dev$/)).resolves(depPaths);
        readFileAsyncStub.withArgs(sinon.match(/prod$/)).resolves([]);
        readFileAsyncStub.onCall(2).resolves('{}');
        readFileAsyncStub.onCall(3).resolves('{}');

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.have.been.calledOnce;
            expect(spawnExtStub).to.have.been.calledTwice;
            expect(readFileAsyncStub).to.have.callCount(4);
            expect(readFileAsyncStub).to.have.been.calledWith(
              path.join(serviceDir, 'node_modules', 'module-1', 'package.json')
            );
            expect(readFileAsyncStub).to.have.been.calledWith(
              path.join(serviceDir, 'node_modules', 'module-2', 'package.json')
            );
            expect(globSyncStub).to.have.been.calledWithExactly(['**/package.json'], {
              cwd: packagePlugin.serverless.serviceDir,
              dot: true,
              ignore: ['**/node_modules/**'],
              silent: true,
              follow: true,
              nosort: true,
            });
            expectNpmListCall(spawnExtStub, 0, 'dev');
            expectNpmListCall(spawnExtStub, 1, 'prod');
            expect(updatedParams.exclude).to.deep.equal([
              'user-defined-exclude-me',
              path.join('node_modules', 'module-1', '**'),
              path.join('node_modules', 'module-2', '**'),
            ]);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });

      it('should exclude dev dependencies in deeply nested services directories', async () => {
        const filePaths = [
          // root of the service
          'package.json',
          'node_modules',
          // nested-dir
          path.join('1st', 'package.json'),
          path.join('1st', 'node_modules'),
          // nested-dir which is nested
          path.join('1st', '2nd', 'package.json'),
          path.join('1st', '2nd', 'node_modules'),
        ];

        globSyncStub.returns(filePaths);
        resolveSpawnCall(spawnExtStub);
        const depPaths = [
          path.join(serviceDir, 'node_modules', 'module-1'),
          path.join(serviceDir, 'node_modules', 'module-2'),
          path.join(serviceDir, '1st', 'node_modules', 'module-1'),
          path.join(serviceDir, '1st', 'node_modules', 'module-2'),
          path.join(serviceDir, '1st', '2nd', 'node_modules', 'module-1'),
          path.join(serviceDir, '1st', '2nd', 'node_modules', 'module-2'),
        ].join(os.EOL);
        readFileAsyncStub.withArgs(sinon.match(/dev$/)).resolves(depPaths);
        readFileAsyncStub.withArgs(sinon.match(/prod$/)).resolves([]);
        readFileAsyncStub.onCall(2).resolves('{}');
        readFileAsyncStub.onCall(3).resolves('{}');
        readFileAsyncStub.onCall(4).resolves('{}');
        readFileAsyncStub.onCall(5).resolves('{}');
        readFileAsyncStub.onCall(6).resolves('{}');
        readFileAsyncStub.onCall(7).resolves('{}');

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.have.been.calledOnce;
            expect(spawnExtStub.callCount).to.equal(6);
            expect(readFileAsyncStub).to.have.callCount(8);
            expect(globSyncStub).to.have.been.calledWithExactly(['**/package.json'], {
              cwd: packagePlugin.serverless.serviceDir,
              dot: true,
              ignore: ['**/node_modules/**'],
              silent: true,
              follow: true,
              nosort: true,
            });
            ['dev', 'prod', 'dev', 'prod', 'dev', 'prod'].forEach((envName, index) => {
              expectNpmListCall(spawnExtStub, index, envName);
            });
            expect(updatedParams.exclude).to.deep.equal([
              'user-defined-exclude-me',
              path.join('node_modules', 'module-1', '**'),
              path.join('node_modules', 'module-2', '**'),
              path.join('1st', 'node_modules', 'module-1', '**'),
              path.join('1st', 'node_modules', 'module-2', '**'),
              path.join('1st', '2nd', 'node_modules', 'module-1', '**'),
              path.join('1st', '2nd', 'node_modules', 'module-2', '**'),
            ]);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });

      it('should not include packages if in both dependencies and devDependencies', async () => {
        const filePaths = ['package.json', 'node_modules'];

        globSyncStub.returns(filePaths);
        resolveSpawnCall(spawnExtStub);

        const devDepPaths = [
          path.join(serviceDir, 'node_modules', 'module-1'),
          path.join(serviceDir, 'node_modules', 'module-2'),
        ].join(os.EOL);
        readFileAsyncStub.withArgs(sinon.match(/dev$/)).resolves(devDepPaths);

        const prodDepPaths = [path.join(serviceDir, 'node_modules', 'module-2')];
        readFileAsyncStub.withArgs(sinon.match(/prod$/)).resolves(prodDepPaths);
        readFileAsyncStub.onCall(2).resolves('{}');

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.have.been.calledOnce;
            expect(spawnExtStub).to.have.been.calledTwice;
            expect(readFileAsyncStub).to.have.been.calledThrice;
            expect(readFileAsyncStub).to.have.been.calledWith(
              path.join(serviceDir, 'node_modules', 'module-1', 'package.json')
            );
            expect(globSyncStub).to.have.been.calledWithExactly(['**/package.json'], {
              cwd: packagePlugin.serverless.serviceDir,
              dot: true,
              ignore: ['**/node_modules/**'],
              silent: true,
              follow: true,
              nosort: true,
            });
            expectNpmListCall(spawnExtStub, 0, 'dev');
            expectNpmListCall(spawnExtStub, 1, 'prod');
            expect(updatedParams.exclude).to.deep.equal([
              'user-defined-exclude-me',
              path.join('node_modules', 'module-1', '**'),
            ]);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });

      it('should exclude dev dependency executables in node_modules/.bin', async () => {
        const devPaths = [
          'node_modules/bro-module',
          'node_modules/node-dude',
          'node_modules/lumo-clj',
          'node_modules/meowmix',
        ];

        const prodPaths = ['node_modules/node-dude'];

        const filePaths = ['node_modules/', 'package.json'].concat(devPaths).concat(prodPaths);

        globSyncStub.returns(filePaths);
        resolveSpawnCall(spawnExtStub);

        const mapper = (depPath) => path.join(`${serviceDir}`, depPath);

        const devDepPaths = devPaths.map(mapper).join(os.EOL);
        readFileAsyncStub.withArgs(sinon.match(/dev$/)).resolves(devDepPaths);

        const prodDepPaths = prodPaths.map(mapper).join(os.EOL);
        readFileAsyncStub.withArgs(sinon.match(/prod$/)).resolves(prodDepPaths);

        readFileAsyncStub.onCall(2).resolves('{"name": "bro-module", "bin": "main.js"}');
        readFileAsyncStub
          .onCall(3)
          .resolves('{"name": "lumo-clj", "bin": {"lumo": "./bin/lumo.js"}}');
        readFileAsyncStub
          .onCall(4)
          // need to handle possibility of multiple executables provided by the lib
          .resolves('{"name": "meowmix", "bin": {"meow": "./bin/meow.js", "mix": "./bin/mix.js"}}');

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.been.calledOnce;
            expect(spawnExtStub).to.have.been.calledTwice;

            expect(readFileAsyncStub).to.have.callCount(5);
            expect(readFileAsyncStub).to.have.been.calledWith(
              path.join(serviceDir, 'node_modules', 'bro-module', 'package.json')
            );
            expect(readFileAsyncStub).to.have.been.calledWith(
              path.join(serviceDir, 'node_modules', 'lumo-clj', 'package.json')
            );
            expect(readFileAsyncStub).to.have.been.calledWith(
              path.join(serviceDir, 'node_modules', 'meowmix', 'package.json')
            );

            expect(updatedParams.exclude).to.deep.equal([
              'user-defined-exclude-me',
              path.join('node_modules', 'bro-module', '**'),
              path.join('node_modules', '.bin', 'bro-module'),
              path.join('node_modules', 'lumo-clj', '**'),
              path.join('node_modules', '.bin', 'lumo'),
              path.join('node_modules', 'meowmix', '**'),
              path.join('node_modules', '.bin', 'meow'),
              path.join('node_modules', '.bin', 'mix'),
            ]);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });

      it('should exclude .bin executables in deeply nested folders', async () => {
        const filePaths = [
          'package.json',
          'node_modules',
          path.join('1st', 'package.json'),
          path.join('1st', 'node_modules'),
          path.join('1st', '2nd', 'package.json'),
          path.join('1st', '2nd', 'node_modules'),
        ];

        globSyncStub.returns(filePaths);
        resolveSpawnCall(spawnExtStub);
        const deps = [
          'node_modules/module-1',
          'node_modules/module-2',
          '1st/node_modules/module-1',
          '1st/node_modules/module-2',
          '1st/2nd/node_modules/module-1',
          '1st/2nd/node_modules/module-2',
        ];
        const depPaths = deps.map((depPath) => path.join(`${serviceDir}`, depPath));
        readFileAsyncStub.withArgs(sinon.match(/dev$/)).resolves(depPaths.join(os.EOL));
        readFileAsyncStub.withArgs(sinon.match(/prod$/)).resolves([]);

        const module1PackageJson = JSON.stringify({
          name: 'module-1',
          bin: {
            'cool-module': './index.js',
          },
        });
        const module2PackageJson = JSON.stringify({
          name: 'module-2',
          bin: './main.js',
        });

        readFileAsyncStub.onCall(2).resolves(module1PackageJson);
        readFileAsyncStub.onCall(3).resolves(module2PackageJson);
        readFileAsyncStub.onCall(4).resolves(module1PackageJson);
        readFileAsyncStub.onCall(5).resolves(module2PackageJson);
        readFileAsyncStub.onCall(6).resolves(module1PackageJson);
        readFileAsyncStub.onCall(7).resolves(module2PackageJson);

        return expect(packagePlugin.excludeDevDependencies(params)).to.be.fulfilled.then(
          (updatedParams) => {
            expect(globSyncStub).to.have.been.calledOnce;
            expect(spawnExtStub.callCount).to.equal(6);
            expect(readFileAsyncStub).to.have.callCount(8);
            for (const depPath of deps) {
              expect(readFileAsyncStub).to.have.been.calledWith(
                path.join(serviceDir, depPath, 'package.json')
              );
            }
            expect(globSyncStub).to.have.been.calledWithExactly(['**/package.json'], {
              cwd: packagePlugin.serverless.serviceDir,
              dot: true,
              ignore: ['**/node_modules/**'],
              silent: true,
              follow: true,
              nosort: true,
            });

            expect(updatedParams.exclude).to.deep.equal([
              'user-defined-exclude-me',
              path.join('node_modules', 'module-1', '**'),
              path.join('node_modules', '.bin', 'cool-module'),
              path.join('node_modules', 'module-2', '**'),
              path.join('node_modules', '.bin/module-2'),
              path.join('1st', 'node_modules', 'module-1', '**'),
              path.join('1st', 'node_modules', '.bin', 'cool-module'),
              path.join('1st', 'node_modules', 'module-2', '**'),
              path.join('1st', 'node_modules', '.bin', 'module-2'),
              path.join('1st', '2nd', 'node_modules', 'module-1', '**'),
              path.join('1st', '2nd', 'node_modules', '.bin', 'cool-module'),
              path.join('1st', '2nd', 'node_modules', 'module-2', '**'),
              path.join('1st', '2nd', 'node_modules', '.bin', 'module-2'),
            ]);
            expect(updatedParams.include).to.deep.equal(['user-defined-include-me']);
            expect(updatedParams.zipFileName).to.equal(params.zipFileName);
          }
        );
      });
    });
  });

  describe('#zip()', () => {
    let zip;

    const testDirectory = {
      // root
      '.': {
        'event.json': 'some content',
        'handler.js': 'some content',
        'file-1': 'some content',
        'file-2': 'some content',
      },
      // bin
      'bin': {
        'binary-777': {
          content: 'some content',
          permissions: 0o777,
        },
        'binary-444': {
          content: 'some content',
          permissions: 0o444,
        },
      },
      // lib
      'lib': {
        'file-1.js': 'some content',
      },
      'lib/directory-1': {
        'file-1.js': 'some content',
      },
      // node_modules
      'node_modules/directory-1': {
        'file-1': 'some content',
        'file-2': 'some content',
      },
      'node_modules/directory-2': {
        'file-1': 'some content',
        'file-2': 'some content',
      },
    };

    function getTestArtifactFileName(testName) {
      return `test-${testName}-${new Date().getTime().toString()}.zip`;
    }

    beforeEach(() => {
      zip = new JsZip();

      Object.keys(testDirectory).forEach((dirName) => {
        const dirPath = path.join(tmpDirPath, dirName);
        const files = testDirectory[dirName];

        Object.keys(files).forEach((fileName) => {
          const filePath = path.join(dirPath, fileName);
          const fileValue = files[fileName];
          const file = isObject(fileValue) ? fileValue : { content: fileValue };

          if (!file.content) {
            throw new Error('File content is required');
          }

          serverless.utils.writeFileSync(filePath, file.content);

          if (file.permissions) {
            fs.chmodSync(filePath, file.permissions);
          }
        });
      });
    });

    it('should zip a whole service (without include / exclude usage)', async () => {
      params.zipFileName = getTestArtifactFileName('whole-service');

      return expect(packagePlugin.zip(params))
        .to.eventually.be.equal(path.join(serverless.serviceDir, '.serverless', params.zipFileName))
        .then((artifact) => {
          const data = fs.readFileSync(artifact);
          return expect(zip.loadAsync(data)).to.be.fulfilled;
        })
        .then((unzippedData) => {
          const unzippedFileData = unzippedData.files;

          expect(
            Object.keys(unzippedFileData).filter((file) => !unzippedFileData[file].dir)
          ).to.be.lengthOf(12);

          // root directory
          expect(unzippedFileData['event.json'].name).to.equal('event.json');
          expect(unzippedFileData['handler.js'].name).to.equal('handler.js');
          expect(unzippedFileData['file-1'].name).to.equal('file-1');
          expect(unzippedFileData['file-2'].name).to.equal('file-2');

          // bin directory
          expect(unzippedFileData['bin/binary-777'].name).to.equal('bin/binary-777');
          expect(unzippedFileData['bin/binary-444'].name).to.equal('bin/binary-444');

          // lib directory
          expect(unzippedFileData['lib/file-1.js'].name).to.equal('lib/file-1.js');
          expect(unzippedFileData['lib/directory-1/file-1.js'].name).to.equal(
            'lib/directory-1/file-1.js'
          );

          // node_modules directory
          expect(unzippedFileData['node_modules/directory-1/file-1'].name).to.equal(
            'node_modules/directory-1/file-1'
          );
          expect(unzippedFileData['node_modules/directory-1/file-2'].name).to.equal(
            'node_modules/directory-1/file-2'
          );
          expect(unzippedFileData['node_modules/directory-2/file-1'].name).to.equal(
            'node_modules/directory-2/file-1'
          );
          expect(unzippedFileData['node_modules/directory-2/file-2'].name).to.equal(
            'node_modules/directory-2/file-2'
          );
        });
    });

    it('should keep file permissions', async () => {
      params.zipFileName = getTestArtifactFileName('file-permissions');

      return expect(packagePlugin.zip(params))
        .to.eventually.be.equal(path.join(serverless.serviceDir, '.serverless', params.zipFileName))
        .then((artifact) => {
          const data = fs.readFileSync(artifact);
          return expect(zip.loadAsync(data)).to.be.fulfilled;
        })
        .then((unzippedData) => {
          const unzippedFileData = unzippedData.files;

          if (os.platform() !== 'win32') {
            // chmod does not work right on windows
            // binary file is set with chmod of 777
            expect(unzippedFileData['bin/binary-777'].unixPermissions).to.equal(
              Math.pow(2, 15) + 0o755
            );

            // read only file is set with chmod of 444
            expect(unzippedFileData['bin/binary-444'].unixPermissions).to.equal(
              Math.pow(2, 15) + 0o644
            );

            expect(unzippedFileData['handler.js'].unixPermissions).to.equal(
              Math.pow(2, 15) + 0o644
            );
          }
        });
    });

    it('adds default files without reading all contents into memory', async () => {
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'large.bin'), Buffer.alloc(1024));
      const readFileStub = sinon
        .stub(fs.promises, 'readFile')
        .rejects(new Error('default packaging should not read full file contents'));

      try {
        await packagePlugin.zipFiles(['large.bin'], getTestArtifactFileName('lazy-default'));
        expect(readFileStub).to.not.have.been.called;
      } finally {
        readFileStub.restore();
      }
    });

    it('preserves getFileContent overrides', async () => {
      const getFileContentStub = sinon
        .stub(packagePlugin, 'getFileContent')
        .resolves(Buffer.from('transformed'));

      try {
        const artifact = await packagePlugin.zipFiles(
          ['handler.js'],
          getTestArtifactFileName('plugin-transform')
        );

        const unzippedData = await new JsZip().loadAsync(fs.readFileSync(artifact));
        const content = await unzippedData.files['handler.js'].async('string');

        expect(content).to.equal('transformed');
        expect(getFileContentStub).to.have.been.calledOnce;
      } finally {
        getFileContentStub.restore();
      }
    });

    it('treats pre-construction module-export getFileContent mutation as an override', async () => {
      const zipService = require('../../../../../../lib/plugins/package/lib/zip-service');
      const ActualPackage = require('../../../../../../lib/plugins/package/package');
      const originalGetFileContent = zipService.getFileContent;
      zipService.getFileContent = async () => Buffer.from('transformed');

      try {
        const mutatedPackagePlugin = new ActualPackage(serverless, {});
        const artifact = await mutatedPackagePlugin.zipFiles(
          ['handler.js'],
          getTestArtifactFileName('module-export-override')
        );

        const unzippedData = await new JsZip().loadAsync(fs.readFileSync(artifact));
        const content = await unzippedData.files['handler.js'].async('string');

        expect(content).to.equal('transformed');
      } finally {
        zipService.getFileContent = originalGetFileContent;
      }
    });

    it('wraps getFileContent override failures as CANNOT_READ_FILE', async () => {
      const getFileContentStub = sinon
        .stub(packagePlugin, 'getFileContent')
        .rejects(new Error('transform failed'));

      try {
        await expect(
          packagePlugin.zipFiles(['handler.js'], getTestArtifactFileName('plugin-error'))
        ).to.be.rejectedWith('Cannot read file handler.js due to: transform failed');
      } finally {
        getFileContentStub.restore();
      }
    });

    it('rejects unsupported getFileContent override return types', async () => {
      const getFileContentStub = sinon.stub(packagePlugin, 'getFileContent').resolves({});

      try {
        await expect(
          packagePlugin.zipFiles(['handler.js'], getTestArtifactFileName('plugin-invalid-type'))
        ).to.be.rejectedWith('Invalid getFileContent() result for "handler.js"');
      } finally {
        getFileContentStub.restore();
      }
    });

    it('supports getFileContent override Buffer, string, Uint8Array, and subarray results', async () => {
      const source = new Uint8Array([0, 1, 2, 3]);
      const cases = [
        { name: 'buffer', value: Buffer.from('buffer'), expected: Buffer.from('buffer') },
        { name: 'string', value: 'string', expected: Buffer.from('string') },
        { name: 'uint8array', value: new Uint8Array([4, 5]), expected: Buffer.from([4, 5]) },
        { name: 'subarray', value: source.subarray(1, 3), expected: Buffer.from([1, 2]) },
      ];

      for (const { name, value, expected } of cases) {
        const getFileContentStub = sinon.stub(packagePlugin, 'getFileContent').resolves(value);
        try {
          const artifact = await packagePlugin.zipFiles(
            ['handler.js'],
            getTestArtifactFileName(`plugin-${name}`)
          );
          const unzippedData = await new JsZip().loadAsync(fs.readFileSync(artifact));
          const content = await unzippedData.files['handler.js'].async('nodebuffer');

          expect(Buffer.from(content)).to.deep.equal(expected);
        } finally {
          getFileContentStub.restore();
        }
      }
    });

    it('wraps stat failures as CANNOT_READ_FILE', async () => {
      await expect(
        packagePlugin.zipFiles(['missing.js'], getTestArtifactFileName('missing-file'))
      ).to.be.rejectedWith('Cannot read file missing.js due to:');
    });

    it('rejects files that change between metadata collection and stream open', async () => {
      const originalOpen = fs.promises.open.bind(fs.promises);
      const openStub = sinon.stub(fs.promises, 'open').callsFake(async (...args) => {
        const fileHandle = await originalOpen(...args);
        const stat = await fileHandle.stat({ bigint: true });

        return {
          stat: sinon.stub().resolves({
            dev: stat.dev,
            ino: stat.ino,
            size: stat.size + 1n,
            mtimeNs: stat.mtimeNs,
          }),
          createReadStream: fileHandle.createReadStream.bind(fileHandle),
          close: fileHandle.close.bind(fileHandle),
        };
      });

      try {
        await expect(
          packagePlugin.zipFiles(['handler.js'], getTestArtifactFileName('changed-file'))
        ).to.be.rejectedWith('file changed between metadata collection and stream open');
      } finally {
        openStub.restore();
      }
    });

    it('packages files when only stat.dev differs (Windows path-stat vs handle-stat, #280)', async () => {
      const originalOpen = fs.promises.open.bind(fs.promises);
      const openStub = sinon.stub(fs.promises, 'open').callsFake(async (...args) => {
        const fileHandle = await originalOpen(...args);
        const stat = await fileHandle.stat({ bigint: true });

        return {
          stat: sinon.stub().resolves({
            dev: stat.dev === 0n ? 1n : 0n,
            ino: stat.ino,
            size: stat.size,
            mtimeNs: stat.mtimeNs,
          }),
          createReadStream: fileHandle.createReadStream.bind(fileHandle),
          close: fileHandle.close.bind(fileHandle),
        };
      });

      try {
        const artifact = await packagePlugin.zipFiles(
          ['handler.js'],
          getTestArtifactFileName('windows-dev-mismatch')
        );
        const unzipped = await new JsZip().loadAsync(fs.readFileSync(artifact));
        const content = await unzipped.files['handler.js'].async('nodebuffer');
        expect(content.toString()).to.equal('some content');
      } finally {
        openStub.restore();
      }
    });

    it('still rejects when the inode changes between metadata collection and stream open', async () => {
      const originalOpen = fs.promises.open.bind(fs.promises);
      const openStub = sinon.stub(fs.promises, 'open').callsFake(async (...args) => {
        const fileHandle = await originalOpen(...args);
        const stat = await fileHandle.stat({ bigint: true });

        return {
          stat: sinon.stub().resolves({
            dev: stat.dev,
            ino: stat.ino + 1n,
            size: stat.size,
            mtimeNs: stat.mtimeNs,
          }),
          createReadStream: fileHandle.createReadStream.bind(fileHandle),
          close: fileHandle.close.bind(fileHandle),
        };
      });

      try {
        await expect(
          packagePlugin.zipFiles(['handler.js'], getTestArtifactFileName('changed-inode'))
        ).to.be.rejectedWith('file changed between metadata collection and stream open');
      } finally {
        openStub.restore();
      }
    });

    it('removes partial artifacts after default streaming failure', async () => {
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'first.js'), 'first');
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'second.js'), 'second');
      const zipFileName = getTestArtifactFileName('stream-failure');
      const artifactFilePath = path.join(serverless.serviceDir, '.serverless', zipFileName);
      const originalOpen = fs.promises.open.bind(fs.promises);
      let openCallCount = 0;
      const openStub = sinon.stub(fs.promises, 'open').callsFake(async (...args) => {
        openCallCount += 1;
        const fileHandle = await originalOpen(...args);
        if (openCallCount !== 2) return fileHandle;

        return {
          stat: fileHandle.stat.bind(fileHandle),
          createReadStream: () => {
            const readStream = new PassThrough();
            readStream.once('error', () => fileHandle.close().catch(() => {}));
            process.nextTick(() => readStream.destroy(new Error('stream failed')));
            return readStream;
          },
          close: fileHandle.close.bind(fileHandle),
        };
      });

      try {
        await expect(
          packagePlugin.zipFiles(['first.js', 'second.js'], zipFileName)
        ).to.be.rejectedWith('Cannot read file second.js due to: stream failed');
        expect(fs.existsSync(artifactFilePath)).to.equal(false);
      } finally {
        openStub.restore();
      }
    });

    it('removes partial artifacts after plugin streaming failure', async () => {
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'first.js'), 'first');
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'second.js'), 'second');
      const zipFileName = getTestArtifactFileName('plugin-stream-failure');
      const artifactFilePath = path.join(serverless.serviceDir, '.serverless', zipFileName);
      const getFileContentStub = sinon
        .stub(packagePlugin, 'getFileContent')
        .onFirstCall()
        .resolves(Buffer.from('first'))
        .onSecondCall()
        .rejects(new Error('transform failed'));

      try {
        await expect(
          packagePlugin.zipFiles(['first.js', 'second.js'], zipFileName)
        ).to.be.rejectedWith('Cannot read file second.js due to: transform failed');
        expect(fs.existsSync(artifactFilePath)).to.equal(false);
      } finally {
        getFileContentStub.restore();
      }
    });

    it('should produce stable zip bytes for identical inputs', async () => {
      const filePaths = Object.entries(testDirectory).flatMap(([directoryName, files]) =>
        Object.keys(files).map((fileName) => {
          return directoryName === '.' ? fileName : path.join(directoryName, fileName);
        })
      );

      params.zipFileName = getTestArtifactFileName('stable-zip-1');
      const firstArtifact = await packagePlugin.zipFiles(filePaths, params.zipFileName);
      const firstBytes = fs.readFileSync(firstArtifact);

      params.zipFileName = getTestArtifactFileName('stable-zip-2');
      const secondArtifact = await packagePlugin.zipFiles(filePaths, params.zipFileName);
      const secondBytes = fs.readFileSync(secondArtifact);

      expect(Buffer.compare(firstBytes, secondBytes)).to.equal(0);
    });

    it('produces stable zip bytes regardless of input order', async () => {
      const localeSensitiveFile = 'umlaut-\u00e4.js';
      serverless.utils.writeFileSync(path.join(tmpDirPath, localeSensitiveFile), 'some content');
      const filePaths = Object.entries(testDirectory)
        .flatMap(([directoryName, files]) =>
          Object.keys(files).map((fileName) => {
            return directoryName === '.' ? fileName : path.join(directoryName, fileName);
          })
        )
        .concat(localeSensitiveFile);

      const firstArtifact = await packagePlugin.zipFiles(
        filePaths,
        getTestArtifactFileName('stable-order-1')
      );
      const secondArtifact = await packagePlugin.zipFiles(
        [...filePaths].reverse(),
        getTestArtifactFileName('stable-order-2')
      );

      expect(
        Buffer.compare(fs.readFileSync(firstArtifact), fs.readFileSync(secondArtifact))
      ).to.equal(0);
    });

    it('strips layer root prefix from archive names', async () => {
      const layerRoot = path.join(tmpDirPath, 'layer-root');
      const moduleFile = path.join(layerRoot, 'nodejs', 'node_modules', 'dep', 'index.js');

      serverless.utils.writeFileSync(moduleFile, 'module.exports = 1;');

      const artifact = await packagePlugin.zipFiles(
        [moduleFile],
        getTestArtifactFileName('layer-prefix'),
        layerRoot
      );
      const unzippedData = await new JsZip().loadAsync(fs.readFileSync(artifact));

      expect(unzippedData.files).to.have.property('nodejs/node_modules/dep/index.js');
      expect(unzippedData.files).to.not.have.property(
        'layer-root/nodejs/node_modules/dep/index.js'
      );
    });

    it('should exclude with globs', async () => {
      params.zipFileName = getTestArtifactFileName('exclude-with-globs');
      params.exclude = ['event.json', 'lib/**', 'node_modules/directory-1/**'];

      return expect(packagePlugin.zip(params))
        .to.eventually.be.equal(path.join(serverless.serviceDir, '.serverless', params.zipFileName))
        .then((artifact) => {
          const data = fs.readFileSync(artifact);
          return expect(zip.loadAsync(data)).to.be.fulfilled;
        })
        .then((unzippedData) => {
          const unzippedFileData = unzippedData.files;

          expect(
            Object.keys(unzippedFileData).filter((file) => !unzippedFileData[file].dir)
          ).to.be.lengthOf(7);

          // root directory
          expect(unzippedFileData['handler.js'].name).to.equal('handler.js');
          expect(unzippedFileData['file-1'].name).to.equal('file-1');
          expect(unzippedFileData['file-2'].name).to.equal('file-2');

          // bin directory
          expect(unzippedFileData['bin/binary-777'].name).to.equal('bin/binary-777');
          expect(unzippedFileData['bin/binary-444'].name).to.equal('bin/binary-444');

          // node_modules directory
          expect(unzippedFileData['node_modules/directory-2/file-1'].name).to.equal(
            'node_modules/directory-2/file-1'
          );
          expect(unzippedFileData['node_modules/directory-2/file-2'].name).to.equal(
            'node_modules/directory-2/file-2'
          );
        });
    });

    it('should re-include files using ! glob pattern', async () => {
      params.zipFileName = getTestArtifactFileName('re-include-with-globs');
      params.exclude = [
        'event.json',
        'lib/**',
        'node_modules/directory-1/**',

        '!event.json', // re-include
        '!lib/**', // re-include
      ];

      return expect(packagePlugin.zip(params))
        .to.eventually.be.equal(path.join(serverless.serviceDir, '.serverless', params.zipFileName))
        .then((artifact) => {
          const data = fs.readFileSync(artifact);
          return expect(zip.loadAsync(data)).to.be.fulfilled;
        })
        .then((unzippedData) => {
          const unzippedFileData = unzippedData.files;

          expect(
            Object.keys(unzippedFileData).filter((file) => !unzippedFileData[file].dir)
          ).to.be.lengthOf(10);

          // root directory
          expect(unzippedFileData['event.json'].name).to.equal('event.json');
          expect(unzippedFileData['handler.js'].name).to.equal('handler.js');
          expect(unzippedFileData['file-1'].name).to.equal('file-1');
          expect(unzippedFileData['file-2'].name).to.equal('file-2');

          // bin directory
          expect(unzippedFileData['bin/binary-777'].name).to.equal('bin/binary-777');
          expect(unzippedFileData['bin/binary-444'].name).to.equal('bin/binary-444');

          // lib directory
          expect(unzippedFileData['lib/file-1.js'].name).to.equal('lib/file-1.js');
          expect(unzippedFileData['lib/directory-1/file-1.js'].name).to.equal(
            'lib/directory-1/file-1.js'
          );

          // node_modules directory
          expect(unzippedFileData['node_modules/directory-2/file-1'].name).to.equal(
            'node_modules/directory-2/file-1'
          );
          expect(unzippedFileData['node_modules/directory-2/file-2'].name).to.equal(
            'node_modules/directory-2/file-2'
          );
        });
    });

    it('should re-include files using include config', async () => {
      params.zipFileName = getTestArtifactFileName('re-include-with-include');
      params.exclude = ['event.json', 'lib/**', 'node_modules/directory-1/**'];
      params.include = ['event.json', 'lib/**'];

      return expect(packagePlugin.zip(params))
        .to.eventually.be.equal(path.join(serverless.serviceDir, '.serverless', params.zipFileName))
        .then((artifact) => {
          const data = fs.readFileSync(artifact);
          return expect(zip.loadAsync(data)).to.be.fulfilled;
        })
        .then((unzippedData) => {
          const unzippedFileData = unzippedData.files;

          expect(
            Object.keys(unzippedFileData).filter((file) => !unzippedFileData[file].dir)
          ).to.be.lengthOf(10);

          // root directory
          expect(unzippedFileData['event.json'].name).to.equal('event.json');
          expect(unzippedFileData['handler.js'].name).to.equal('handler.js');
          expect(unzippedFileData['file-1'].name).to.equal('file-1');
          expect(unzippedFileData['file-2'].name).to.equal('file-2');

          // bin directory
          expect(unzippedFileData['bin/binary-777'].name).to.equal('bin/binary-777');
          expect(unzippedFileData['bin/binary-444'].name).to.equal('bin/binary-444');

          // lib directory
          expect(unzippedFileData['lib/file-1.js'].name).to.equal('lib/file-1.js');
          expect(unzippedFileData['lib/directory-1/file-1.js'].name).to.equal(
            'lib/directory-1/file-1.js'
          );

          // node_modules directory
          expect(unzippedFileData['node_modules/directory-2/file-1'].name).to.equal(
            'node_modules/directory-2/file-1'
          );
          expect(unzippedFileData['node_modules/directory-2/file-2'].name).to.equal(
            'node_modules/directory-2/file-2'
          );
        });
    });

    it('should include files even if outside working dir', async () => {
      params.zipFileName = getTestArtifactFileName('include-outside-working-dir');
      serverless.serviceDir = path.join(serverless.serviceDir, 'lib');
      params.exclude = ['./**'];
      params.include = ['../bin/binary-**'];

      return expect(packagePlugin.zip(params))
        .to.eventually.be.equal(path.join(serverless.serviceDir, '.serverless', params.zipFileName))
        .then((artifact) => {
          const data = fs.readFileSync(artifact);
          return expect(zip.loadAsync(data)).to.be.fulfilled;
        })
        .then((unzippedData) => {
          const unzippedFileData = unzippedData.files;
          expect(Object.keys(unzippedFileData).sort()).to.deep.equal([
            'bin/binary-444',
            'bin/binary-777',
          ]);
        });
    });

    it('should include files only once', async () => {
      params.zipFileName = getTestArtifactFileName('include-outside-working-dir');
      serverless.serviceDir = path.join(serverless.serviceDir, 'lib');
      params.exclude = ['./**'];
      params.include = ['.././bin/**'];

      return expect(packagePlugin.zip(params))
        .to.eventually.be.equal(path.join(serverless.serviceDir, '.serverless', params.zipFileName))
        .then((artifact) => {
          const data = fs.readFileSync(artifact);
          return expect(zip.loadAsync(data)).to.be.fulfilled;
        })
        .then((unzippedData) => {
          const unzippedFileData = unzippedData.files;
          expect(Object.keys(unzippedFileData).sort()).to.deep.equal([
            'bin/binary-444',
            'bin/binary-777',
          ]);
        });
    });

    it('should throw an error if no files are matched', () => {
      params.exclude = ['**/**'];
      params.include = [];
      params.zipFileName = getTestArtifactFileName('empty');

      return expect(packagePlugin.zip(params)).to.be.rejectedWith(
        Error,
        'file matches include / exclude'
      );
    });

    describeLargeZipSmoke('large zip memory smoke', function () {
      this.timeout(120000);

      it('packages a large sparse file without materializing it in memory', async () => {
        const largeFilePath = path.join(tmpDirPath, 'large.bin');

        serverless.utils.writeFileDir(largeFilePath);
        await fs.promises.writeFile(largeFilePath, '');
        await fs.promises.truncate(largeFilePath, 512 * 1024 * 1024);

        await packagePlugin.zipFiles(['event.json'], getTestArtifactFileName('warmup'));
        forceGc();

        const before = process.memoryUsage();
        let peakArrayBuffers = before.arrayBuffers;

        const sampler = setInterval(() => {
          peakArrayBuffers = Math.max(peakArrayBuffers, process.memoryUsage().arrayBuffers);
        }, 10);

        try {
          await packagePlugin.zipFiles(['large.bin'], getTestArtifactFileName('large-smoke'));
        } finally {
          clearInterval(sampler);
        }

        // The sampled peak includes dead stream chunks that V8 has not collected yet,
        // and that GC lag alone can exceed 64 MiB. The cap only needs to stay far
        // below the 512 MiB file size to prove the file was streamed, not materialized.
        expect(peakArrayBuffers - before.arrayBuffers).to.be.lessThan(128 * 1024 * 1024);

        forceGc();
        expect(process.memoryUsage().arrayBuffers - before.arrayBuffers).to.be.lessThan(
          16 * 1024 * 1024
        );
      });
    });
  });

  describe('#zipFiles()', () => {
    it('should throw an error if no files are provided', () =>
      expect(packagePlugin.zipFiles([], path.resolve(__dirname, 'tmp.zip'))).to.be.rejectedWith(
        Error,
        'No files to package'
      ));

    it('configures metadata stat concurrency with ext/promise/limit', () => {
      let configuredLimit;
      const fakeLimit = function (limitValue, callback) {
        configuredLimit = limitValue;
        return (...args) => callback(...args);
      };

      proxyquire('../../../../../../lib/plugins/package/lib/zip-service', {
        'ext/promise/limit': fakeLimit,
        '../../../utils/spawn': spawnExtStub,
      });

      expect(configuredLimit).to.equal(64);
    });

    it('uses the buffered fallback only for getFileContentAndStat overrides', async () => {
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'handler.js'), 'handler');
      const addReadStreamLazyStub = sinon.stub();
      const addBufferStub = sinon.stub();
      let fakeOutput;

      class FakeZipFile extends EventEmitter {
        constructor() {
          super();
          this.outputStream = {
            pipe: sinon.stub(),
            unpipe: sinon.stub(),
          };
        }

        addReadStreamLazy(...args) {
          addReadStreamLazyStub(...args);
        }

        addBuffer(...args) {
          addBufferStub(...args);
        }

        end() {
          process.nextTick(() => fakeOutput.emit('close'));
        }
      }

      const fakeFs = Object.create(fs);
      Object.defineProperty(fakeFs, 'promises', { value: fs.promises });
      fakeFs.createWriteStream = sinon.stub().callsFake(() => {
        fakeOutput = new EventEmitter();
        fakeOutput.closed = false;
        fakeOutput.destroy = sinon.stub(() => {
          fakeOutput.closed = true;
          process.nextTick(() => fakeOutput.emit('close'));
        });
        process.nextTick(() => fakeOutput.emit('open'));
        return fakeOutput;
      });

      const zipService = proxyquire('../../../../../../lib/plugins/package/lib/zip-service', {
        'yazl': { ZipFile: FakeZipFile },
        'fs': fakeFs,
        '../../../utils/spawn': spawnExtStub,
      });
      const TestPackage = proxyquire('../../../../../../lib/plugins/package/package', {
        './lib/zip-service': zipService,
      });
      const defaultPackagePlugin = new TestPackage(serverless, {});

      await defaultPackagePlugin.zipFiles(['handler.js'], 'default.zip');
      expect(addReadStreamLazyStub).to.have.been.calledOnce;
      expect(addBufferStub).to.not.have.been.called;

      addReadStreamLazyStub.resetHistory();
      addBufferStub.resetHistory();

      const getFileContentStub = sinon
        .stub(defaultPackagePlugin, 'getFileContent')
        .resolves(Buffer.from('transformed'));
      await defaultPackagePlugin.zipFiles(['handler.js'], 'content-override.zip');
      expect(addReadStreamLazyStub).to.have.been.calledOnce;
      expect(addBufferStub).to.not.have.been.called;
      getFileContentStub.restore();

      addReadStreamLazyStub.resetHistory();
      addBufferStub.resetHistory();

      const getFileContentAndStatStub = sinon
        .stub(defaultPackagePlugin, 'getFileContentAndStat')
        .resolves({
          data: Buffer.from('legacy'),
          stat: { mode: 0o100644 },
          filePath: 'handler.js',
        });
      await defaultPackagePlugin.zipFiles(['handler.js'], 'stat-override.zip');
      expect(addReadStreamLazyStub).to.not.have.been.called;
      expect(addBufferStub).to.have.been.calledOnce;
      getFileContentAndStatStub.restore();
    });
  });
});
