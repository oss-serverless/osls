'use strict';

const http = require('http');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fsp = require('fs').promises;
const AdmZip = require('adm-zip');
const { expect } = require('chai');

const download = require('../../../../../lib/utils/serverless-utils/download');
const { pathExists, remove } = require('../../../../utils/fs');

describe('serverless-utils/download', () => {
  let server;
  let baseUrl;
  let zipBuffer;
  let nestedZipBuffer;
  let traversalZipBuffer;
  let traversalFileName;
  let unsafeDispositionFileName;
  let tmpDir;

  before(async () => {
    const zip = new AdmZip();
    zip.addFile('file.txt', Buffer.from('fixture'));
    zipBuffer = zip.toBuffer();

    const nestedZip = new AdmZip();
    nestedZip.addFile('template-main/serverless.yml', Buffer.from('service: fixture\n'));
    nestedZipBuffer = nestedZip.toBuffer();

    traversalFileName = `serverless-download-${crypto.randomBytes(12).toString('hex')}-evil.txt`;
    unsafeDispositionFileName = `serverless-download-${crypto
      .randomBytes(12)
      .toString('hex')}-unsafe.txt`;
    const traversalZip = new AdmZip();
    traversalZip.addFile(`xx/${traversalFileName}`, Buffer.from('evil'));
    traversalZipBuffer = traversalZip.toBuffer();
    traversalZipBuffer = Buffer.from(
      traversalZipBuffer
        .toString('binary')
        .replaceAll(`xx/${traversalFileName}`, `../${traversalFileName}`),
      'binary'
    );

    server = http.createServer((req, res) => {
      if (req.url === '/layer-download?Signature=opaque') {
        res.statusCode = 200;
        res.end(zipBuffer);
        return;
      }

      if (req.url === '/content-disposition?Signature=opaque') {
        res.statusCode = 200;
        res.setHeader('Content-Disposition', 'attachment; filename="from-header.zip"');
        res.end(zipBuffer);
        return;
      }

      if (req.url === '/extended-content-disposition') {
        res.statusCode = 200;
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="fallback.zip"; filename*=UTF-8\'\'%E2%82%AC-rates.zip'
        );
        res.end(zipBuffer);
        return;
      }

      if (req.url === '/content-disposition-without-filename') {
        res.statusCode = 200;
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('Content-Type', 'text/csv');
        res.end(Buffer.from('a,b\n1,2\n'));
        return;
      }

      if (req.url === '/unsafe-content-disposition') {
        res.statusCode = 200;
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="../${unsafeDispositionFileName}"`
        );
        res.end(Buffer.from('unsafe payload'));
        return;
      }

      if (req.url === '/mime-fallback') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/csv');
        res.end(Buffer.from('a,b\n1,2\n'));
        return;
      }

      if (req.url === '/html-fallback') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(Buffer.from('<!doctype html>\n'));
        return;
      }

      if (req.url === '/binary-fallback') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(Buffer.from('binary payload'));
        return;
      }

      if (req.url === '/unknown-payload') {
        res.statusCode = 200;
        res.end(Buffer.from('plain text payload'));
        return;
      }

      if (req.url === '/nested-zip') {
        res.statusCode = 200;
        res.end(nestedZipBuffer);
        return;
      }

      if (req.url === '/traversal-zip') {
        res.statusCode = 200;
        res.end(traversalZipBuffer);
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'serverless-download-'));
  });

  afterEach(async () => {
    await remove(tmpDir);
  });

  it('infers a filename from the downloaded file type when the URL has no extension', async () => {
    await download(`${baseUrl}/layer-download?Signature=opaque`, tmpDir);

    const stats = await fsp.lstat(path.join(tmpDir, 'layer-download.zip'));

    expect(stats.isFile()).to.equal(true);
  });

  it('prefers content-disposition over URL and content sniffing for saved filenames', async () => {
    await download(`${baseUrl}/content-disposition?Signature=opaque`, tmpDir);

    const stats = await fsp.lstat(path.join(tmpDir, 'from-header.zip'));

    expect(stats.isFile()).to.equal(true);
    expect(await pathExists(path.join(tmpDir, 'content-disposition.zip'))).to.equal(false);
  });

  it('prefers extended content-disposition filenames over fallback filenames', async () => {
    await download(`${baseUrl}/extended-content-disposition`, tmpDir);

    const stats = await fsp.lstat(path.join(tmpDir, '\u20ac-rates.zip'));

    expect(stats.isFile()).to.equal(true);
    expect(await pathExists(path.join(tmpDir, 'fallback.zip'))).to.equal(false);
  });

  it('falls back to inferred filenames when content-disposition has no filename', async () => {
    await download(`${baseUrl}/content-disposition-without-filename`, tmpDir);

    expect(
      await fsp.readFile(path.join(tmpDir, 'content-disposition-without-filename.csv'), 'utf8')
    ).to.equal('a,b\n1,2\n');
  });

  it('falls back to content-type when file-type cannot infer an extension', async () => {
    await download(`${baseUrl}/mime-fallback`, tmpDir);

    const filePath = path.join(tmpDir, 'mime-fallback.csv');

    expect(await fsp.readFile(filePath, 'utf8')).to.equal('a,b\n1,2\n');
  });

  it('uses a broad MIME lookup for content-type extension fallback', async () => {
    await download(`${baseUrl}/html-fallback`, tmpDir);

    expect(await fsp.readFile(path.join(tmpDir, 'html-fallback.html'), 'utf8')).to.equal(
      '<!doctype html>\n'
    );
  });

  it('preserves the bare basename for generic binary content types', async () => {
    await download(`${baseUrl}/binary-fallback`, tmpDir);

    expect(await fsp.readFile(path.join(tmpDir, 'binary-fallback'), 'utf8')).to.equal(
      'binary payload'
    );
    expect(await pathExists(path.join(tmpDir, 'binary-fallback.bin'))).to.equal(false);
  });

  it('preserves the bare basename when no extension can be inferred', async () => {
    await download(`${baseUrl}/unknown-payload`, tmpDir);

    const filePath = path.join(tmpDir, 'unknown-payload');

    expect(await fsp.readFile(filePath, 'utf8')).to.equal('plain text payload');
    expect(await pathExists(path.join(tmpDir, 'unknown-payload.txt'))).to.equal(false);
  });

  it('sanitizes content-disposition filenames before saving downloads', async () => {
    await download(`${baseUrl}/unsafe-content-disposition`, tmpDir);

    expect(await pathExists(path.join(path.dirname(tmpDir), unsafeDispositionFileName))).to.equal(
      false
    );

    const entries = await fsp.readdir(tmpDir, { withFileTypes: true });
    expect(entries).to.have.lengthOf(1);
    expect(entries[0].isFile()).to.equal(true);
    expect(await fsp.readFile(path.join(tmpDir, entries[0].name), 'utf8')).to.equal(
      'unsafe payload'
    );
  });

  it('sanitizes explicit filenames before saving downloads', async () => {
    await download(`${baseUrl}/unknown-payload`, tmpDir, {
      filename: '<foo/bar>.txt',
    });

    const entries = await fsp.readdir(tmpDir, { withFileTypes: true });
    expect(entries).to.have.lengthOf(1);
    expect(entries[0].isFile()).to.equal(true);
    expect(await fsp.readFile(path.join(tmpDir, entries[0].name), 'utf8')).to.equal(
      'plain text payload'
    );
  });

  it('extracts an opaque archive URL when extract is enabled', async () => {
    await download(`${baseUrl}/layer-download?Signature=opaque`, tmpDir, { extract: true });

    expect(await fsp.readFile(path.join(tmpDir, 'file.txt'), 'utf8')).to.equal('fixture');
  });

  it('rejects non-ZIP payloads when extract is enabled', async () => {
    await expect(download(`${baseUrl}/unknown-payload`, tmpDir, { extract: true })).to.be.rejected;

    expect(await pathExists(path.join(tmpDir, 'unknown-payload'))).to.equal(false);
  });

  it('extracts a zip archive with the requested strip depth', async () => {
    await download(`${baseUrl}/nested-zip`, tmpDir, { extract: true, strip: 1 });

    expect(await fsp.readFile(path.join(tmpDir, 'serverless.yml'), 'utf8')).to.equal(
      'service: fixture\n'
    );
    expect(await pathExists(path.join(tmpDir, 'template-main'))).to.equal(false);
  });

  it('does not write zip entries outside the destination', async () => {
    await expect(download(`${baseUrl}/traversal-zip`, tmpDir, { extract: true })).to.be.rejected;

    expect(await pathExists(path.join(tmpDir, 'xx', traversalFileName))).to.equal(false);
    expect(await pathExists(path.join(path.dirname(tmpDir), traversalFileName))).to.equal(false);
  });

  it('preserves authorization across approved redirect hostnames', async () => {
    let initialAuthorization;
    let redirectedAuthorization;

    const redirectedServer = http.createServer((req, res) => {
      redirectedAuthorization = req.headers.authorization;
      res.statusCode = 200;
      res.end('redirected payload');
    });

    await new Promise((resolve) => redirectedServer.listen(0, '127.0.0.1', resolve));

    const redirectingServer = http.createServer((req, res) => {
      initialAuthorization = req.headers.authorization;
      res.statusCode = 302;
      res.setHeader('Location', `http://127.0.0.1:${redirectedServer.address().port}/final`);
      res.end();
    });

    await new Promise((resolve) => redirectingServer.listen(0, '127.0.0.1', resolve));

    try {
      const result = await download(`http://127.0.0.1:${redirectingServer.address().port}/start`, {
        responseType: 'text',
        username: 'user',
        password: 'pass',
        allowedAuthRedirectHostnames: ['127.0.0.1'],
      });

      expect(result).to.equal('redirected payload');
      expect(initialAuthorization).to.equal('Basic dXNlcjpwYXNz');
      expect(redirectedAuthorization).to.equal('Basic dXNlcjpwYXNz');
    } finally {
      await Promise.all([
        new Promise((resolve, reject) => {
          redirectingServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        }),
        new Promise((resolve, reject) => {
          redirectedServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        }),
      ]);
    }
  });

  it('normalizes and strips capitalized Authorization headers on disallowed cross-origin redirects', async () => {
    let initialAuthorization;
    let redirectedAuthorization;

    const redirectedServer = http.createServer((req, res) => {
      redirectedAuthorization = req.headers.authorization;
      res.statusCode = 200;
      res.end('redirected payload');
    });

    await new Promise((resolve) => redirectedServer.listen(0, '127.0.0.1', resolve));

    const redirectingServer = http.createServer((req, res) => {
      initialAuthorization = req.headers.authorization;
      res.statusCode = 302;
      res.setHeader('Location', `http://127.0.0.1:${redirectedServer.address().port}/final`);
      res.end();
    });

    await new Promise((resolve) => redirectingServer.listen(0, '127.0.0.1', resolve));

    try {
      const result = await download(`http://127.0.0.1:${redirectingServer.address().port}/start`, {
        responseType: 'text',
        headers: {
          Authorization: '\tBearer token\t',
        },
      });

      expect(result).to.equal('redirected payload');
      expect(initialAuthorization).to.equal('Bearer token');
      expect(redirectedAuthorization).to.equal(undefined);
    } finally {
      await Promise.all([
        new Promise((resolve, reject) => {
          redirectingServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        }),
        new Promise((resolve, reject) => {
          redirectedServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        }),
      ]);
    }
  });

  it('cancels redirect bodies before following the next hop', async () => {
    const originalFetch = globalThis.fetch;
    const events = [];

    const redirectBody = {
      cancel: async () => {
        events.push('cancel-redirect');
      },
    };
    const finalBody = {
      cancel: async () => {
        events.push('cancel-final');
      },
    };

    globalThis.fetch = async (url) => {
      if (String(url) === 'http://example.com/start') {
        events.push('fetch-redirect');
        return {
          status: 302,
          headers: new globalThis.Headers({ location: 'http://example.com/final' }),
          body: redirectBody,
        };
      }

      if (String(url) === 'http://example.com/final') {
        events.push('fetch-final');
        return {
          ok: true,
          status: 200,
          url: 'http://example.com/final',
          headers: new globalThis.Headers({ 'content-type': 'text/plain' }),
          body: finalBody,
          arrayBuffer: async () => {
            events.push('read-final');
            return Buffer.from('ok');
          },
        };
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`);
    };

    try {
      const result = await download('http://example.com/start', { responseType: 'text' });

      expect(result).to.equal('ok');
      expect(events).to.deep.equal([
        'fetch-redirect',
        'cancel-redirect',
        'fetch-final',
        'read-final',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
