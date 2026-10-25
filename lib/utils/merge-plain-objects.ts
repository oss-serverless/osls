'use strict';

const isPlainObject = require('type/plain-object/is');
const { isUnsafePropertyKey } = require('./object-path');

const hasOwn = Object.prototype.hasOwnProperty;

// Clone branches while preserving cycles and dropping unsafe keys.
const cloneMergeValue = (value, activeMergeTargets, clonedValues = new WeakMap()) => {
  if (value != null && typeof value === 'object' && activeMergeTargets.has(value)) {
    return activeMergeTargets.get(value);
  }

  if (Array.isArray(value)) {
    if (clonedValues.has(value)) return clonedValues.get(value);

    const clone = new Array(value.length);
    clonedValues.set(value, clone);

    value.forEach((item, index) => {
      clone[index] = cloneMergeValue(item, activeMergeTargets, clonedValues);
    });

    return clone;
  }

  if (isPlainObject(value)) {
    if (clonedValues.has(value)) return clonedValues.get(value);

    const clone = {};
    clonedValues.set(value, clone);

    for (const [key, nestedValue] of Object.entries(value)) {
      if (isUnsafePropertyKey(key)) continue;
      clone[key] = cloneMergeValue(nestedValue, activeMergeTargets, clonedValues);
    }

    return clone;
  }

  return value;
};

const mergeArrayValues = (targetValues, sourceValues, activeMergeTargets) => {
  const nextValues = new Array(targetValues.length);

  targetValues.forEach((value, index) => {
    nextValues[index] = cloneMergeValue(value, activeMergeTargets);
  });

  activeMergeTargets.set(sourceValues, nextValues);

  try {
    sourceValues.forEach((sourceValue, index) => {
      if (sourceValue === undefined) return;

      const targetValue = nextValues[index];

      if (
        sourceValue != null &&
        typeof sourceValue === 'object' &&
        activeMergeTargets.has(sourceValue)
      ) {
        nextValues[index] = activeMergeTargets.get(sourceValue);
        return;
      }

      if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
        mergeInto(targetValue, sourceValue, activeMergeTargets);
        return;
      }

      if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
        nextValues[index] = mergeArrayValues(targetValue, sourceValue, activeMergeTargets);
        return;
      }

      nextValues[index] = cloneMergeValue(sourceValue, activeMergeTargets);
    });

    return nextValues;
  } finally {
    activeMergeTargets.delete(sourceValues);
  }
};

const mergeInto = (target, source, activeMergeTargets) => {
  if (!isPlainObject(source)) return target;

  activeMergeTargets.set(source, target);

  try {
    for (const [key, sourceValue] of Object.entries(source)) {
      if (isUnsafePropertyKey(key)) continue;
      if (sourceValue === undefined) continue;

      if (
        sourceValue != null &&
        typeof sourceValue === 'object' &&
        activeMergeTargets.has(sourceValue)
      ) {
        target[key] = activeMergeTargets.get(sourceValue);
        continue;
      }

      // Ignore inherited branches on the target.
      const hasOwnBranch = hasOwn.call(target, key);
      const targetValue = hasOwnBranch ? target[key] : undefined;

      if (hasOwnBranch && isPlainObject(targetValue) && isPlainObject(sourceValue)) {
        mergeInto(targetValue, sourceValue, activeMergeTargets);
        continue;
      }

      if (hasOwnBranch && Array.isArray(targetValue) && Array.isArray(sourceValue)) {
        target[key] = mergeArrayValues(targetValue, sourceValue, activeMergeTargets);
        continue;
      }

      target[key] = cloneMergeValue(sourceValue, activeMergeTargets);
    }

    return target;
  } finally {
    activeMergeTargets.delete(source);
  }
};

const mergePlainObjects = (target, ...sources) => {
  for (const source of sources) {
    mergeInto(target, source, new WeakMap());
  }
  return target;
};

module.exports = mergePlainObjects;
