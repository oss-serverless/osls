'use strict';

const { expect } = require('chai');
const {
  parsePluginInstallSpec,
  parsePluginUninstallSpec,
} = require('../../../../lib/commands/plugin-management');

describe('test/unit/lib/commands/plugin-management.test.js', () => {
  const maxLengthName = 'a'.repeat(214);
  const overLengthName = 'a'.repeat(215);
  const scopedMaxLengthName = `@${'a'.repeat(100)}/${'b'.repeat(112)}`;
  const scopedOverLengthName = `@${'a'.repeat(100)}/${'b'.repeat(113)}`;

  describe('#parsePluginInstallSpec()', () => {
    for (const [input, expected] of [
      ['serverless-webpack', { name: 'serverless-webpack', version: 'latest' }],
      ['serverless-webpack@3.0.0-rc.2', { name: 'serverless-webpack', version: '3.0.0-rc.2' }],
      ['serverless-webpack@^1.0.0 || 2', { name: 'serverless-webpack', version: '^1.0.0 || 2' }],
      ['@scope/serverless-plugin@next', { name: '@scope/serverless-plugin', version: 'next' }],
      ['serverless-plugin-foo', { name: 'serverless-plugin-foo', version: 'latest' }],
      ['@scope/serverless-plugin', { name: '@scope/serverless-plugin', version: 'latest' }],
      ['serverless-plugin@latest', { name: 'serverless-plugin', version: 'latest' }],
      ['serverless-plugin@1.2.3', { name: 'serverless-plugin', version: '1.2.3' }],
      ['@scope/serverless-plugin@1.2.3', { name: '@scope/serverless-plugin', version: '1.2.3' }],
      [maxLengthName, { name: maxLengthName, version: 'latest' }],
      [`${maxLengthName}@latest`, { name: maxLengthName, version: 'latest' }],
      [scopedMaxLengthName, { name: scopedMaxLengthName, version: 'latest' }],
      [`${scopedMaxLengthName}@1.2.3`, { name: scopedMaxLengthName, version: '1.2.3' }],
    ]) {
      it(`parses valid plugin spec "${input}"`, () => {
        expect(parsePluginInstallSpec(input)).to.include(expected);
        expect(parsePluginInstallSpec(input).installSpec).to.equal(
          `${expected.name}@${expected.version}`
        );
      });
    }

    for (const input of [
      '',
      '@',
      '@scope',
      '@scope/',
      '--prefix=/tmp/x',
      '-plugin',
      '.plugin',
      '_plugin',
      'serverless plugin',
      'serverless;id',
      'plugin;id',
      'serverless|id',
      'serverless`id`',
      'serverless$(id)',
      'serverless\nplugin',
      '"serverless-plugin@^1.60.0 || 2"',
      '/tmp/plugin',
      '../plugin',
      overLengthName,
      `${overLengthName}@latest`,
      scopedOverLengthName,
      `${scopedOverLengthName}@1.2.3`,
    ]) {
      it(`rejects invalid plugin spec ${JSON.stringify(input)}`, () => {
        expect(() => parsePluginInstallSpec(input))
          .to.throw()
          .with.property('code', 'INVALID_PLUGIN_NAME');
      });
    }

    for (const input of [
      'serverless-webpack@"^1.60.0 || 2"',
      "serverless-webpack@'^1.60.0 || 2'",
      'serverless-webpack@file:../plugin',
      'serverless-webpack@git+ssh://example/repo',
      'serverless-webpack@https://example.com/plugin.tgz',
      'serverless-webpack@npm:other',
      'serverless-webpack@workspace:*',
      'serverless-webpack@1.2.3\n--prefix=/tmp/x',
      'serverless-webpack@1.2.3;id',
      'serverless-webpack@',
    ]) {
      it(`rejects invalid plugin version in ${JSON.stringify(input)}`, () => {
        expect(() => parsePluginInstallSpec(input))
          .to.throw()
          .with.property('code', 'INVALID_PLUGIN_VERSION');
      });
    }
  });

  describe('#parsePluginUninstallSpec()', () => {
    for (const input of ['serverless-webpack', '@scope/serverless-plugin', maxLengthName]) {
      it(`parses valid plugin name "${input}"`, () => {
        expect(parsePluginUninstallSpec(input)).to.deep.equal({ name: input });
      });
    }

    it('rejects versioned package specs', () => {
      expect(() => parsePluginUninstallSpec('serverless-webpack@1.2.3'))
        .to.throw()
        .with.property('code', 'INVALID_PLUGIN_UNINSTALL_SPEC');
    });

    for (const input of ['', '--prefix=/tmp/x', 'serverless plugin', overLengthName]) {
      it(`rejects invalid plugin name ${JSON.stringify(input)}`, () => {
        expect(() => parsePluginUninstallSpec(input))
          .to.throw()
          .with.property('code', 'INVALID_PLUGIN_NAME');
      });
    }
  });
});
