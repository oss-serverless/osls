#!/usr/bin/env node

'use strict';

/**
 * Drift guard for the osls docs:
 *   (a) every command in lib/cli/commands-schema has a docs/cli-reference page linked from the CLI index;
 *   (b) every docs/guides/*.md guide is linked from the guides index.
 * Node built-ins only. Exits 1 (with diffs) on drift, 0 when clean.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI_DIR = path.join(REPO_ROOT, 'docs', 'cli-reference');
const GUIDES_DIR = path.join(REPO_ROOT, 'docs', 'guides');
const CLI_NAV = path.join(CLI_DIR, 'README.md');
const GUIDES_NAV = path.join(GUIDES_DIR, 'README.md');

// Commands that intentionally ship without their own reference page.
//   '' / help -> built-in root and help screens
//   config    -> bare parent of `config credentials`
//   test      -> advertised in schema but unimplemented; drop once removed
const PAGELESS_COMMAND_ALLOWLIST = new Set(['', 'help', 'config', 'test']);

const slug = (commandName) => commandName.trim().split(/\s+/).filter(Boolean).join('-');

const mdBasenames = (dir) =>
  new Set(
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.md'))
      .map((d) => path.basename(d.name, '.md'))
  );

// Basenames of every relative .md link target in a nav file (null if the file is missing).
const linkedBasenames = (navFile) => {
  if (!fs.existsSync(navFile)) return null;
  const md = fs.readFileSync(navFile, 'utf8');
  const targets = new Set();
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(md))) {
    let target = m[1].trim().split(/\s+/)[0];
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith('#')) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target.endsWith('.md')) continue;
    targets.add(path.basename(target, '.md'));
  }
  return targets;
};

function checkCommands(errors) {
  const commands = require(path.join(REPO_ROOT, 'lib', 'cli', 'commands-schema'));
  const existingPages = mdBasenames(CLI_DIR);
  const navLinks = linkedBasenames(CLI_NAV);

  if (navLinks === null) {
    errors.push(
      'Missing CLI nav index: docs/cli-reference/README.md (create it; every command must be linked there).'
    );
  }

  for (const commandName of commands.keys()) {
    if (PAGELESS_COMMAND_ALLOWLIST.has(commandName)) continue;

    const words = commandName.trim().split(/\s+/).filter(Boolean);

    // Covered if the command's own slug page exists, or a parent prefix page does
    // (e.g. `deploy list functions` -> deploy-list.md).
    let coveringPage = null;
    for (let k = words.length; k >= 1; k -= 1) {
      const candidate = words.slice(0, k).join('-');
      if (existingPages.has(candidate)) {
        coveringPage = candidate;
        break;
      }
    }

    if (!coveringPage) {
      errors.push(
        `Command "osls ${commandName}" has no docs/cli-reference page ` +
          `(expected docs/cli-reference/${slug(commandName)}.md, or a parent page).`
      );
      continue;
    }

    if (navLinks && !navLinks.has(coveringPage)) {
      errors.push(
        `Command "osls ${commandName}" page (${coveringPage}.md) is not linked ` +
          `from docs/cli-reference/README.md (add a nav entry).`
      );
    }
  }
}

function checkGuides(errors) {
  const navLinks = linkedBasenames(GUIDES_NAV);
  if (navLinks === null) {
    errors.push(
      'Missing guides index: docs/guides/README.md (create it; every guide must be listed there).'
    );
    return;
  }

  for (const base of mdBasenames(GUIDES_DIR)) {
    if (base === 'README') continue;
    if (!navLinks.has(base)) {
      errors.push(`Guide docs/guides/${base}.md is missing from the index docs/guides/README.md.`);
    }
  }
}

function main() {
  const errors = [];
  checkCommands(errors);
  checkGuides(errors);

  if (errors.length) {
    console.error('Docs coverage check FAILED:\n');
    for (const e of errors) console.error(`  - ${e}`);
    console.error(
      `\n${errors.length} problem(s). See scripts/check-docs-coverage.js for the allowlist.`
    );
    process.exit(1);
  }
  console.log('Docs coverage check passed: all commands and guides are documented and linked.');
}

main();
