'use strict';

const dns = require('dns');
const http = require('http');
const { expect } = require('chai');
const { readHttpRef } = require('../../../../../lib/classes/yaml-parser/http-ref-reader');

describe('yaml-parser/http-ref-reader', () => {
  const HTTPResolver = {
    canRead: (fileInfo) => /^https?:\/\//.test(fileInfo.url),
    read: async (fileInfo) => Buffer.from(`legacy: ${fileInfo.url}\n`),
  };

  const getFileInfo = (url) => ({ url, extension: '.yml', hash: '' });
  const safeOptions = { allowUnsafeUrls: false, allowedUnsafeHosts: [] };

  const expectAccessDenied = (promise) =>
    expect(promise).to.be.rejected.then((err) => {
      expect(err.code).to.equal('YAML_REF_ACCESS_DENIED');
    });

  const listen = (server, host = '127.0.0.1') =>
    new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('error', onError);
        reject(error);
      };

      server.once('error', onError);
      server.listen(0, host, () => {
        server.off('error', onError);
        resolve();
      });
    });

  const close = (server) =>
    new Promise((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      })
    );

  it('delegates to the upstream resolver when unsafe URLs are allowed', async () => {
    const url = 'http://127.0.0.1/ref.yml';
    const fileInfo = getFileInfo(url);
    let readFileInfo;
    const resolver = {
      canRead: () => true,
      read: async (nextFileInfo) => {
        readFileInfo = nextFileInfo;
        return Buffer.from('foo: bar\n');
      },
    };

    const result = await readHttpRef(url, fileInfo, resolver, {
      allowUnsafeUrls: true,
      allowedUnsafeHosts: [],
    });

    expect(result.toString('utf8')).to.equal('foo: bar\n');
    expect(readFileInfo).to.equal(fileInfo);
  });

  it('blocks local HTTP refs before making a request', async () => {
    let wasRequested = false;
    const server = http.createServer((req, res) => {
      wasRequested = true;
      res.writeHead(200, { 'Content-Type': 'application/yaml' });
      res.end('foo: bar\n');
    });

    await listen(server);
    const url = `http://127.0.0.1:${server.address().port}/ref.yml`;

    try {
      await expectAccessDenied(readHttpRef(url, getFileInfo(url), HTTPResolver, safeOptions));
      expect(wasRequested).to.equal(false);
    } finally {
      await close(server);
    }
  });

  it('blocks IPv6 loopback refs before making a request', async () => {
    const url = 'http://[::1]:49152/ref.yml';

    await expectAccessDenied(readHttpRef(url, getFileInfo(url), HTTPResolver, safeOptions));
  });

  it('blocks IPv4-mapped IPv6 loopback refs before making a request', async () => {
    const url = 'http://[::ffff:127.0.0.1]:49152/ref.yml';

    await expectAccessDenied(readHttpRef(url, getFileInfo(url), HTTPResolver, safeOptions));
  });

  it('blocks well-known NAT64 addresses before making a request', async () => {
    const url = 'http://[64:ff9b::a9fe:a9fe]/latest/meta-data/';

    await expectAccessDenied(readHttpRef(url, getFileInfo(url), HTTPResolver, safeOptions));
  });

  it('blocks well-known cloud metadata endpoint addresses', async () => {
    for (const url of [
      'http://100.100.100.200/latest/meta-data/',
      'http://192.0.0.192/opc/v1/instance/',
      'http://2130706433/ref.yml',
      'http://0x7f.1/ref.yml',
    ]) {
      await expectAccessDenied(readHttpRef(url, getFileInfo(url), HTTPResolver, safeOptions));
    }
  });

  it('blocks unsafe pre-flight DNS results before fetching', async () => {
    const originalFetch = globalThis.fetch;
    const originalPromisesLookup = dns.promises.lookup;
    let fetchCount = 0;

    dns.promises.lookup = (hostname, options) => {
      if (hostname === 'private-resolution.test') {
        return Promise.resolve([{ address: '10.0.0.5', family: 4 }]);
      }
      if (hostname === 'mixed-resolution.test') {
        return Promise.resolve([
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]);
      }

      return originalPromisesLookup.call(dns.promises, hostname, options);
    };
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response('foo: bar\n', { status: 200 });
    };

    try {
      for (const url of [
        'http://private-resolution.test/ref.yml',
        'http://mixed-resolution.test/ref.yml',
      ]) {
        await expectAccessDenied(readHttpRef(url, getFileInfo(url), HTTPResolver, safeOptions));
      }
      expect(fetchCount).to.equal(0);
    } finally {
      globalThis.fetch = originalFetch;
      dns.promises.lookup = originalPromisesLookup;
    }
  });

  it('blocks internal hostname suffixes before DNS lookup', async () => {
    const originalPromisesLookup = dns.promises.lookup;
    let lookupCount = 0;

    dns.promises.lookup = (hostname, options) => {
      lookupCount += 1;
      return originalPromisesLookup.call(dns.promises, hostname, options);
    };

    try {
      await expectAccessDenied(
        readHttpRef(
          'http://metadata.internal/ref.yml',
          getFileInfo('http://metadata.internal/ref.yml'),
          HTTPResolver,
          safeOptions
        )
      );
      await expectAccessDenied(
        readHttpRef(
          'http://metadata.internal./ref.yml',
          getFileInfo('http://metadata.internal./ref.yml'),
          HTTPResolver,
          safeOptions
        )
      );
      expect(lookupCount).to.equal(0);
    } finally {
      dns.promises.lookup = originalPromisesLookup;
    }
  });

  it('blocks DNS rebinding at connection time', async () => {
    const originalLookup = dns.lookup;
    const originalPromisesLookup = dns.promises.lookup;
    const url = 'http://rebind.test:49152/ref.yml';
    let connectionLookupCount = 0;

    dns.promises.lookup = (hostname, options) => {
      if (hostname === 'rebind.test') {
        return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
      }

      return originalPromisesLookup.call(dns.promises, hostname, options);
    };
    dns.lookup = (hostname, options, callback) => {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }

      if (hostname === 'rebind.test') {
        connectionLookupCount += 1;
        callback(null, '127.0.0.1', 4);
        return;
      }

      originalLookup.call(dns, hostname, options, callback);
    };

    try {
      await expectAccessDenied(readHttpRef(url, getFileInfo(url), HTTPResolver, safeOptions));
      expect(connectionLookupCount).to.equal(1);
    } finally {
      dns.lookup = originalLookup;
      dns.promises.lookup = originalPromisesLookup;
    }
  });

  it('blocks DNS rebinding from array-shaped connection lookup results', async () => {
    const originalLookup = dns.lookup;
    const originalPromisesLookup = dns.promises.lookup;
    const url = 'http://array-rebind.test:49152/ref.yml';
    let connectionLookupCount = 0;

    dns.promises.lookup = (hostname, options) => {
      if (hostname === 'array-rebind.test') {
        return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
      }

      return originalPromisesLookup.call(dns.promises, hostname, options);
    };
    dns.lookup = (hostname, options, callback) => {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }

      if (hostname === 'array-rebind.test') {
        connectionLookupCount += 1;
        callback(null, [
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]);
        return;
      }

      originalLookup.call(dns, hostname, options, callback);
    };

    try {
      await expectAccessDenied(readHttpRef(url, getFileInfo(url), HTTPResolver, safeOptions));
      expect(connectionLookupCount).to.equal(1);
    } finally {
      dns.lookup = originalLookup;
      dns.promises.lookup = originalPromisesLookup;
    }
  });

  it('allows explicitly listed unsafe HTTP hosts', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/yaml' });
      res.end('foo: bar\n');
    });

    await listen(server);
    const url = `http://127.0.0.1:${server.address().port}/ref.yml`;

    try {
      const result = await readHttpRef(url, getFileInfo(url), HTTPResolver, {
        allowUnsafeUrls: false,
        allowedUnsafeHosts: [`127.0.0.1:${server.address().port}`],
      });

      expect(result.toString('utf8')).to.equal('foo: bar\n');
    } finally {
      await close(server);
    }
  });

  it('allows explicitly listed unsafe hostname suffixes', async () => {
    const originalFetch = globalThis.fetch;
    const url = 'http://metadata.internal/ref.yml';
    let fetchedUrl;

    globalThis.fetch = async (nextUrl) => {
      fetchedUrl = nextUrl;
      return new Response('foo: bar\n', { status: 200 });
    };

    try {
      const result = await readHttpRef(url, getFileInfo(url), HTTPResolver, {
        allowUnsafeUrls: false,
        allowedUnsafeHosts: ['metadata.internal'],
      });

      expect(fetchedUrl).to.equal(url);
      expect(result.toString('utf8')).to.equal('foo: bar\n');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('allows explicitly listed bracketed IPv6 unsafe HTTP hosts', async function () {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/yaml' });
      res.end('foo: bar\n');
    });

    try {
      await listen(server, '::1');
    } catch (error) {
      if (error.code === 'EADDRNOTAVAIL' || error.code === 'EINVAL') this.skip();
      throw error;
    }

    const url = `http://[::1]:${server.address().port}/ref.yml`;

    try {
      const result = await readHttpRef(url, getFileInfo(url), HTTPResolver, {
        allowUnsafeUrls: false,
        allowedUnsafeHosts: ['::1'],
      });

      expect(result.toString('utf8')).to.equal('foo: bar\n');
    } finally {
      await close(server);
    }
  });

  it('does not inherit upstream safe resolver port blocking', async () => {
    const originalFetch = globalThis.fetch;
    const originalPromisesLookup = dns.promises.lookup;
    const url = 'http://public-ref.test:8080/ref.yml';
    let fetchedUrl;

    dns.promises.lookup = (hostname, options) => {
      if (hostname === 'public-ref.test') {
        return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
      }

      return originalPromisesLookup.call(dns.promises, hostname, options);
    };
    globalThis.fetch = async (nextUrl) => {
      fetchedUrl = nextUrl;
      return new Response('foo: bar\n', { status: 200 });
    };

    try {
      const result = await readHttpRef(
        url,
        getFileInfo(url),
        { ...HTTPResolver, canRead: () => false },
        safeOptions
      );

      expect(fetchedUrl).to.equal(url);
      expect(result.toString('utf8')).to.equal('foo: bar\n');
    } finally {
      globalThis.fetch = originalFetch;
      dns.promises.lookup = originalPromisesLookup;
    }
  });

  it('blocks redirects to unsafe HTTP refs', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });

    await listen(server);
    const url = `http://127.0.0.1:${server.address().port}/ref.yml`;

    try {
      await expectAccessDenied(
        readHttpRef(url, getFileInfo(url), HTTPResolver, {
          allowUnsafeUrls: false,
          allowedUnsafeHosts: [`127.0.0.1:${server.address().port}`],
        })
      );
    } finally {
      await close(server);
    }
  });

  it('follows safe relative redirects', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/redirect.yml') {
        res.writeHead(302, { Location: '/other.yml' });
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/yaml' });
      res.end('foo: bar\n');
    });

    await listen(server);
    const url = `http://127.0.0.1:${server.address().port}/redirect.yml`;

    try {
      const result = await readHttpRef(url, getFileInfo(url), HTTPResolver, {
        allowUnsafeUrls: false,
        allowedUnsafeHosts: [`127.0.0.1:${server.address().port}`],
      });

      expect(result.toString('utf8')).to.equal('foo: bar\n');
    } finally {
      await close(server);
    }
  });

  it('rejects HTTP error responses in safe mode', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(404);
      res.end('not found');
    });

    await listen(server);
    const url = `http://127.0.0.1:${server.address().port}/missing.yml`;

    try {
      await expect(
        readHttpRef(url, getFileInfo(url), HTTPResolver, {
          allowUnsafeUrls: false,
          allowedUnsafeHosts: [`127.0.0.1:${server.address().port}`],
        })
      ).to.be.rejectedWith(/HTTP ERROR 404/);
    } finally {
      await close(server);
    }
  });

  it('blocks redirects to non-HTTP protocols', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(302, { Location: 'file:///etc/passwd' });
      res.end();
    });

    await listen(server);
    const url = `http://127.0.0.1:${server.address().port}/ref.yml`;

    try {
      await expectAccessDenied(
        readHttpRef(url, getFileInfo(url), HTTPResolver, {
          allowUnsafeUrls: false,
          allowedUnsafeHosts: [`127.0.0.1:${server.address().port}`],
        })
      );
    } finally {
      await close(server);
    }
  });

  it('enforces the safe-mode redirect limit', async () => {
    const server = http.createServer((req, res) => {
      const redirectCount = Number(req.url.slice(1) || 0);

      res.writeHead(302, { Location: `/${redirectCount + 1}` });
      res.end();
    });

    await listen(server);
    const url = `http://127.0.0.1:${server.address().port}/0`;

    try {
      await expect(
        readHttpRef(url, getFileInfo(url), HTTPResolver, {
          allowUnsafeUrls: false,
          allowedUnsafeHosts: [`127.0.0.1:${server.address().port}`],
        })
      ).to.be.rejectedWith(/Too many redirects/);
    } finally {
      await close(server);
    }
  });
});
