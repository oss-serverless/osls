import { EventEmitter } from 'node:events';
import ensureString from 'type/string/ensure.js';
import isObject from 'type/object/is.js';
import createRandomString from 'ext/string/random.js';
import globalState from '../global-state.ts';
import memoizee from 'memoizee';
import logLevels from 'log/levels.json' with { type: 'json' };

const progressEmitter = (() => {
  if (!globalState.progressEmitter) {
    globalState.progressEmitter = new EventEmitter();
    globalState.progressEmitter.setMaxListeners(0);
  }
  return globalState.progressEmitter;
})();

const getProgressReporter = memoizee(
  (namespace) => {
    return {
      get: memoizee(
        (name) => {
          name = ensureString(name, { name: 'name' });
          const progress = {
            namespace,
            name,
            remove: () => {
              progressEmitter.emit('remove', { namespace, name });
            },
          };
          const levelsMeta = [
            { levelName: 'info', levelIndex: logLevels.indexOf('info') },
            { levelName: 'notice', levelIndex: logLevels.indexOf('notice') },
          ];
          for (const { levelName, levelIndex } of levelsMeta) {
            progress[levelName] = (textTokens, options = null) => {
              progressEmitter.emit('update', {
                namespace,
                name,
                level: levelName,
                levelIndex,
                textTokens,
                options,
              });
            };
          }
          progress.update = progress.notice;
          return progress;
        },
        namespace,
        { primitive: true }
      ),
      create(options = {}) {
        if (!isObject(options)) options = {};
        const message = ensureString(options.message, {
          isOptional: true,
          name: 'options.message',
        });
        const name = ensureString(options.name, {
          isOptional: true,
          name: 'options.name',
        });
        if (name && this.get._has(name)) {
          throw Object.assign(new Error(`Progress named "${name}" already exists`), {
            code: 'PROGRESS_NAME_TAKEN',
          });
        }
        const progress = this.get(name || `unnamed-${createRandomString({ isUnique: true })}`);
        if (message != null) progress.notice(message);
        return progress;
      },
    };
  },
  { primitive: true }
);

getProgressReporter.emitter = progressEmitter;

export { progressEmitter as emitter };
export default getProgressReporter;
