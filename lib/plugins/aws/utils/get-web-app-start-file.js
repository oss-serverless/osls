'use strict';

// Lambda imports the file it is pointed at, so the entry is started through Module.runMain()
// to make it the main script, as it is under "node <entry>"
module.exports = (entry) => `// Added by osls to start the "entry" of the web app
import Module from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
const separatorIndex = endpoint ? endpoint.lastIndexOf(':') : -1;
if (separatorIndex !== -1) {
  process.env.HOSTNAME = endpoint.slice(0, separatorIndex).replace(/^\\[|\\]$/g, '');
  process.env.PORT = endpoint.slice(separatorIndex + 1);
}

process.argv[1] = path.join(import.meta.dirname, ${JSON.stringify(entry)});
if (typeof Module.runMain === 'function') {
  Module.runMain(process.argv[1]);
} else {
  await import(pathToFileURL(process.argv[1]).href);
}
`;
