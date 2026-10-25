import { pathToFileURL } from 'node:url';

// Loads a user module (plugin, handler, data file) by absolute path. CommonJS modules come
// through Node's interop as the default export. A transpiled `exports.default` is unwrapped
export default async (modPath: string) => {
  const namespace = await import(pathToFileURL(modPath).href);
  const mod = 'default' in namespace ? namespace.default : namespace;
  return mod && mod.default ? mod.default : mod;
};
