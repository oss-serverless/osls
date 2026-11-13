'use strict';

const http = require('http');

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ entry: process.argv[1] }));
});

if (require.main === module) server.listen(process.env.PORT, process.env.HOSTNAME);

module.exports = server;
