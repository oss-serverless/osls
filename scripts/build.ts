// Builds the published package into `dist/`, which is the package root on npm:
// compiled `bin/`, `commands/`, `lib/` and `scripts/serverless.js`, the non-TypeScript assets
// of `lib/`, the configuration types, and a `package.json` generated from the root one
// Usage: node scripts/build.ts [extra tsc arguments, eg. --noCheck]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootPath = path.resolve(import.meta.dirname, '..');
const distPath = path.join(rootPath, 'dist');

fs.rmSync(distPath, { recursive: true, force: true });

const tscPath = path.join(rootPath, 'node_modules', '.bin', 'tsc');
const tsc = spawnSync(tscPath, ['-p', 'tsconfig.build.json', ...process.argv.slice(2)], {
  cwd: rootPath,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (tsc.status !== 0) {
  process.stderr.write('TypeScript build failed\n');
  process.exit(tsc.status || 1);
}

const copyAssets = (sourceDirPath: string, targetDirPath: string) => {
  for (const entry of fs.readdirSync(sourceDirPath, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirPath, entry.name);
    const targetPath = path.join(targetDirPath, entry.name);
    if (entry.isDirectory()) {
      copyAssets(sourcePath, targetPath);
    } else if (!entry.name.endsWith('.ts')) {
      fs.mkdirSync(targetDirPath, { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
};
copyAssets(path.join(rootPath, 'lib'), path.join(distPath, 'lib'));
fs.cpSync(path.join(rootPath, 'types'), path.join(distPath, 'types'), { recursive: true });
for (const filename of ['README.md', 'LICENSE.txt']) {
  fs.copyFileSync(path.join(rootPath, filename), path.join(distPath, filename));
}

const binPath = path.join(distPath, 'bin', 'serverless.js');
fs.chmodSync(binPath, 0o755);

const {
  devDependencies: _devDependencies,
  scripts: _scripts,
  packageManager: _packageManager,
  private: _private,
  ...packageJson
} = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8'));
const publishedBinPath = 'bin/serverless.js';
fs.writeFileSync(
  path.join(distPath, 'package.json'),
  `${JSON.stringify(
    {
      ...packageJson,
      main: 'lib/serverless.js',
      types: 'types/index.d.ts',
      bin: Object.fromEntries(Object.keys(packageJson.bin).map((name) => [name, publishedBinPath])),
    },
    null,
    2
  )}\n`
);

process.stdout.write(`Built ${path.relative(process.cwd(), distPath) || '.'}\n`);
