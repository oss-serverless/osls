'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const yaml = require('js-yaml');
const cloudformationSchema = require('../utils/serverless-utils/cloudformation-schema');
const isPlainObject = require('type/plain-object/is');
const ServerlessError = require('../serverless-error');
const { isExternalRefAccessDeniedError } = require('./yaml-parser/external-ref-errors');
const { normalizeExternalRefOptions } = require('./yaml-parser/external-ref-options');
const { readExternalDocument } = require('./yaml-parser/external-ref-reader');
const { safeSet } = require('../utils/safe-object');

const getDocumentUrl = (yamlFilePath) => pathToFileURL(path.resolve(yamlFilePath)).href;

const splitReference = (absoluteReference) => {
  const hashIndex = absoluteReference.indexOf('#');

  if (hashIndex === -1) {
    return { documentUrl: absoluteReference, pointer: '#' };
  }

  return {
    documentUrl: absoluteReference.slice(0, hashIndex),
    pointer: absoluteReference.slice(hashIndex) || '#',
  };
};

const getJsonPointerValue = (source, pointer) => {
  if (!pointer || pointer === '#') return source;

  if (!pointer.startsWith('#/')) {
    throw new Error(`Unsupported JSON pointer: ${pointer}`);
  }

  let current = source;

  for (const rawSegment of pointer.slice(2).split('/')) {
    const segment = decodeURIComponent(rawSegment).replace(/~1/g, '/').replace(/~0/g, '~');

    if (
      current == null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      throw new Error(`JSON Pointer points to missing location: ${pointer}`);
    }

    current = current[segment];
  }

  return current;
};

const cloneValue = (value) => {
  if (value == null || typeof value !== 'object') return value;
  return structuredClone(value);
};

const isCircularYamlReferenceError = (error) =>
  error && error.code === 'INVALID_YAML_CIRCULAR_REFERENCE';

const loadExternalDocument = (documentUrl, state) => {
  if (!state.documents.has(documentUrl)) {
    state.documents.set(
      documentUrl,
      readExternalDocument(documentUrl, state.externalRefs).then((document) =>
        yaml.load(Buffer.isBuffer(document) ? document.toString('utf8') : String(document), {
          schema: cloudformationSchema,
        })
      )
    );
  }

  return state.documents.get(documentUrl);
};

const materializeRef = async (refObject, context) => {
  if (!context.resolveLocalRefs && refObject.$ref.startsWith('#')) {
    return cloneValue(refObject);
  }

  const absoluteReference = new URL(refObject.$ref, context.documentUrl).href;

  if (context.state.activeReferences.has(absoluteReference)) {
    return cloneValue(refObject);
  }

  if (context.state.references.has(absoluteReference)) {
    return context.state.references.get(absoluteReference);
  }

  context.state.activeReferences.add(absoluteReference);

  try {
    const { documentUrl, pointer } = splitReference(absoluteReference);
    const document = await loadExternalDocument(documentUrl, context.state);
    const target = getJsonPointerValue(document, pointer);
    const resolvedTarget = await materializeTarget(
      target,
      documentUrl,
      context.state,
      absoluteReference
    );

    context.state.references.set(absoluteReference, resolvedTarget);
    return resolvedTarget;
  } catch (error) {
    if (isCircularYamlReferenceError(error)) throw error;
    if (isExternalRefAccessDeniedError(error)) throw error;
    return cloneValue(refObject);
  } finally {
    context.state.activeReferences.delete(absoluteReference);
  }
};

const materializeTarget = async (target, documentUrl, state, absoluteReference) => {
  if (state.references.has(absoluteReference)) {
    return state.references.get(absoluteReference);
  }

  // Reject YAML anchor cycles instead of materializing recursive output.
  if (target != null && typeof target === 'object') {
    if (state.inProgress.has(target)) {
      throw new ServerlessError(
        'Circular YAML reference detected while resolving external $ref. ' +
          'osls does not support cyclic YAML anchor structures.',
        'INVALID_YAML_CIRCULAR_REFERENCE'
      );
    }
    if (state.materialized.has(target)) {
      const cached = state.materialized.get(target);
      state.references.set(absoluteReference, cached);
      return cached;
    }
    state.inProgress.add(target);
  }

  try {
    if (Array.isArray(target)) {
      const resolvedTarget = [];
      state.references.set(absoluteReference, resolvedTarget);
      state.materialized.set(target, resolvedTarget);

      try {
        for (const item of target) {
          resolvedTarget.push(
            await materializeValue(item, { documentUrl, resolveLocalRefs: true, state })
          );
        }

        return resolvedTarget;
      } catch (error) {
        state.references.delete(absoluteReference);
        state.materialized.delete(target);
        throw error;
      }
    }

    if (isPlainObject(target)) {
      if (typeof target.$ref === 'string') {
        const resolvedTarget = await materializeRef(target, {
          documentUrl,
          resolveLocalRefs: true,
          state,
        });

        state.references.set(absoluteReference, resolvedTarget);
        return resolvedTarget;
      }

      const resolvedTarget = {};
      state.references.set(absoluteReference, resolvedTarget);
      state.materialized.set(target, resolvedTarget);

      try {
        for (const [key, value] of Object.entries(target)) {
          const resolvedChild = await materializeValue(value, {
            documentUrl,
            resolveLocalRefs: true,
            state,
          });
          safeSet(resolvedTarget, key, resolvedChild);
        }

        return resolvedTarget;
      } catch (error) {
        state.references.delete(absoluteReference);
        state.materialized.delete(target);
        throw error;
      }
    }

    const resolvedTarget = cloneValue(target);
    state.references.set(absoluteReference, resolvedTarget);
    return resolvedTarget;
  } finally {
    if (target != null && typeof target === 'object') {
      state.inProgress.delete(target);
    }
  }
};

const materializeValue = async (value, context) => {
  if (Array.isArray(value)) {
    if (context.state.inProgress.has(value)) {
      throw new ServerlessError(
        'Circular YAML reference detected during YAML materialization. ' +
          'osls does not support cyclic YAML anchor structures.',
        'INVALID_YAML_CIRCULAR_REFERENCE'
      );
    }
    if (context.state.materialized.has(value)) {
      return context.state.materialized.get(value);
    }

    context.state.inProgress.add(value);
    try {
      const resolvedValue = [];
      context.state.materialized.set(value, resolvedValue);

      for (const item of value) {
        resolvedValue.push(await materializeValue(item, context));
      }

      return resolvedValue;
    } catch (error) {
      context.state.materialized.delete(value);
      throw error;
    } finally {
      context.state.inProgress.delete(value);
    }
  }

  if (isPlainObject(value)) {
    if (typeof value.$ref === 'string') {
      return materializeRef(value, context);
    }

    if (context.state.inProgress.has(value)) {
      throw new ServerlessError(
        'Circular YAML reference detected during YAML materialization. ' +
          'osls does not support cyclic YAML anchor structures.',
        'INVALID_YAML_CIRCULAR_REFERENCE'
      );
    }
    if (context.state.materialized.has(value)) {
      return context.state.materialized.get(value);
    }

    context.state.inProgress.add(value);
    try {
      const resolvedValue = {};
      context.state.materialized.set(value, resolvedValue);

      for (const [key, childValue] of Object.entries(value)) {
        const resolvedChild = await materializeValue(childValue, context);
        safeSet(resolvedValue, key, resolvedChild);
      }

      return resolvedValue;
    } catch (error) {
      context.state.materialized.delete(value);
      throw error;
    } finally {
      context.state.inProgress.delete(value);
    }
  }

  return cloneValue(value);
};

class YamlParser {
  constructor(serverless) {
    this.serverless = serverless;
  }

  async parse(yamlFilePath, options) {
    const root = this.serverless.utils.readFileSync(yamlFilePath);
    const externalRefs = await normalizeExternalRefOptions(yamlFilePath, options);

    return materializeValue(root, {
      documentUrl: getDocumentUrl(yamlFilePath),
      resolveLocalRefs: false,
      state: {
        activeReferences: new Set(),
        documents: new Map(),
        references: new Map(),
        materialized: new WeakMap(),
        inProgress: new WeakSet(),
        externalRefs,
      },
    });
  }
}

module.exports = YamlParser;
