# AGENTS.md

osls (Open Serverless) is a fork of Serverless Framework v3, maintained by the Bref team. This
fork is written in TypeScript 7, ships as ES modules only, and supports Node.js `^22.18.0 || ^24.0.0`.

## Layout

- `bin/serverless.ts`: CLI entry. Checks the Node.js version, then imports `lib/cli/triage.ts` and
  `scripts/serverless.ts` (or `lib/cli/run-compose.ts`).
- `scripts/serverless.ts`: CLI bootstrap (input, config loading, variables, `Serverless` instance).
- `lib/serverless.ts`: the `Serverless` class. Core classes in `lib/classes/`, plugins in
  `lib/plugins/` (AWS provider in `lib/plugins/aws/`), config loading in `lib/configuration/`.
- `types/index.d.ts`: public configuration types (`AWS`) and the `Serverless` default export.
- `dist/` (generated, ignored): the published package root, built by `scripts/build.ts`.

## Conventions

- Sources and tests run directly on Node.js type stripping: no build for development or tests.
  Use erasable TypeScript only (no `enum`, `namespace`, parameter properties). `tsconfig.json`
  enforces it with `erasableSyntaxOnly`.
- Relative imports use the `.ts` extension; `tsc` rewrites them to `.js` in `dist/`. Builtins
  use `node:`. Package subpaths without an `exports` map need an explicit file (`type/object/is.js`).
- No `require()`. Load modules with `import`/`import()`. Only `lib/utils/resolve-from.ts` uses
  `createRequire`, to resolve paths from another directory (plugins); loading still uses `import()`.
- Prefer named exports; keep a default export where existing callers use one.
- Never import `package.json` or build paths above `lib/`: use `lib/utils/package-root.ts`, which
  works from the sources and from `dist/`.
- Dynamic imports use string literals (or a map of literal imports) so `tsc` can rewrite them.
- Do not import `typescript`: TypeScript 7 has no compiler API. `typescript` in devDependencies is
  the TypeScript 6 API alias for typescript-eslint; `tsc` comes from `@typescript/native` (v7).
- User-land code stays JavaScript: `test/fixtures/**`, `**/fixture(s)/**`. CommonJS user configs,
  plugins and handlers must keep working.

## Commands

- `pnpm run typecheck`: `tsc -p tsconfig.json` (TypeScript 7).
- `pnpm run build`: `node scripts/build.ts` (add `--noCheck` to emit without type checking).
- `pnpm test`: all unit tests. One file:
  `node_modules/.bin/mocha --config test/mocha/config.json test/unit/path/to/file.test.ts`
- `pnpm run lint`, `pnpm run prettier-check`.
- Run the CLI from sources: `node bin/serverless.ts <command>`.

## Tests

- mocha with `test/mocha/config.json`; setup files live in `test/mocha/`.
- Mock a module's direct imports with esmock: `(await esmock('../x.ts', { '../y.ts': stub })).default`.
  Keys are relative to the test file. Avoid `esmock.strict` and avoid esmock global mocks for large
  packages such as AWS SDK clients (they make module URLs huge).
- `runServerless` stubs (`modulesCacheStub`, `awsSdkV3StubMap`, `shouldStubSpawn`) go through
  `test/mocha/module-stubs.ts`: listed modules load through live-binding proxies. Add a module to
  that list before stubbing it there.

## Publishing

`dist/` is the package root on npm: compiled `bin/`, `commands/`, `lib/`, assets, `types/` and a
generated `package.json`. The root `package.json` is private and points at the sources. The release
workflow builds, smoke tests the packed tarball and publishes `dist/`.

## Pitfalls

- Node.js refuses to strip types under `node_modules`, so the published package is compiled JS.
- `lib/serverless.ts` registers a `module.registerHooks` resolve hook for the `@serverless/utils`
  aliases used by CommonJS plugins; `log.ts` exports `'module.exports'` for `require()` callers.
- AJV standalone validators are cached as text and evaluated as ES modules from a `data:` URL.
- Custom resource Lambda handlers (`lib/plugins/aws/custom-resources/resources/`) are zipped as
  ESM JavaScript by `generate-zip.ts` and must export a named `handler`.
