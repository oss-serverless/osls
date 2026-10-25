'use strict';

const path = require('path');
const fs = require('fs');

const fileExistsSync = require('./fs/file-exists-sync');
const readFileSync = require('./fs/read-file-sync');
const writeFileSync = require('./fs/write-file-sync');
const ServerlessError = require('../serverless-error');

function renameYmlService(name, ymlServiceFile) {
  const serverlessYml = fs
    .readFileSync(ymlServiceFile, 'utf8')
    .replace(/(^|\s|#)service\s*:.+/, (ignore, prefix) => `${prefix}service: ${name}`)
    .replace(
      /(^|\s|#)service\s*:\s*\n(\s+)name:.+/,
      (match, prefix, indent) => `${prefix}service:\n${indent}name: ${name}`
    );

  fs.writeFileSync(ymlServiceFile, serverlessYml);
}

function renameTsService(name, tsServicefile) {
  const serverlessTs = fs
    .readFileSync(tsServicefile, 'utf8')
    .replace(/(^|\s)service\s*:\s*('|").+('|")/, (ignore, prefix) => `${prefix}service: '${name}'`)
    .replace(
      /(^|\s)service\s*:\s*{\s*\n(\s+)name:\s*('|").+('|")/,
      (match, prefix, indent) => `${prefix}service: {\n${indent}name: '${name}'`
    );

  fs.writeFileSync(tsServicefile, serverlessTs);
}

function renameService(name, serviceDir) {
  const packageFile = path.join(serviceDir, 'package.json');
  if (fileExistsSync(packageFile)) {
    const json = readFileSync(packageFile);
    writeFileSync(packageFile, Object.assign(json, { name }));
  }
  const packageLockFile = path.join(serviceDir, 'package-lock.json');
  if (fileExistsSync(packageLockFile)) {
    const json = readFileSync(packageLockFile);
    writeFileSync(packageLockFile, Object.assign(json, { name }));
  }

  const ymlServiceFile = path.join(serviceDir, 'serverless.yml');
  if (fileExistsSync(ymlServiceFile)) {
    renameYmlService(name, ymlServiceFile);
    return name;
  }

  const tsServiceFile = path.join(serviceDir, 'serverless.ts');
  if (fileExistsSync(tsServiceFile)) {
    renameTsService(name, tsServiceFile);
    return name;
  }

  const errorMessage = ['serverless.yml or serverlss.ts not found in', ` ${serviceDir}`].join('');
  throw new ServerlessError(errorMessage, 'MISSING_SERVICE_FILE');
}

module.exports.renameService = renameService;
