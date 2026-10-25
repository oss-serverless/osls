export default Object.freeze({
  upstream: Object.freeze({
    packageName: '@serverless/utils',
    version: '6.15.0',
  }),

  vendoredPaths: Object.freeze([
    'cloudformation-schema.ts',
    'config.ts',
    'download.ts',
    'inquirer/confirm.ts',
    'inquirer/index.ts',
    'lib/log/get-output-reporter.ts',
    'lib/log/get-progress-reporter.ts',
    'lib/log/join-text-tokens.ts',
    'lib/log-reporters/node/log-reporter.ts',
    'lib/log-reporters/node/progress-reporter.ts',
    'lib/log-reporters/node/style.ts',
    'log-reporters/node.ts',
    'log.ts',
  ]),

  maintainerPaths: Object.freeze(['README.md', 'lib/global-state.ts', 'policy.ts']),

  excludedFamilies: Object.freeze([
    'account.ts',
    'analytics-and-notfications-url.ts',
    'api-request.ts',
    'auth/**',
    'console-ui.ts',
    'get-notifications-mode.ts',
    'inquirer/prompt-with-history.ts',
    'is-in-china.ts',
    'lib/auth/**',
    'process-backend-notification-request.ts',
    'serverless-error.ts',
    'telemetry.ts',
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
