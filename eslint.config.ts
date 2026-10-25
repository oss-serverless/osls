import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { flatConfigs as importXFlatConfigs } from 'eslint-plugin-import-x';
import n from 'eslint-plugin-n';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';

const devDependencyFiles = [
  '**/*.test.ts',
  '**/scripts/**',
  '**/test/**',
  '**/tests/**',
  'eslint.config.ts',
  'prettier.config.ts',
];

export default defineConfig([
  {
    name: 'osls/linter-options',
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
  },
  globalIgnores(['**/.*', '!.github/', '!.github/**', 'dist/']),
  js.configs.recommended,
  n.configs['flat/recommended-module'],
  importXFlatConfigs.recommended,
  {
    name: 'osls/sources',
    files: ['**/*.{cjs,js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module',
      globals: {
        ...globals.node,
        fetch: 'readonly',
      },
    },
    rules: {
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: devDependencyFiles,
        },
      ],
      'import-x/no-unresolved': ['error', { commonjs: true }],
      'no-unused-vars': [
        'error',
        {
          caughtErrors: 'all',
        },
      ],
      'n/no-extraneous-import': 'off',
      'n/no-unsupported-features/node-builtins': ['error', { allowExperimental: true }],
      'n/no-extraneous-require': 'off',
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off',
      'n/no-unpublished-require': 'off',
      'n/no-missing-require': 'off',
      'n/no-process-exit': 'off',
      'n/no-deprecated-api': 'off',
      'n/hashbang': 'off',
      'n/no-unpublished-bin': 'off',
    },
  },
  {
    name: 'osls/typescript',
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          caughtErrors: 'all',
          // Leading underscore marks deliberately unused bindings (eg. rest destructuring)
          varsIgnorePattern: '^_',
        },
      ],
      // Destructuring keeps `let` when some of its bindings are reassigned
      'prefer-const': ['error', { destructuring: 'all' }],
      // The code base was converted from JavaScript; types are tightened module by module
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
  {
    // Declarations reference the compiled layout of the published package (`lib/*.js`)
    name: 'osls/declarations',
    files: ['types/**/*.d.ts'],
    rules: {
      'import-x/no-unresolved': 'off',
    },
  },
  {
    name: 'osls/commonjs-fixtures',
    files: [
      '**/*.cjs',
      'test/fixtures/**/*.js',
      'test/**/fixture/**/*.js',
      'test/**/fixtures/**/*.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  {
    name: 'osls/tests',
    files: ['**/*.test.ts', '**/test/**'],
    languageOptions: {
      globals: globals.mocha,
    },
    rules: {
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    name: 'osls/lambda-fixtures',
    files: ['test/fixtures/**'],
    languageOptions: {
      globals: {
        awslambda: 'readonly',
      },
    },
  },
  {
    name: 'osls/esm-fixtures',
    files: [
      'test/fixtures/programmatic/plugin/local-esm-plugin/**',
      'test/fixtures/programmatic/plugin/node_modules/esm-plugin/**',
      'test/fixtures/programmatic/invocation/esm/**',
    ],
    languageOptions: {
      sourceType: 'module',
    },
  },
  eslintConfigPrettier,
]);
