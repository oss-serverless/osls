import path from 'node:path';
import { createRequire } from 'node:module';
import memoize from 'memoizee';

// Resolves a module request as if it was made from a file in `dirname`. Plugins are resolved with
// Node's CommonJS resolution (`main`, extensionless and directory requests), which ESM resolution
// does not offer for an arbitrary directory. Only the path is resolved: loading uses `import()`
const getResolve = memoize(
  (dirname: string) => createRequire(path.resolve(dirname, 'resolver')).resolve,
  {
    primitive: true,
  }
);

export default (dirname: string, request: string): string => getResolve(dirname)(request);
