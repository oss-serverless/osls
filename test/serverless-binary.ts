import path from 'node:path';

export default (() => {
  if (process.env.SERVERLESS_BINARY_PATH) return path.resolve(process.env.SERVERLESS_BINARY_PATH);
  return path.join(import.meta.dirname, '../bin/serverless.ts');
})();
