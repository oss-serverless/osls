import path from 'node:path';
import untildify from '../../utils/untildify.ts';
import ServerlessError from '../../serverless-error.ts';
import cliCommandsSchema from '../../cli/commands-schema/index.ts';
import download from '../../utils/download-template-from-repo.ts';
import renameService2 from '../../utils/rename-service.ts';
import copyDirContentsSync from '../../utils/fs/copy-dir-contents-sync.ts';
import dirExistsSync from '../../utils/fs/dir-exists-sync.ts';
import { progress, log, style } from '../../utils/serverless-utils/log.ts';
const renameService = renameService2.renameService;

const mainProgress = progress.get('main');

class Create {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {
      create: {
        ...cliCommandsSchema.get('create'),
      },
    };

    this.hooks = {
      'create:create': async () => this.create(),
    };
  }

  async create() {
    if ('template-url' in this.options) {
      // We only show progress in case of setup from `template-url` as setting up from local files is fast
      mainProgress.notice('Setting up new project', { isMainEvent: true });
      try {
        const serviceName = await download.downloadTemplateFromRepo(
          this.options['template-url'],
          this.options.name,
          this.options.path
        );
        const targetDirectory = this.options.path || `./${this.options.name || serviceName}`;

        log.notice();
        log.notice.success(
          `Project successfully created in "${targetDirectory}" ${style.aside(
            `(${Math.floor(
              (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
            )}s)`
          )}`
        );
      } catch (err) {
        if (err instanceof ServerlessError) {
          throw err;
        }

        throw new ServerlessError(
          err && err.message ? err.message : String(err),
          'BOILERPLATE_GENERATION_ERROR'
        );
      }
    } else if ('template-path' in this.options) {
      // Copying template from a local directory
      const defaultDirectoryName = path.basename(untildify(this.options['template-path']));
      const targetDirectoryName = this.options.name || defaultDirectoryName;
      const serviceDirDisplayPath = this.options.path || `./${targetDirectoryName}`;
      const serviceDir = this.options.path
        ? path.resolve(process.cwd(), untildify(this.options.path))
        : path.join(process.cwd(), targetDirectoryName);
      const effectiveServiceName =
        this.options.name || (this.options.path ? path.basename(serviceDir) : null);
      if (dirExistsSync(serviceDir)) {
        const errorMessage = `A folder named "${serviceDirDisplayPath}" already exists.`;
        throw new ServerlessError(errorMessage, 'TARGET_FOLDER_ALREADY_EXISTS');
      }
      copyDirContentsSync(untildify(this.options['template-path']), serviceDir, {
        noLinks: true,
      });
      if (effectiveServiceName) {
        renameService(effectiveServiceName, serviceDir);
      }
      log.notice();
      log.notice.success(`Project successfully created in "${serviceDirDisplayPath}"`);
    } else {
      const errorMessage = [
        'You must either pass a URL (--template-url) ',
        'or a local path (--template-path).',
      ].join('');
      throw new ServerlessError(errorMessage, 'MISSING_TEMPLATE_CLI_PARAM');
    }
  }
}

export default Create;
