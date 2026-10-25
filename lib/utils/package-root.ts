import fs from 'node:fs';
import path from 'node:path';

// The package root is found by walking up to the nearest package.json, so that it resolves
// the same way from the TypeScript sources and from the compiled output in `dist/`
const findPackageRoot = (dirname: string): string => {
  let current = dirname;
  while (!fs.existsSync(path.join(current, 'package.json'))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Cannot find osls package root from ${dirname}`);
    current = parent;
  }
  return current;
};

export const packageRoot = findPackageRoot(import.meta.dirname);

export const packageJson: {
  name: string;
  version: string;
  engines: { node: string };
  [key: string]: unknown;
} = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
