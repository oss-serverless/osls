import untildify from './untildify.ts';
import { promises as fsp } from 'node:fs';
import copy from './fs/copy.ts';
import { renameService } from './rename-service.ts';
import ServerlessError from '../serverless-error.ts';

export default async ({ templatePath, projectDir, projectName }) => {
  const sourcePath = untildify(templatePath);

  try {
    await copy(sourcePath, projectDir, {
      dereference: true,
      filter: async (src) => {
        const stats = await fsp.lstat(src);
        return !stats.isSymbolicLink();
      },
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new ServerlessError(
        `Could not find a template under provider path: ${sourcePath}`,
        'INVALID_TEMPLATE_PATH'
      );
    }

    throw new ServerlessError(`Cannot copy template: ${err.message}`, 'COPY_LOCAL_TEMPLATE_ERROR');
  }

  if (projectName) {
    renameService(projectName, projectDir);
  }
};
