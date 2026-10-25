'use strict';

const { EventEmitter } = require('events');
const ensureString = require('type/string/ensure');
const isObject = require('type/object/is');
const createRandomString = require('ext/string/random');
const globalState = require('../global-state');
const memoizee = require('memoizee');
const logLevels = require('log/levels');

const progressEmitter = (() => {
  if (!globalState.progressEmitter) {
    globalState.progressEmitter = new EventEmitter();
    globalState.progressEmitter.setMaxListeners(0);
  }
  return globalState.progressEmitter;
})();

module.exports = memoizee(
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

module.exports.emitter = progressEmitter;
