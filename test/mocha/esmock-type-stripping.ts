// esmock loads mocked module graphs from URLs whose query lists the mocked modules, packages
// included. Node.js refuses to strip types of a `.ts` URL that contains `/node_modules/`
// anywhere, query included, so the types of mocked `.ts` modules are stripped here instead.
// Registered before esmock's own hooks, so it sees the module before esmock expands its URL
import nodeModule, {
  registerHooks,
  stripTypeScriptTypes,
  syncBuiltinESMExports,
} from 'node:module';

// esmock registers its hooks (through `module.registerHooks`) on its first mock. Its load hook
// matches each URL against `.*` regular expressions, which take quadratic time in the URL
// length: a multi-megabyte `data:` URL (the AJV validators of config-schema-handler) hangs the
// process. esmock never handles `data:` URLs, so they bypass the load hooks registered later
const originalRegisterHooks = nodeModule.registerHooks;
nodeModule.registerHooks = (hooks) =>
  originalRegisterHooks({
    ...hooks,
    load:
      hooks.load &&
      ((url, context, nextLoad) =>
        url.startsWith('data:') ? nextLoad(url, context) : hooks.load(url, context, nextLoad)),
  });
// Also for code calling the named `registerHooks` export
syncBuiltinESMExports();

const isMockedTypeScriptModule = (url: string): boolean => {
  if (!url.startsWith('file:')) return false;
  const queryIndex = url.indexOf('?');
  return (
    queryIndex !== -1 &&
    /\.[cm]?ts$/.test(url.slice(0, queryIndex)) &&
    url.includes('esmk', queryIndex)
  );
};

registerHooks({
  load(url, context, nextLoad) {
    if (!isMockedTypeScriptModule(url)) return nextLoad(url, context);
    const result = nextLoad(url, { ...context, format: 'module' });
    return { ...result, format: 'module', source: stripTypeScriptTypes(String(result.source)) };
  },
});
