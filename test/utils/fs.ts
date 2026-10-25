'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const yaml = require('js-yaml');
const JSZip = require('jszip');

const tmpDirCommonPath = require('../lib/process-tmp-dir');

function getTmpDirPath() {
  return path.join(tmpDirCommonPath, crypto.randomBytes(12).toString('hex'));
}

function getTmpFilePath(fileName) {
  return path.join(getTmpDirPath(), fileName);
}

function createTmpDir() {
  const dirPath = getTmpDirPath();
  ensureDirSync(dirPath);
  return dirPath;
}

function createTmpFile(name) {
  const filePath = getTmpFilePath(name);
  ensureFileSync(filePath);
  return filePath;
}

function ensureDir(dirPath) {
  return fsp.mkdir(dirPath, { recursive: true });
}

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function ensureFile(filePath) {
  await ensureDir(path.dirname(filePath));
  const fileHandle = await fsp.open(filePath, 'a');
  try {
    // Opening with 'a' creates without truncating existing content.
  } finally {
    await fileHandle.close();
  }
}

function ensureFileSync(filePath) {
  ensureDirSync(path.dirname(filePath));
  fs.closeSync(fs.openSync(filePath, 'a'));
}

async function outputFile(filePath, data, options) {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, data, options);
}

function outputFileSync(filePath, data, options) {
  ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, data, options);
}

const pathExists = (filePath) =>
  fsp.access(filePath).then(
    () => true,
    () => false
  );

const remove = (targetPath) => fsp.rm(targetPath, { recursive: true, force: true });

const removeSync = (targetPath) => fs.rmSync(targetPath, { recursive: true, force: true });

async function copyPath(sourcePath, destinationPath, options = {}) {
  await ensureDir(path.dirname(destinationPath));
  const copyOptions = {
    dereference: Boolean(options.dereference),
    force: options.force !== false,
    recursive: true,
  };
  if (typeof options.filter === 'function') copyOptions.filter = options.filter;
  await fsp.cp(sourcePath, destinationPath, copyOptions);
}

function copyPathSync(sourcePath, destinationPath, options = {}) {
  ensureDirSync(path.dirname(destinationPath));
  const copyOptions = {
    dereference: Boolean(options.dereference),
    force: options.force !== false,
    recursive: true,
  };
  if (typeof options.filter === 'function') copyOptions.filter = options.filter;
  fs.cpSync(sourcePath, destinationPath, copyOptions);
}

async function readJsonFile(filePath) {
  const contents = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(contents.replace(/^\uFEFF/u, ''));
}

async function writeJsonFile(filePath, value, { spaces } = {}) {
  const serialized = JSON.stringify(value, null, spaces);
  if (serialized === undefined) {
    throw new TypeError(`Converting ${typeof value} value to JSON is not supported`);
  }
  await outputFile(filePath, `${serialized}\n`);
}

function replaceTextInFile(filePath, subString, newSubString) {
  const fileContent = fs.readFileSync(filePath).toString();
  fs.writeFileSync(filePath, fileContent.replace(subString, newSubString));
}

function readYamlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

function writeYamlFile(filePath, content) {
  const data = yaml.dump(content);
  fs.writeFileSync(filePath, data);
  return data;
}

function listZipFiles(filename) {
  return new JSZip().loadAsync(fs.readFileSync(filename)).then((zip) => Object.keys(zip.files));
}

async function listFileProperties(filename) {
  const zip = await new JSZip().loadAsync(fs.readFileSync(filename));
  return zip.files;
}

module.exports = {
  tmpDirCommonPath,
  getTmpDirPath,
  getTmpFilePath,
  createTmpDir,
  createTmpFile,
  ensureDir,
  ensureDirSync,
  ensureFile,
  ensureFileSync,
  outputFile,
  outputFileSync,
  pathExists,
  remove,
  removeSync,
  copyPath,
  copyPathSync,
  readJsonFile,
  writeJsonFile,
  replaceTextInFile,
  readYamlFile,
  writeYamlFile,
  listZipFiles,
  listFileProperties,
};
