// This module is mostly adapted from https://github.com/kevva/download repository

// License of the original module - https://github.com/kevva/download/blob/master/license

// MIT License

// Copyright (c) Kevin Mårtensson <kevinmartensson@gmail.com> (github.com/kevva)

// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

const fsp = require('fs').promises;
const path = require('path');
const { URL } = require('url');
const { Agent } = require('undici');
const buildFetchDispatcher = require('../build-fetch-dispatcher');
const { parse: parseContentDisposition } = require('content-disposition');
const { default: filenamify } = require('filenamify');
const mime = require('mime-types');
const { extractZip, isZipBuffer } = require('../extract-zip');

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
const genericMimeTypes = new Set(['application/octet-stream', 'binary/octet-stream']);

const filenameFromPath = (requestUrl) => path.basename(new URL(requestUrl).pathname);

const getExtFromMime = (headers) => {
  const header = headers['content-type'];

  if (!header) {
    return null;
  }

  const mimeType = header.split(';')[0].trim().toLowerCase();

  if (genericMimeTypes.has(mimeType)) return null;

  return mime.extension(mimeType) || null;
};

const getFilename = ({ requestUrl, headers, data, explicitFilename }) => {
  if (explicitFilename) {
    return explicitFilename;
  }

  const header = headers['content-disposition'];

  if (header) {
    const parsed = parseContentDisposition(header);

    if (parsed.parameters && parsed.parameters.filename) {
      return parsed.parameters.filename;
    }
  }

  let filename = filenameFromPath(requestUrl);

  if (!path.extname(filename)) {
    const ext = isZipBuffer(data) ? 'zip' : getExtFromMime(headers);

    if (ext) {
      filename = `${filename}.${ext}`;
    }
  }

  return filename;
};

const fetchWithRedirects = async (
  requestUrl,
  { headers, dispatcher, signal, maxRedirects = 10, allowedAuthRedirectHostnames = [] } = {}
) => {
  let currentUrl = new URL(requestUrl);
  // Use the platform header parser so redirect auth checks see normalized names and values.
  let currentHeaders = Object.fromEntries(new globalThis.Headers(headers).entries());
  const allowedAuthHostnames = new Set(allowedAuthRedirectHostnames);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      headers: currentHeaders,
      dispatcher,
      signal,
      redirect: 'manual',
    });

    if (!redirectStatusCodes.has(response.status)) {
      return response;
    }

    try {
      if (redirectCount === maxRedirects) {
        throw new Error('Too many redirects');
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect response missing location header: ${response.status}`);
      }

      const nextUrl = new URL(location, currentUrl);
      // Never forward credentials to a different origin unless the redirect target is allowlisted.
      if (
        currentHeaders.authorization &&
        nextUrl.origin !== currentUrl.origin &&
        !allowedAuthHostnames.has(nextUrl.hostname)
      ) {
        currentHeaders = { ...currentHeaders };
        delete currentHeaders.authorization;
      }

      currentUrl = nextUrl;
    } finally {
      // Manual redirects leave the intermediate response open unless we release it ourselves.
      try {
        await response.body?.cancel();
      } catch {
        // Ignore cleanup errors and preserve the primary redirect failure, if any.
      }
    }
  }

  throw new Error('Too many redirects');
};

module.exports = (uri, output, opts) => {
  return (async () => {
    if (typeof output === 'object') {
      opts = output;
      output = null;
    }

    opts = Object.assign(
      {
        https: {
          rejectUnauthorized: process.env.npm_config_strict_ssl !== 'false',
        },
        responseType: 'buffer',
      },
      opts
    );

    const headers = { ...(opts.headers || {}) };
    if (opts.username || opts.password) {
      headers.authorization = `Basic ${Buffer.from(
        `${opts.username || ''}:${opts.password || ''}`
      ).toString('base64')}`;
    }

    const dispatcher =
      opts.https && opts.https.rejectUnauthorized === false
        ? new Agent({ connect: { rejectUnauthorized: false } })
        : buildFetchDispatcher();

    const response = await fetchWithRedirects(uri, {
      headers,
      dispatcher,
      signal: typeof opts.timeout === 'number' ? AbortSignal.timeout(opts.timeout) : undefined,
      maxRedirects: opts.maxRedirects,
      allowedAuthRedirectHostnames: opts.allowedAuthRedirectHostnames,
    });

    if (!response.ok) {
      throw new Error(`Unexpected download response: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const data = opts.responseType === 'buffer' ? buffer : buffer.toString(opts.encoding || 'utf8');
    const isZip = isZipBuffer(buffer);

    if (opts.extract && !isZip) {
      throw new Error('Only ZIP archives can be extracted');
    }

    if (!output) {
      return opts.extract ? extractZip(buffer, null, opts) : data;
    }

    if (opts.extract) {
      return extractZip(buffer, output, opts);
    }

    const responseHeaders = Object.fromEntries(response.headers);
    const filename = filenamify(
      getFilename({
        requestUrl: response.url,
        headers: responseHeaders,
        data: buffer,
        explicitFilename: opts.filename,
      })
    );
    const outputFilepath = path.join(output, filename);

    await fsp.mkdir(path.dirname(outputFilepath), { recursive: true });
    await fsp.writeFile(outputFilepath, data);

    return data;
  })();
};
