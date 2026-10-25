// Module stubs for `runServerless` (`modulesCacheStub`, `awsSdkV3StubMap`, `shouldStubSpawn`).
//
// The modules listed below are loaded through a generated proxy module that re-exports each
// export of the real module as a live (`let`) binding. `setModuleStubs()` points those bindings
// at stub values and `resetModuleStubs()` points them back, so every importer sees the stub
// while it is set, without loading a separate copy of the module graph.
//
// Only modules listed here can be stubbed: the proxy must be in place before the module is
// first imported. Importers see a stub only through bindings read at call time (named or
// default imports), not through values copied at module evaluation.
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootPath = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

const stubbablePackages = [
  '@aws-sdk/client-api-gateway',
  '@aws-sdk/client-apigatewayv2',
  '@aws-sdk/client-cloudformation',
  '@aws-sdk/client-cloudwatch',
  '@aws-sdk/client-cloudwatch-logs',
  '@aws-sdk/client-cognito-identity-provider',
  '@aws-sdk/client-ecr',
  '@aws-sdk/client-eventbridge',
  '@aws-sdk/client-iam',
  '@aws-sdk/client-lambda',
  '@aws-sdk/client-s3',
  '@aws-sdk/client-ssm',
  '@aws-sdk/client-sso-oidc',
  '@aws-sdk/client-sts',
  '@aws-sdk/lib-storage',
  'https-proxy-agent',
];

const stubbableLocalModules = [
  'lib/utils/get-stdin.ts',
  'lib/utils/serverless-utils/log.ts',
  'lib/utils/sleep.ts',
  'lib/utils/spawn.ts',
];

const stubbableUrls = new Set([
  ...stubbablePackages.map((name) => import.meta.resolve(name)),
  ...stubbableLocalModules.map((modulePath) => pathToFileURL(path.join(rootPath, modulePath)).href),
]);

const proxyScheme = 'osls-module-stub:';
// Module format ('commonjs', 'module', 'module-typescript') of each proxied module, by URL
const moduleFormats = new Map<string, string>();
const registryKey = Symbol.for('osls.test.moduleStubs');
const registry: { listeners: Map<string, (stub: unknown) => void> } = (globalThis[registryKey] = {
  listeners: new Map(),
});

// Resolves a stub key (a package name or an absolute module path) to the URL of its module.
// Absolute paths to `.js` files that are `.ts` sources now are mapped to them
export const resolveModuleStubUrl = (key: string): string => {
  let url;
  if (path.isAbsolute(key)) {
    const typeScriptPath = key.endsWith('.js') ? `${key.slice(0, -'.js'.length)}.ts` : key;
    url = pathToFileURL(
      stubbableUrls.has(pathToFileURL(typeScriptPath).href) ? typeScriptPath : key
    ).href;
  } else {
    url = import.meta.resolve(key);
  }
  if (!stubbableUrls.has(url)) {
    throw new Error(
      `Module "${key}" cannot be stubbed. Add it to the stubbable modules in test/mocha/module-stubs.ts`
    );
  }
  return url;
};

export const setModuleStubs = async (stubs: Record<string, unknown>): Promise<void> => {
  for (const [key, stub] of Object.entries(stubs)) {
    const url = resolveModuleStubUrl(key);
    // Not imported yet: import it now (through its proxy) so the stub applies to its first
    // importers too
    if (!registry.listeners.has(url)) await import(`${proxyScheme}${url}`);
    registry.listeners.get(url)(stub);
  }
};

export const resetModuleStubs = (): void => {
  for (const listener of registry.listeners.values()) listener(null);
};

const isIdentifier = (name: string): boolean => /^[A-Za-z_$][\w$]*$/.test(name);

const createProxySource = (realUrl: string): string => {
  // A synchronous load of the real module gives its export names: `module.exports` keys for
  // CommonJS, the namespace (or its 'module.exports' export) for ES modules
  const realPath = fileURLToPath(realUrl);
  const isCommonJs = moduleFormats.get(realUrl) === 'commonjs';
  const names = Object.keys(require(realPath)).filter(
    (name) => name !== 'default' && name !== 'module.exports' && name !== '__esModule'
  );
  const bindings = names.map((name, index) => ({ name, binding: `__export${index}` }));
  return [
    `import * as realNamespace from ${JSON.stringify(realUrl)};`,
    `const real = ${isCommonJs ? 'realNamespace.default' : 'realNamespace'};`,
    'const pick = (stub, name) =>',
    '  stub != null && Object.prototype.hasOwnProperty.call(stub, name) ? stub[name] : real[name];',
    ...bindings.map(({ name, binding }) => `let ${binding} = real[${JSON.stringify(name)}];`),
    'let __default = realNamespace.default;',
    ...bindings.map(({ name, binding }) =>
      isIdentifier(name)
        ? `export { ${binding} as ${name} };`
        : `export { ${binding} as ${JSON.stringify(name)} };`
    ),
    'export { __default as default };',
    `globalThis[Symbol.for('osls.test.moduleStubs')].listeners.set(${JSON.stringify(realUrl)}, (stub) => {`,
    ...bindings.map(({ name, binding }) => `  ${binding} = pick(stub, ${JSON.stringify(name)});`),
    '  if (stub == null) __default = realNamespace.default;',
    '  else if (Object.prototype.hasOwnProperty.call(stub, "default")) __default = stub.default;',
    `  else if (${isCommonJs} && typeof stub === 'object') __default = { ...realNamespace.default, ...stub };`,
    '  else __default = stub;',
    '});',
  ].join('\n');
};

// esmock loads its target from a URL with `?esmk=<id>` (definitions in `global.mockKeys`, its
// hooks run in this thread) or with the definitions in the URL itself. Each mocked module
// appears in them as `<url>?esmkTreeId=<n>`
const isMockedByEsmock = (parentURL: string | undefined, url: string): boolean => {
  if (!parentURL || !parentURL.includes('esmk')) return false;
  const id = /[?&]esmk=(\d+)/.exec(parentURL)?.[1];
  const definitions =
    (id && (globalThis as { mockKeys?: Record<string, string> }).mockKeys?.[id]) || parentURL;
  return typeof definitions === 'string' && definitions.includes(`${url}?esmkTreeId=`);
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(proxyScheme)) {
      const realUrl = specifier.slice(proxyScheme.length);
      moduleFormats.set(realUrl, nextResolve(realUrl, context).format);
      return { url: specifier, format: 'module', shortCircuit: true };
    }
    const result = nextResolve(specifier, context);
    // The proxy, and this module (reading export names), load the real module
    if (context.parentURL && context.parentURL.startsWith(proxyScheme)) return result;
    if (context.parentURL === import.meta.url) return result;
    if (!stubbableUrls.has(result.url)) return result;
    // CommonJS `require()` (eg. @aws-sdk/lib-storage requiring @aws-sdk/client-s3, also when
    // reading export names below) cannot load the proxy as the same module instance: a second
    // proxy instance would take over the stub listener from the one ES modules import
    if (context.conditions && context.conditions.includes('require')) return result;
    // esmock mocks this import of its target: hand esmock the real URL, which its mock
    // definitions are keyed by (a proxy URL would leave the import unmocked)
    if (isMockedByEsmock(context.parentURL, result.url)) return result;
    moduleFormats.set(result.url, result.format);
    return { url: `${proxyScheme}${result.url}`, format: 'module', shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(proxyScheme)) return nextLoad(url, context);
    return {
      format: 'module',
      source: createProxySource(url.slice(proxyScheme.length)),
      shortCircuit: true,
    };
  },
});
