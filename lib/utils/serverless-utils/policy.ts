'use strict';

module.exports = Object.freeze({
  upstream: Object.freeze({
    packageName: '@serverless/utils',
    version: '6.15.0',
  }),

  vendoredPaths: Object.freeze([
    'cloudformation-schema.js',
    'config.js',
    'download.js',
    'inquirer/confirm.js',
    'inquirer/index.js',
    'lib/log/get-output-reporter.js',
    'lib/log/get-progress-reporter.js',
    'lib/log/join-text-tokens.js',
    'lib/log-reporters/node/log-reporter.js',
    'lib/log-reporters/node/progress-reporter.js',
    'lib/log-reporters/node/style.js',
    'log-reporters/node.js',
    'log.js',
  ]),

  maintainerPaths: Object.freeze(['README.md', 'lib/global-state.js', 'policy.js']),

  excludedFamilies: Object.freeze([
    'account.js',
    'analytics-and-notfications-url.js',
    'api-request.js',
    'auth/**',
    'console-ui.js',
    'get-notifications-mode.js',
    'inquirer/prompt-with-history.js',
    'is-in-china.js',
    'lib/auth/**',
    'process-backend-notification-request.js',
    'serverless-error.js',
    'telemetry.js',
  ]),

  compatibilityContracts: Object.freeze({
    brefConfigGetPaths: Object.freeze(['frameworkId', 'meta.created_at']),
    aliasedPaths: Object.freeze([
      '@serverless/utils/config',
      '@serverless/utils/config.js',
      '@serverless/utils/log',
      '@serverless/utils/log.js',
    ]),
  }),
});
