'use strict';

/**
 * Test: YamlParser Function Class
 */

const http = require('http');
const yaml = require('js-yaml');
const path = require('path');
const { pathToFileURL } = require('url');
const Utils = require('../../../../lib/classes/utils');
const YamlParser = require('../../../../lib/classes/yaml-parser');
const { getTmpFilePath, getTmpDirPath } = require('../../../utils/fs');

// Configure chai
const expect = require('chai').expect;

const createHarness = () => {
  const serverlessLike = {};
  serverlessLike.utils = new Utils(serverlessLike);
  serverlessLike.yamlParser = new YamlParser(serverlessLike);
  return serverlessLike;
};

const serverless = createHarness();

describe('YamlParser', () => {
  describe('#parse()', () => {
    it('should parse a simple .yaml file', () => {
      const tmpFilePath = getTmpFilePath('simple.yaml');

      serverless.utils.writeFileSync(tmpFilePath, yaml.dump({ foo: 'bar' }));

      return expect(serverless.yamlParser.parse(tmpFilePath))
        .to.eventually.have.property('foo')
        .to.equal('bar');
    });

    it('should parse a simple .yml file', () => {
      const tmpFilePath = getTmpFilePath('simple.yml');

      serverless.utils.writeFileSync(tmpFilePath, yaml.dump({ foo: 'bar' }));

      return expect(serverless.yamlParser.parse(tmpFilePath))
        .to.eventually.have.property('foo')
        .to.equal('bar');
    });

    it('should parse a .yml file with JSON-REF to YAML', () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'ref.yml'), { foo: 'bar' });

      const testYml = {
        main: {
          $ref: './ref.yml',
        },
      };

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), testYml);

      return expect(serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml')))
        .to.eventually.have.nested.property('main.foo')
        .to.equal('bar');
    });

    it('should parse a .yml file with JSON-REF to JSON', () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'ref.json'), { foo: 'bar' });

      const testYml = {
        main: {
          $ref: './ref.json',
        },
      };

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), testYml);

      return expect(serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml')))
        .to.eventually.have.nested.property('main.foo')
        .to.equal('bar');
    });

    it('should parse a .yml file with recursive JSON-REF', () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'three.yml'), { foo: 'bar' });

      const twoYml = {
        two: {
          $ref: './three.yml',
        },
      };

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'two.yml'), twoYml);

      const oneYml = {
        one: {
          $ref: './two.yml',
        },
      };

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'one.yml'), oneYml);

      return expect(serverless.yamlParser.parse(path.join(tmpDirPath, 'one.yml')))
        .to.eventually.have.nested.property('one.two.foo')
        .to.equal('bar');
    });

    it('should parse date-shaped values and shorthand tags in referenced files', () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(
        path.join(tmpDirPath, 'ref.yml'),
        'date: 2012-10-17\nref: !Ref Topic\n'
      );

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        main: { $ref: './ref.yml' },
      });

      return expect(serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml')))
        .to.eventually.have.property('main')
        .to.deep.equal({ date: '2012-10-17', ref: { Ref: 'Topic' } });
    });

    it('should leave same-document refs in the root file untouched', async () => {
      const tmpFilePath = getTmpFilePath('same-document.yml');

      serverless.utils.writeFileSync(tmpFilePath, {
        target: { foo: 'bar' },
        main: {
          $ref: '#/target',
        },
      });

      return expect(serverless.yamlParser.parse(tmpFilePath)).to.eventually.deep.equal({
        target: { foo: 'bar' },
        main: {
          $ref: '#/target',
        },
      });
    });

    it('should resolve same-document refs in externally referenced files', async () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'ref.yml'), {
        definitions: {
          value: { foo: 'bar' },
        },
        outer: {
          child: {
            $ref: '#/definitions/value',
          },
        },
      });

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        main: {
          $ref: './ref.yml#/outer',
        },
      });

      return expect(serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml')))
        .to.eventually.have.nested.property('main.child.foo')
        .to.equal('bar');
    });

    it('should ignore sibling properties on resolved external refs', async () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'ref.yml'), { foo: 'bar' });
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        main: {
          $ref: './ref.yml',
          extra: 'ignored',
        },
      });

      return expect(
        serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml'))
      ).to.eventually.deep.equal({
        main: { foo: 'bar' },
      });
    });

    it('should preserve identity for repeated external refs to the same target', async () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'ref.yml'), { foo: 'bar' });
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        first: {
          $ref: './ref.yml',
        },
        second: {
          $ref: './ref.yml',
        },
      });

      return expect(
        serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml'))
      ).to.eventually.be.fulfilled.then((result) => {
        expect(result.first).to.equal(result.second);
      });
    });

    it('should leave missing external refs untouched', async () => {
      const tmpFilePath = getTmpFilePath('missing-external.yml');

      serverless.utils.writeFileSync(tmpFilePath, {
        main: {
          $ref: './missing.yml',
          extra: 'kept',
        },
      });

      return expect(serverless.yamlParser.parse(tmpFilePath)).to.eventually.deep.equal({
        main: {
          $ref: './missing.yml',
          extra: 'kept',
        },
      });
    });

    it('should leave missing external refs untouched when file roots are restricted', async () => {
      const tmpFilePath = getTmpFilePath('missing-external-restricted.yml');

      serverless.utils.writeFileSync(tmpFilePath, {
        main: {
          $ref: './missing.yml',
          extra: 'kept',
        },
      });

      return expect(
        serverless.yamlParser.parse(tmpFilePath, {
          externalRefs: { file: { allowedRoots: ['.'] } },
        })
      ).to.eventually.deep.equal({
        main: {
          $ref: './missing.yml',
          extra: 'kept',
        },
      });
    });

    it('should keep nested missing refs untouched while resolving the rest of an external file', async () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'ref.yml'), {
        ok: { foo: 'bar' },
        missing: {
          $ref: './missing.yml',
        },
      });

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        main: {
          $ref: './ref.yml',
        },
      });

      return expect(
        serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml'))
      ).to.eventually.deep.equal({
        main: {
          ok: { foo: 'bar' },
          missing: {
            $ref: './missing.yml',
          },
        },
      });
    });

    it('should leave direct external cycles as raw $refs instead of creating object cycles', async () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'a.yml'), {
        schema: {
          fromA: true,
          next: {
            $ref: './b.yml#/schema',
          },
        },
      });

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'b.yml'), {
        schema: {
          fromB: true,
          next: {
            $ref: './a.yml#/schema',
          },
        },
      });

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        main: {
          $ref: './a.yml#/schema',
        },
      });

      const result = await serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml'));

      expect(result.main).to.deep.equal({
        fromA: true,
        next: {
          fromB: true,
          next: {
            $ref: './a.yml#/schema',
          },
        },
      });
      expect(() => JSON.stringify(result)).to.not.throw();
    });

    it('should leave aliased external cycles as raw $refs', async () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'a.yml'), {
        definitions: {
          node: {
            fromA: true,
            next: {
              $ref: './b.yml#/schema',
            },
          },
        },
        schema: {
          $ref: '#/definitions/node',
        },
      });

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'b.yml'), {
        schema: {
          $ref: './a.yml#/schema',
        },
      });

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        main: {
          $ref: './a.yml#/schema',
        },
      });

      const result = await serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml'));

      expect(result.main).to.deep.equal({
        fromA: true,
        next: {
          $ref: './a.yml#/schema',
        },
      });
      expect(() => JSON.stringify(result)).to.not.throw();
    });

    it('should leave malformed external yaml refs untouched', async () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'bad.yml'), 'foo: [');
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        main: {
          $ref: './bad.yml',
        },
      });

      return expect(
        serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml'))
      ).to.eventually.deep.equal({
        main: {
          $ref: './bad.yml',
        },
      });
    });

    it('should leave invalid external pointers untouched', async () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'ref.yml'), { foo: 'bar' });
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        main: {
          $ref: './ref.yml#/missing',
        },
      });

      return expect(
        serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml'))
      ).to.eventually.deep.equal({
        main: {
          $ref: './ref.yml#/missing',
        },
      });
    });

    it('should allow explicit file refs', async () => {
      const tmpDirPath = getTmpDirPath();
      const refPath = path.join(tmpDirPath, 'ref.yml');

      serverless.utils.writeFileSync(refPath, { foo: 'bar' });
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        main: {
          $ref: pathToFileURL(refPath).href,
        },
      });

      return expect(serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml')))
        .to.eventually.have.nested.property('main.foo')
        .to.equal('bar');
    });

    it('should allow remote HTTP refs when unsafe URLs are explicitly allowed', async () => {
      const tmpFilePath = getTmpFilePath('remote-ref.yml');
      const server = http.createServer((req, res) => {
        if (req.url === '/ref.yml') {
          res.writeHead(200, { 'Content-Type': 'application/yaml' });
          res.end('foo: bar\n');
          return;
        }

        res.writeHead(404);
        res.end('not found');
      });

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();

      serverless.utils.writeFileSync(tmpFilePath, {
        main: {
          $ref: `http://127.0.0.1:${port}/ref.yml`,
        },
      });

      try {
        const result = await serverless.yamlParser.parse(tmpFilePath, {
          externalRefs: { http: { allowUnsafeUrls: true } },
        });

        expect(result).to.have.nested.property('main.foo').to.equal('bar');
      } finally {
        await new Promise((resolve, reject) =>
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          })
        );
      }
    });
  });

  describe('#parse() - external ref policy', () => {
    const expectAccessDenied = (promise, messageIncludes = []) =>
      expect(promise).to.be.rejected.then((err) => {
        expect(err.code).to.equal('YAML_REF_ACCESS_DENIED');

        for (const text of messageIncludes) {
          expect(err.message).to.include(text);
        }
      });

    const listen = (server, host = '127.0.0.1') =>
      new Promise((resolve) => server.listen(0, host, resolve));

    const close = (server) =>
      new Promise((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        })
      );

    it('blocks unsafe HTTP refs by default', async () => {
      const tmpFilePath = getTmpFilePath('blocked-local-http-ref.yml');
      let wasRequested = false;
      const server = http.createServer((req, res) => {
        wasRequested = true;
        res.writeHead(200, { 'Content-Type': 'application/yaml' });
        res.end('foo: bar\n');
      });

      await listen(server);
      const { port } = server.address();

      serverless.utils.writeFileSync(tmpFilePath, {
        main: { $ref: `http://127.0.0.1:${port}/ref.yml` },
      });

      try {
        await expectAccessDenied(serverless.yamlParser.parse(tmpFilePath), [
          'yamlParser.parse',
          'externalRefs.http.allowedUnsafeHosts',
        ]);
        expect(wasRequested).to.equal(false);
      } finally {
        await close(server);
      }
    });

    it('passes file allow-list options to external ref loading', async () => {
      const tmpDirPath = getTmpDirPath();
      const refPath = path.join(tmpDirPath, 'ref.yml');
      const testPath = path.join(tmpDirPath, 'test.yml');

      serverless.utils.writeFileSync(refPath, { foo: 'bar' });
      serverless.utils.writeFileSync(testPath, { main: { $ref: './ref.yml' } });

      const result = await serverless.yamlParser.parse(testPath, {
        externalRefs: { file: { allowedRoots: ['.'] } },
      });

      expect(result).to.have.nested.property('main.foo').to.equal('bar');
    });

    it('blocks file refs outside the root document directory by default', async () => {
      const tmpDirPath = getTmpDirPath();
      const serviceDirPath = path.join(tmpDirPath, 'service');
      const outsidePath = path.join(tmpDirPath, 'outside.yml');
      const testPath = path.join(serviceDirPath, 'test.yml');

      serverless.utils.writeFileSync(outsidePath, { foo: 'bar' });
      serverless.utils.writeFileSync(testPath, { main: { $ref: '../outside.yml' } });

      await expectAccessDenied(serverless.yamlParser.parse(testPath), [
        'yamlParser.parse',
        'externalRefs.file.allowedRoots',
      ]);
    });

    it('allows file refs outside the root document directory when roots are explicitly unrestricted', async () => {
      const tmpDirPath = getTmpDirPath();
      const serviceDirPath = path.join(tmpDirPath, 'service');
      const outsidePath = path.join(tmpDirPath, 'outside.yml');
      const testPath = path.join(serviceDirPath, 'test.yml');

      serverless.utils.writeFileSync(outsidePath, { foo: 'bar' });
      serverless.utils.writeFileSync(testPath, { main: { $ref: '../outside.yml' } });

      const result = await serverless.yamlParser.parse(testPath, {
        externalRefs: { file: { allowedRoots: null } },
      });

      expect(result).to.have.nested.property('main.foo').to.equal('bar');
    });

    it('enforces file allow-list policy for nested external refs', async () => {
      const tmpDirPath = getTmpDirPath();
      const serviceDirPath = path.join(tmpDirPath, 'service');
      const outsidePath = path.join(tmpDirPath, 'outside.yml');
      const refPath = path.join(serviceDirPath, 'ref.yml');
      const testPath = path.join(serviceDirPath, 'test.yml');

      serverless.utils.writeFileSync(outsidePath, { foo: 'bar' });
      serverless.utils.writeFileSync(refPath, { nested: { $ref: '../outside.yml' } });
      serverless.utils.writeFileSync(testPath, { main: { $ref: './ref.yml' } });

      await expectAccessDenied(
        serverless.yamlParser.parse(testPath, {
          externalRefs: { file: { allowedRoots: ['.'] } },
        })
      );
    });

    it('enforces HTTP policy for nested absolute unsafe refs', async () => {
      const tmpFilePath = getTmpFilePath('nested-unsafe-http-ref.yml');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/yaml' });
        res.end('nested:\n  $ref: http://169.254.169.254/latest/meta-data/\n');
      });

      await listen(server);
      const { port } = server.address();

      serverless.utils.writeFileSync(tmpFilePath, {
        main: { $ref: `http://127.0.0.1:${port}/ref.yml` },
      });

      try {
        await expectAccessDenied(
          serverless.yamlParser.parse(tmpFilePath, {
            externalRefs: {
              http: {
                allowUnsafeUrls: false,
                allowedUnsafeHosts: [`127.0.0.1:${port}`],
              },
            },
          })
        );
      } finally {
        await close(server);
      }
    });

    it('enforces HTTP policy for nested scheme-relative unsafe refs', async () => {
      const tmpFilePath = getTmpFilePath('nested-scheme-relative-http-ref.yml');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/yaml' });
        res.end('nested:\n  $ref: //169.254.169.254/latest/meta-data/\n');
      });

      await listen(server);
      const { port } = server.address();

      serverless.utils.writeFileSync(tmpFilePath, {
        main: { $ref: `http://127.0.0.1:${port}/ref.yml` },
      });

      try {
        await expectAccessDenied(
          serverless.yamlParser.parse(tmpFilePath, {
            externalRefs: {
              http: {
                allowUnsafeUrls: false,
                allowedUnsafeHosts: [`127.0.0.1:${port}`],
              },
            },
          })
        );
      } finally {
        await close(server);
      }
    });

    it('resolves nested same-host HTTP refs through the allow-list', async () => {
      const tmpFilePath = getTmpFilePath('nested-same-host-http-ref.yml');
      const server = http.createServer((req, res) => {
        if (req.url === '/other.yml') {
          res.writeHead(200, { 'Content-Type': 'application/yaml' });
          res.end('foo: bar\n');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/yaml' });
        res.end('nested:\n  $ref: ./other.yml\n');
      });

      await listen(server);
      const { port } = server.address();

      serverless.utils.writeFileSync(tmpFilePath, {
        main: { $ref: `http://127.0.0.1:${port}/ref.yml` },
      });

      try {
        const result = await serverless.yamlParser.parse(tmpFilePath, {
          externalRefs: {
            http: {
              allowUnsafeUrls: false,
              allowedUnsafeHosts: [`127.0.0.1:${port}`],
            },
          },
        });

        expect(result).to.have.nested.property('main.nested.foo').to.equal('bar');
      } finally {
        await close(server);
      }
    });

    it('enforces file allow-list policy for refs nested in HTTP documents', async () => {
      const tmpDirPath = getTmpDirPath();
      const serviceDirPath = path.join(tmpDirPath, 'service');
      const outsidePath = path.join(tmpDirPath, 'outside.yml');
      const testPath = path.join(serviceDirPath, 'test.yml');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/yaml' });
        res.end(`nested:\n  $ref: ${pathToFileURL(outsidePath).href}\n`);
      });

      serverless.utils.writeFileSync(outsidePath, { foo: 'bar' });

      await listen(server);
      const { port } = server.address();

      serverless.utils.writeFileSync(testPath, {
        main: { $ref: `http://127.0.0.1:${port}/ref.yml` },
      });

      try {
        await expectAccessDenied(
          serverless.yamlParser.parse(testPath, {
            externalRefs: {
              file: { allowedRoots: ['.'] },
              http: {
                allowUnsafeUrls: false,
                allowedUnsafeHosts: [`127.0.0.1:${port}`],
              },
            },
          })
        );
      } finally {
        await close(server);
      }
    });

    it('enforces default file policy for refs nested in HTTP documents', async () => {
      const tmpDirPath = getTmpDirPath();
      const serviceDirPath = path.join(tmpDirPath, 'service');
      const outsidePath = path.join(tmpDirPath, 'outside.yml');
      const testPath = path.join(serviceDirPath, 'test.yml');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/yaml' });
        res.end(`nested:\n  $ref: ${pathToFileURL(outsidePath).href}\n`);
      });

      serverless.utils.writeFileSync(outsidePath, { foo: 'bar' });

      await listen(server);
      const { port } = server.address();

      serverless.utils.writeFileSync(testPath, {
        main: { $ref: `http://127.0.0.1:${port}/ref.yml` },
      });

      try {
        await expectAccessDenied(
          serverless.yamlParser.parse(testPath, {
            externalRefs: {
              http: {
                allowedUnsafeHosts: [`127.0.0.1:${port}`],
              },
            },
          }),
          ['yamlParser.parse', 'externalRefs.file.allowedRoots']
        );
      } finally {
        await close(server);
      }
    });
  });

  describe('#parse() - security hardening', () => {
    afterEach(() => {
      delete Object.prototype.polluted;
    });

    it('preserves __proto__ in parsed root YAML as an own property without polluting prototype', async () => {
      const tmpFilePath = getTmpFilePath('proto-root.yml');

      serverless.utils.writeFileSync(tmpFilePath, '__proto__:\n  polluted: yes\nfoo: bar\n');

      const result = await serverless.yamlParser.parse(tmpFilePath);

      expect(Object.hasOwn(result, '__proto__')).to.equal(true);
      expect(result.foo).to.equal('bar');
      expect(Object.getPrototypeOf(result)).to.equal(Object.prototype);
      expect(result.polluted).to.equal(undefined);
      expect({}.polluted).to.equal(undefined);
    });

    it('preserves __proto__ in YAML resolved via external $ref', async () => {
      const tmpDirPath = getTmpDirPath();
      const refPath = path.join(tmpDirPath, 'ref.yml');
      const testPath = path.join(tmpDirPath, 'test.yml');

      serverless.utils.writeFileSync(refPath, '__proto__:\n  polluted: yes\nfoo: bar\n');
      serverless.utils.writeFileSync(testPath, { main: { $ref: './ref.yml' } });

      const result = await serverless.yamlParser.parse(testPath);

      expect(Object.hasOwn(result.main, '__proto__')).to.equal(true);
      expect(result.main.foo).to.equal('bar');
      expect(Object.getPrototypeOf(result.main)).to.equal(Object.prototype);
      expect(result.main.polluted).to.equal(undefined);
      expect({}.polluted).to.equal(undefined);
    });

    it('materializes __proto__ with pollution-robust property descriptors', async () => {
      const copyDescriptor = (descriptor) =>
        descriptor && Object.assign(Object.create(null), descriptor);
      const defineDataProperty = (object, key, value) => {
        Object.defineProperty(
          object,
          key,
          Object.assign(Object.create(null), {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          })
        );
      };
      const definePollutingAccessor = (key) => {
        Object.defineProperty(
          Object.prototype,
          key,
          Object.assign(Object.create(null), {
            get() {
              throw new Error(`inherited descriptor ${key} was read`);
            },
            configurable: true,
          })
        );
      };
      const source = { foo: 'bar' };
      const parser = new serverless.yamlParser.constructor({
        utils: { readFileSync: () => source },
      });
      const originalGetDescriptor = copyDescriptor(
        Object.getOwnPropertyDescriptor(Object.prototype, 'get')
      );
      const originalSetDescriptor = copyDescriptor(
        Object.getOwnPropertyDescriptor(Object.prototype, 'set')
      );

      defineDataProperty(source, '__proto__', { marker: 'value' });

      let result;
      try {
        definePollutingAccessor('get');
        definePollutingAccessor('set');

        result = await parser.parse(getTmpFilePath('descriptor-pollution.yml'));
      } finally {
        if (originalGetDescriptor) {
          Object.defineProperty(Object.prototype, 'get', originalGetDescriptor);
        } else {
          delete Object.prototype.get;
        }

        if (originalSetDescriptor) {
          Object.defineProperty(Object.prototype, 'set', originalSetDescriptor);
        } else {
          delete Object.prototype.set;
        }
      }

      expect(result.foo).to.equal('bar');
      expect(Object.getPrototypeOf(result)).to.equal(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(result, '__proto__')).to.deep.equal({
        value: { marker: 'value' },
        writable: true,
        enumerable: true,
        configurable: true,
      });
      expect(result.marker).to.equal(undefined);
      expect({}.marker).to.equal(undefined);
    });

    it('does not resolve JSON Pointers that target inherited prototype members (#/constructor)', async () => {
      const tmpDirPath = getTmpDirPath();
      const refPath = path.join(tmpDirPath, 'ref.yml');
      const testPath = path.join(tmpDirPath, 'test.yml');

      serverless.utils.writeFileSync(refPath, { safe: 'value' });
      serverless.utils.writeFileSync(testPath, {
        main: { $ref: './ref.yml#/constructor' },
      });

      const result = await serverless.yamlParser.parse(testPath);

      expect(result).to.deep.equal({
        main: { $ref: './ref.yml#/constructor' },
      });
    });

    it('does not resolve JSON Pointers that target inherited toString', async () => {
      const tmpDirPath = getTmpDirPath();
      const refPath = path.join(tmpDirPath, 'ref.yml');
      const testPath = path.join(tmpDirPath, 'test.yml');

      serverless.utils.writeFileSync(refPath, { safe: 'value' });
      serverless.utils.writeFileSync(testPath, { main: { $ref: './ref.yml#/toString' } });

      const result = await serverless.yamlParser.parse(testPath);

      expect(result).to.deep.equal({
        main: { $ref: './ref.yml#/toString' },
      });
    });

    it('resolves own YAML keys named toString when defined as data', async () => {
      const tmpDirPath = getTmpDirPath();
      const refPath = path.join(tmpDirPath, 'ref.yml');
      const testPath = path.join(tmpDirPath, 'test.yml');

      serverless.utils.writeFileSync(refPath, { toString: 'override' });
      serverless.utils.writeFileSync(testPath, { main: { $ref: './ref.yml#/toString' } });

      const result = await serverless.yamlParser.parse(testPath);

      expect(result.main).to.equal('override');
    });

    it('does not resolve #/__proto__ pointers when target is absent', async () => {
      const tmpDirPath = getTmpDirPath();
      const refPath = path.join(tmpDirPath, 'ref.yml');
      const testPath = path.join(tmpDirPath, 'test.yml');

      serverless.utils.writeFileSync(refPath, { safe: 'value' });
      serverless.utils.writeFileSync(testPath, { main: { $ref: './ref.yml#/__proto__' } });

      const result = await serverless.yamlParser.parse(testPath);

      expect(result).to.deep.equal({
        main: { $ref: './ref.yml#/__proto__' },
      });
      expect({}.polluted).to.equal(undefined);
    });

    it('resolves an own __proto__ JSON pointer segment when the ref document has one', async () => {
      const tmpDirPath = getTmpDirPath();
      const refPath = path.join(tmpDirPath, 'ref.yml');
      const testPath = path.join(tmpDirPath, 'test.yml');

      serverless.utils.writeFileSync(refPath, '__proto__:\n  marker: value\nfoo: bar\n');
      serverless.utils.writeFileSync(testPath, { main: { $ref: './ref.yml#/__proto__' } });

      const result = await serverless.yamlParser.parse(testPath);

      expect(result.main).to.deep.equal({ marker: 'value' });
      expect({}.polluted).to.equal(undefined);
    });

    it('rejects self-referential YAML anchor cycles with a clear error', async () => {
      const tmpFilePath = getTmpFilePath('self-cycle.yml');

      serverless.utils.writeFileSync(tmpFilePath, 'a: &x\n  self: *x\n');

      await expect(serverless.yamlParser.parse(tmpFilePath)).to.be.rejected.then((err) => {
        expect(err.message).to.match(/Circular YAML reference/);
        expect(err.code).to.equal('INVALID_YAML_CIRCULAR_REFERENCE');
      });
    });

    it('rejects list-of-self cyclic YAML anchors', async () => {
      const tmpFilePath = getTmpFilePath('list-cycle.yml');

      serverless.utils.writeFileSync(tmpFilePath, 'a: &x\n  - *x\n');

      await expect(serverless.yamlParser.parse(tmpFilePath)).to.be.rejected.then((err) => {
        expect(err.message).to.match(/Circular YAML reference/);
      });
    });

    it('rejects self-referential YAML anchor cycles in externally referenced files', async () => {
      const tmpDirPath = getTmpDirPath();
      const refPath = path.join(tmpDirPath, 'ref.yml');
      const testPath = path.join(tmpDirPath, 'test.yml');

      serverless.utils.writeFileSync(refPath, 'a: &x\n  self: *x\n');
      serverless.utils.writeFileSync(testPath, { main: { $ref: './ref.yml#/a' } });

      await expect(serverless.yamlParser.parse(testPath)).to.be.rejected.then((err) => {
        expect(err.message).to.match(/Circular YAML reference/);
        expect(err.code).to.equal('INVALID_YAML_CIRCULAR_REFERENCE');
      });
    });

    it('does not stack-overflow on repeated non-cyclic aliases', async () => {
      const tmpFilePath = getTmpFilePath('repeated-alias.yml');

      const content = `${[
        'defaults: &d',
        '  foo: bar',
        '  list:',
        '    - one',
        '    - two',
        'first: *d',
        'second: *d',
        'third: *d',
      ].join('\n')}\n`;

      serverless.utils.writeFileSync(tmpFilePath, content);

      const result = await serverless.yamlParser.parse(tmpFilePath);

      expect(result.first).to.deep.equal({ foo: 'bar', list: ['one', 'two'] });
      expect(result.second).to.deep.equal({ foo: 'bar', list: ['one', 'two'] });
      expect(result.third).to.deep.equal({ foo: 'bar', list: ['one', 'two'] });
      expect(result.first).to.equal(result.second);
      expect(result.second).to.equal(result.third);
      expect(() => JSON.stringify(result)).to.not.throw();
    });

    it('leaves direct external cycles as raw $refs (regression test)', async () => {
      const tmpDirPath = getTmpDirPath();

      serverless.utils.writeFileSync(path.join(tmpDirPath, 'a.yml'), {
        schema: { fromA: true, next: { $ref: './b.yml#/schema' } },
      });
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'b.yml'), {
        schema: { fromB: true, next: { $ref: './a.yml#/schema' } },
      });
      serverless.utils.writeFileSync(path.join(tmpDirPath, 'test.yml'), {
        main: { $ref: './a.yml#/schema' },
      });

      const result = await serverless.yamlParser.parse(path.join(tmpDirPath, 'test.yml'));

      expect(result.main).to.deep.equal({
        fromA: true,
        next: { fromB: true, next: { $ref: './a.yml#/schema' } },
      });
      expect(() => JSON.stringify(result)).to.not.throw();
    });
  });
});
