'use strict';

const fsp = require('fs').promises;
const os = require('os');
const yaml = require('js-yaml');
const isPlainObject = require('type/plain-object/is');
const cloudformationSchema = require('./serverless-utils/cloudformation-schema');

const topLevelKeyLineRegex = /^[^\s#][^:]*:(?:\s|$)/;
const documentMarkerRegex = /^(---|\.\.\.)(?:\s|$)/;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isSameValueZero = (left, right) =>
  left === right || (Number.isNaN(left) && Number.isNaN(right));

const stripLineEnding = (line) => line.replace(/[\r\n]+$/, '');

const splitIntoLines = (source) => source.match(/[^\n]*\n?|[^\n]+$/g) || [''];

const parseYaml = (source, filePath) => {
  return (
    yaml.load(source, {
      filename: filePath,
      schema: cloudformationSchema,
    }) || {}
  );
};

const serializeBranch = (headKey, branchValue) => {
  return yaml.dump({ [headKey]: branchValue }, { lineWidth: -1, noRefs: true });
};

const isTopLevelKeyLine = (line, key) => {
  const normalizedLine = stripLineEnding(line);

  if (key) {
    const escapedKey = escapeRegExp(key);
    return new RegExp(`^(?:"${escapedKey}"|'${escapedKey}'|${escapedKey}):(?:\\s|$)`).test(
      normalizedLine
    );
  }

  return topLevelKeyLineRegex.test(normalizedLine) || documentMarkerRegex.test(normalizedLine);
};

const findTopLevelBranchRange = (source, headKey) => {
  const lines = splitIntoLines(source);
  let offset = 0;
  let start = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (start === null && isTopLevelKeyLine(line, headKey)) {
      start = offset;
      offset += line.length;
      continue;
    }

    if (start !== null && isTopLevelKeyLine(line)) {
      return { start, end: offset };
    }

    offset += line.length;
  }

  if (start === null) {
    return null;
  }

  return { start, end: source.length };
};

const replaceTopLevelBranch = (source, headKey, branchValue) => {
  const branchRange = findTopLevelBranchRange(source, headKey);
  const branchText = branchValue === undefined ? '' : serializeBranch(headKey, branchValue);

  if (!branchRange) {
    if (!branchText) {
      return source;
    }

    const trimmedSource = source.replace(/\s*$/, '');
    if (!trimmedSource) {
      return branchText;
    }

    return `${trimmedSource}${os.EOL}${branchText}`;
  }

  const nextSource = `${source.slice(0, branchRange.start)}${branchText}${source.slice(
    branchRange.end
  )}`;
  return nextSource.trim() ? nextSource : '';
};

const ensureObjectPath = (root, pathSegments) => {
  let currentNode = root;

  for (const segment of pathSegments) {
    const value = currentNode[segment];
    if (value == null) {
      currentNode[segment] = {};
      currentNode = currentNode[segment];
      continue;
    }

    if (!isPlainObject(value)) {
      throw new Error(`${value} can only be undefined or an object!`);
    }

    currentNode = value;
  }

  return currentNode;
};

const pruneEmptyBranches = (root, pathSegments) => {
  const nodes = [root];
  let currentNode = root;

  for (let index = 0; index < pathSegments.length; index += 1) {
    currentNode = currentNode[pathSegments[index]];
    if (!isPlainObject(currentNode)) {
      return;
    }

    nodes.push(currentNode);
  }

  for (let index = pathSegments.length - 1; index >= 0; index -= 1) {
    const node = nodes[index + 1];
    if (Object.keys(node).length > 0) {
      break;
    }

    delete nodes[index][pathSegments[index]];
  }
};

const addNewArrayItem = async (ymlFile, pathInYml, newValue) => {
  const yamlContent = await fsp.readFile(ymlFile, 'utf8');
  const data = parseYaml(yamlContent, ymlFile);
  const pathSegments = pathInYml.split('.');
  const arrayPropertyName = pathSegments.at(-1);
  const currentNode = ensureObjectPath(data, pathSegments.slice(0, -1));
  const arrayProperty = currentNode[arrayPropertyName];

  if (arrayProperty != null && !Array.isArray(arrayProperty)) {
    throw new Error(`${arrayProperty} can only be undefined or an array!`);
  }

  const nextArray = arrayProperty || [];
  if (!nextArray.includes(newValue)) {
    nextArray.push(newValue);
  }
  currentNode[arrayPropertyName] = nextArray;

  await fsp.writeFile(
    ymlFile,
    replaceTopLevelBranch(yamlContent, pathSegments[0], data[pathSegments[0]])
  );
};

const removeExistingArrayItem = async (ymlFile, pathInYml, removeValue) => {
  const yamlContent = await fsp.readFile(ymlFile, 'utf8');
  const data = parseYaml(yamlContent, ymlFile);
  const pathSegments = pathInYml.split('.');
  const arrayPropertyName = pathSegments.at(-1);
  let currentNode = data;

  for (const segment of pathSegments.slice(0, -1)) {
    currentNode = currentNode && currentNode[segment];
    if (!isPlainObject(currentNode)) {
      return;
    }
  }

  const arrayProperty = currentNode[arrayPropertyName];
  if (!Array.isArray(arrayProperty)) {
    return;
  }

  for (let index = 0; index < arrayProperty.length; ) {
    if (isSameValueZero(arrayProperty[index], removeValue)) {
      arrayProperty.splice(index, 1);
    } else {
      index += 1;
    }
  }

  if (!arrayProperty.length) {
    delete currentNode[arrayPropertyName];
    pruneEmptyBranches(data, pathSegments.slice(0, -1));
  }

  await fsp.writeFile(
    ymlFile,
    replaceTopLevelBranch(yamlContent, pathSegments[0], data[pathSegments[0]])
  );
};

module.exports = {
  addNewArrayItem,
  removeExistingArrayItem,
};
