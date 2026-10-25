import path from 'node:path';
import { createRequire } from 'node:module';
import memoize from 'memoizee';

export default memoize((dirname) => createRequire(path.resolve(dirname, 'require-resolver')), {
  primitive: true,
});
