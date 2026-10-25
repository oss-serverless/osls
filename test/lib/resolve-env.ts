'use strict';

const { createEnv } = require('../utils/process');

const WIN32_SYSTEM_VAR_NAMES = new Set([
  'allusersprofile',
  'comspec',
  'localappdata',
  'number_of_processors',
  'os',
  'pathext',
  'processor_architecture',
  'programdata',
  'programfiles',
  'programfiles(x86)',
  'public',
  'systemdrive',
  'systemroot',
  'windir',
]);

// Interpreters spawned during `invoke local` tests inherit the overridden env; without core
// system variables (SystemRoot in particular) their startup behavior is undefined. Match
// actual key names case-insensitively, as Windows env var name casing is not canonical.
const resolveWin32SystemVarNames = () =>
  process.platform === 'win32'
    ? Object.keys(process.env).filter((name) => WIN32_SYSTEM_VAR_NAMES.has(name.toLowerCase()))
    : [];

module.exports = (options = {}) => {
  if (!options) options = {};
  return createEnv({
    whitelist: [
      'APPDATA',
      'HOME',
      'LOCAL_SERVERLESS_LINK_PATH',
      'LOG_LEVEL',
      'PATH',
      'SERVERLESS_BINARY_PATH',
      'SLS_SCHEMA_CACHE_BASE_DIR',
      'TEMP',
      'TMP',
      'TMPDIR',
      'USERPROFILE',
    ]
      .concat(resolveWin32SystemVarNames())
      .concat(options.whitelist || []),
    variables: Object.assign(
      { SLS_TRACKING_DISABLED: '1', SLS_DEPRECATION_NOTIFICATION_MODE: 'error' },
      options.variables || {}
    ),
  });
};
