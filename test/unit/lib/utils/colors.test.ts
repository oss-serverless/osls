'use strict';

const expect = require('chai').expect;

const { createColors, getColorLevel } = require('../../../../lib/utils/colors');

describe('test/unit/lib/utils/colors.test.js', () => {
  it('reports no colors for non-tty streams by default', () => {
    expect(getColorLevel({ stream: { isTTY: false }, env: {} })).to.equal(0);
  });

  it('lets FORCE_COLOR override NO_COLOR', () => {
    expect(
      getColorLevel({
        stream: { isTTY: false },
        env: { FORCE_COLOR: '1', NO_COLOR: '1' },
      })
    ).to.equal(1);
  });

  it('does not enable truecolor on non-tty streams', () => {
    expect(
      getColorLevel({
        stream: { isTTY: false },
        env: { COLORTERM: 'truecolor' },
      })
    ).to.equal(0);
  });

  it('treats COLORTERM=truecolor case-insensitively', () => {
    expect(
      getColorLevel({
        stream: { isTTY: true, getColorDepth: () => 1 },
        env: { COLORTERM: 'TRUECOLOR' },
      })
    ).to.equal(3);
  });

  it('treats COLORTERM=24bit as truecolor', () => {
    expect(
      getColorLevel({
        stream: { isTTY: true, getColorDepth: () => 1 },
        env: { COLORTERM: '24BIT' },
      })
    ).to.equal(3);
  });

  it('passes env through to getColorDepth', () => {
    let receivedEnv;
    const env = { TERM_PROGRAM: 'iTerm.app' };

    expect(
      getColorLevel({
        stream: {
          isTTY: true,
          getColorDepth: (value) => {
            receivedEnv = value;
            return 8;
          },
        },
        env,
      })
    ).to.equal(2);

    expect(receivedEnv).to.equal(env);
  });

  it('treats color depth 1 as no color', () => {
    expect(
      getColorLevel({
        stream: { isTTY: true, getColorDepth: () => 1 },
        env: {},
      })
    ).to.equal(0);
  });

  it('respects FORCE_COLOR=0 explicitly', () => {
    expect(
      getColorLevel({
        stream: { isTTY: true, getColorDepth: () => 24 },
        env: { FORCE_COLOR: '0' },
      })
    ).to.equal(0);
  });

  it('reports truecolor when the stream advertises 24-bit support', () => {
    expect(getColorLevel({ stream: { isTTY: true, getColorDepth: () => 24 }, env: {} })).to.equal(
      3
    );
  });

  it('falls back to plain text when colors are disabled', () => {
    const colors = createColors({ stream: { isTTY: false }, env: {} });

    expect(colors.brandRed('hello')).to.equal('hello');
    expect(colors.warning('hello')).to.equal('hello');
    expect(colors.colorize('hello', 'green')).to.equal('hello');
  });

  it('renders truecolor escape sequences when available', () => {
    const colors = createColors({
      stream: { isTTY: true, getColorDepth: () => 24 },
      env: {},
    });

    expect(colors.brandRed('x')).to.equal('\u001B[38;2;253;87;80mx\u001B[0m');
  });

  it('returns a reset formatter when colors are enabled', () => {
    const colors = createColors({
      stream: { isTTY: true, getColorDepth: () => 4 },
      env: {},
    });

    expect(colors.reset('x')).to.equal('\u001B[0mx\u001B[0m');
  });

  it('prefers exact CSS keyword colors through colorize()', () => {
    const colors = createColors({
      stream: { isTTY: true, getColorDepth: () => 24 },
      env: {},
    });

    expect(colors.colorize('x', 'green')).to.equal('\u001B[38;2;0;128;0mx\u001B[0m');
    expect(colors.colorize('x', 'gray')).to.equal('\u001B[38;2;128;128;128mx\u001B[0m');
    expect(colors.colorize('x', 'purple')).to.equal('\u001B[38;2;128;0;128mx\u001B[0m');
    expect(colors.colorize('x', 'pink')).to.equal('\u001B[38;2;255;192;203mx\u001B[0m');
    expect(colors.colorize('x', 'teal')).to.equal('\u001B[38;2;0;128;128mx\u001B[0m');
  });

  it('supports non-standard bright aliases through colorize()', () => {
    const colors = createColors({
      stream: { isTTY: true, getColorDepth: () => 24 },
      env: {},
    });

    expect(colors.colorize('x', 'blackBright')).to.equal('\u001B[90mx\u001B[0m');
    expect(colors.colorize('x', 'blueBright')).to.equal('\u001B[94mx\u001B[0m');
    expect(colors.colorize('x', 'unknown')).to.equal('x');
  });

  it('supports extended CSS keywords in truecolor mode', () => {
    const colors = createColors({
      stream: { isTTY: true, getColorDepth: () => 24 },
      env: {},
    });

    expect(colors.colorize('x', 'rebeccapurple')).to.equal('\u001B[38;2;102;51;153mx\u001B[0m');
  });

  it('supports extended CSS keywords in 256-color mode', () => {
    const colors = createColors({
      stream: { isTTY: true, getColorDepth: () => 8 },
      env: {},
    });

    expect(colors.colorize('x', 'rebeccapurple')).to.equal('\u001B[38;5;97mx\u001B[0m');
  });

  it('falls back to the nearest basic color for extended CSS keywords', () => {
    const colors = createColors({
      stream: { isTTY: true, getColorDepth: () => 4 },
      env: {},
    });

    expect(colors.colorize('x', 'darkred')).to.equal('\u001B[31mx\u001B[0m');
  });

  it('normalizes extended CSS keyword input', () => {
    const colors = createColors({
      stream: { isTTY: true, getColorDepth: () => 24 },
      env: {},
    });

    expect(colors.colorize('x', 'RebeccaPurple')).to.equal('\u001B[38;2;102;51;153mx\u001B[0m');
    expect(colors.colorize('x', 'light-grey')).to.equal('\u001B[38;2;211;211;211mx\u001B[0m');
  });
});
