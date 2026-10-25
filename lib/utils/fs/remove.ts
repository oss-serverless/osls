import fs from 'node:fs';

const remove = (targetPath) => fs.promises.rm(targetPath, { recursive: true, force: true });
const removeSync = (targetPath) => fs.rmSync(targetPath, { recursive: true, force: true });

export { remove, removeSync };
export default { remove, removeSync };
