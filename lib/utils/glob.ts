'use strict';

const fs = require('node:fs');
const path = require('node:path');
const fastGlob = require('fast-glob');

const toArray = (patterns) => {
  return Array.isArray(patterns) ? patterns : [patterns];
};

const isDynamicPattern = (pattern) => /[*?{}()[\]]/.test(pattern);

const maybeExpandDirectoryPattern = (pattern, cwd) => {
  if (isDynamicPattern(pattern)) {
    return pattern;
  }

  const absolutePattern = path.resolve(cwd || process.cwd(), pattern);
  try {
    if (fs.statSync(absolutePattern).isDirectory()) {
      const normalizedPattern = pattern.replace(/\\/g, '/').replace(/\/$/, '');
      return `${normalizedPattern}/**/*`;
    }
  } catch {
    // Ignore missing paths and let fast-glob handle them.
  }

  return pattern;
};

const expandPattern = (pattern, cwd, expandDirectories) => {
  if (!expandDirectories) {
    return pattern;
  }

  if (pattern.startsWith('!')) {
    return `!${maybeExpandDirectoryPattern(pattern.slice(1), cwd)}`;
  }

  return maybeExpandDirectoryPattern(pattern, cwd);
};

const normalizeOptions = (options = {}) => {
  const globOptions = { ...options };
  const expandDirectories =
    globOptions.expandDirectories !== undefined ? globOptions.expandDirectories : true;

  delete globOptions.expandDirectories;
  delete globOptions.nosort;

  if (globOptions.follow !== undefined) {
    globOptions.followSymbolicLinks = globOptions.follow;
    delete globOptions.follow;
  }

  if (globOptions.nodir !== undefined) {
    globOptions.onlyFiles = globOptions.nodir;
    delete globOptions.nodir;
  }

  if (globOptions.silent !== undefined) {
    globOptions.suppressErrors = globOptions.silent;
    delete globOptions.silent;
  }

  return { expandDirectories, globOptions };
};

const buildTasks = (patterns, globOptions) => {
  const tasks = [];
  let remainingPatterns = patterns;

  while (remainingPatterns.length > 0) {
    const negativePatternIndex = remainingPatterns.findIndex((pattern) => pattern.startsWith('!'));

    if (negativePatternIndex === -1) {
      tasks.push({
        patterns: remainingPatterns,
        options: {
          ...globOptions,
          ignore: [...(globOptions.ignore || [])],
        },
      });
      break;
    }

    const ignorePattern = remainingPatterns[negativePatternIndex].slice(1);

    for (const task of tasks) {
      task.options.ignore.push(ignorePattern);
    }

    if (negativePatternIndex !== 0) {
      tasks.push({
        patterns: remainingPatterns.slice(0, negativePatternIndex),
        options: {
          ...globOptions,
          ignore: [...(globOptions.ignore || []), ignorePattern],
        },
      });
    }

    remainingPatterns = remainingPatterns.slice(negativePatternIndex + 1);
  }

  return tasks;
};

const collectResults = async (tasks) => {
  const seen = new Set();
  const results = [];

  for (const task of tasks) {
    for (const entry of await fastGlob(task.patterns, task.options)) {
      if (seen.has(entry)) {
        continue;
      }

      seen.add(entry);
      results.push(entry);
    }
  }

  return results;
};

const collectResultsSync = (tasks) => {
  const seen = new Set();
  const results = [];

  for (const task of tasks) {
    for (const entry of fastGlob.sync(task.patterns, task.options)) {
      if (seen.has(entry)) {
        continue;
      }

      seen.add(entry);
      results.push(entry);
    }
  }

  return results;
};

const glob = async (patterns, options = {}) => {
  const normalizedPatterns = toArray(patterns);
  const { expandDirectories, globOptions } = normalizeOptions(options);
  const expandedPatterns = normalizedPatterns.map((pattern) =>
    expandPattern(pattern, globOptions.cwd, expandDirectories)
  );

  return collectResults(buildTasks(expandedPatterns, globOptions));
};

glob.sync = (patterns, options = {}) => {
  const normalizedPatterns = toArray(patterns);
  const { expandDirectories, globOptions } = normalizeOptions(options);
  const expandedPatterns = normalizedPatterns.map((pattern) =>
    expandPattern(pattern, globOptions.cwd, expandDirectories)
  );

  return collectResultsSync(buildTasks(expandedPatterns, globOptions));
};

module.exports = glob;
