// esmock loads mocked module graphs from URLs whose query lists the mocked modules, packages
// included. Node.js refuses to strip types of a `.ts` URL that contains `/node_modules/`
// anywhere, query included, so the types of mocked `.ts` modules are stripped here instead.
// Registered before esmock's own hooks, so it sees the module before esmock expands its URL
import { registerHooks, stripTypeScriptTypes } from 'node:module';

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
