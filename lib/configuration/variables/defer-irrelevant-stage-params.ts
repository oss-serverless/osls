// Builds an `isPropertyDeferred` predicate which prevents eager resolution of `params.<stage>`
// sections not concerning the effective stage. The "param" source only reads
// `params.<currentStage>` and `params.default`, so resolving other sections at best wastes remote
// calls (e.g. SSM) and at worst fails the command on errors of irrelevant stages.
//
// Deferred properties stay in `variablesMeta`, so explicit references (e.g.
// `${self:params.prod.x}`) still resolve them on demand. Entries left deferred after the final
// pass are dropped by the caller (see `scripts/serverless.js`), leaving their raw values in the
// configuration.
//
// Known limitation: a whole section configured with a single variable (e.g.
// `params.prod: ${file(./prod-params.yml)}`) is still resolved, as the configuration schema
// requires it to be an object. Values nested in the resolved object are deferred as any other.

'use strict';

const isPlainObject = require('type/plain-object/is');
const { hasOwn } = require('../../utils/safe-object');

// `configuration` and `resolverConfiguration` are read live at each call (not snapshotted):
// plugins may extend the configuration with new stages, and the effective CLI options object is
// replaced between resolution passes
module.exports = (configuration, resolverConfiguration) => (propertyPath) => {
  if (!propertyPath.startsWith('params\0')) return false;
  if (!isPlainObject(configuration.params)) return false;

  const propertyPathKeys = propertyPath.split('\0');
  // Never defer the `params.<stage>` section itself: it has to resolve for the configuration to
  // validate (see "Known limitation" above)
  if (propertyPathKeys.length < 3) return false;

  const stageKey = propertyPathKeys[1];
  if (stageKey === 'default') return false;

  // Mirrors effective stage resolution of the "param" source
  // (lib/configuration/variables/sources/instance-dependent/param.js)
  const options = resolverConfiguration.options || {};
  let stage = hasOwn(options, 'stage') && options.stage != null ? options.stage : null;
  if (stage == null && isPlainObject(configuration.provider)) {
    const configuredStage = configuration.provider.stage;
    if (typeof configuredStage === 'string' || typeof configuredStage === 'number') {
      stage = configuredStage;
    }
  }
  if (stage == null) stage = 'dev';
  stage = String(stage);
  // The effective stage is not known yet (`provider.stage` is itself behind an unresolved
  // variable). Deferring against it could strand params of the actual effective stage as never
  // scheduled for resolution
  if (stage.includes('${')) return false;

  return stageKey !== stage;
};
