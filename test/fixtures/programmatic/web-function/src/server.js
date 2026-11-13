'use strict';

const http = require('http');

const [host, port] = process.env.AWS_LAMBDA_HTTP_ENDPOINT.split(':');

http
  .createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'Server' }));
  })
  .listen(Number(port), host);
