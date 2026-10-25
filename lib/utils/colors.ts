'use strict';

const CSS_KEYWORDS = require('./color-keywords');

const ESC = '\u001B[';
const RESET = `${ESC}0m`;

const toText = (value) => String(value);

const wrap = (open) => (value) => `${open}${toText(value)}${RESET}`;

const normalizeColorName = (colorName) =>
  String(colorName)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const getNormalizedColorTerm = (env) => {
  return typeof env.COLORTERM === 'string' ? env.COLORTERM.toLowerCase() : '';
};

const parseForceColor = (env) => {
  if (!('FORCE_COLOR' in env)) return undefined;
  if (env.FORCE_COLOR === '' || env.FORCE_COLOR === 'true') return 1;
  if (env.FORCE_COLOR === 'false') return 0;

  const parsed = Number.parseInt(env.FORCE_COLOR, 10);
  if (Number.isNaN(parsed)) return 1;
  return Math.max(0, Math.min(parsed, 3));
};

const isColorDisabled = (env) => 'NO_COLOR' in env || 'NODE_DISABLE_COLORS' in env;

const getColorLevel = ({ stream = process.stdout, env = process.env } = {}) => {
  const forced = parseForceColor(env);
  if (forced !== undefined) return forced;

  if (isColorDisabled(env)) return 0;
  if (!stream || !stream.isTTY) return 0;
  if (env.TERM === 'dumb') return 0;

  const colorTerm = getNormalizedColorTerm(env);
  if (colorTerm === 'truecolor' || colorTerm === '24bit') return 3;

  const depth = typeof stream.getColorDepth === 'function' ? stream.getColorDepth(env) : 1;
  if (depth >= 24) return 3;
  if (depth >= 8) return 2;
  if (depth >= 4) return 1;
  return 0;
};

const createFormatter = (level, { basic, ansi256, rgb }) => {
  if (level >= 3 && rgb) {
    return wrap(`${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`);
  }
  if (level >= 2 && ansi256 != null) {
    return wrap(`${ESC}38;5;${ansi256}m`);
  }
  if (level >= 1 && basic != null) {
    return wrap(`${ESC}${basic}m`);
  }
  return toText;
};

const toAnsi256Index = ([red, green, blue]) => {
  if (red === green && green === blue) {
    if (red < 8) return 16;
    if (red > 248) return 231;
    return Math.round(((red - 8) / 247) * 24) + 232;
  }

  return (
    16 +
    36 * Math.round((red / 255) * 5) +
    6 * Math.round((green / 255) * 5) +
    Math.round((blue / 255) * 5)
  );
};

const colorDistance = ([r1, g1, b1], [r2, g2, b2]) =>
  (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;

const createColors = ({ stream = process.stdout, env = process.env } = {}) => {
  const level = getColorLevel({ stream, env });

  const plain = toText;
  const reset = level >= 1 ? wrap(RESET) : plain;
  const bold = level >= 1 ? wrap(`${ESC}1m`) : plain;
  const underline = level >= 1 ? wrap(`${ESC}4m`) : plain;

  const black = createFormatter(level, { basic: 30, ansi256: 0, rgb: [0, 0, 0] });
  const red = createFormatter(level, { basic: 31, ansi256: 196, rgb: [255, 0, 0] });
  const green = createFormatter(level, { basic: 32, ansi256: 40, rgb: [0, 170, 0] });
  const yellow = createFormatter(level, { basic: 33, ansi256: 220, rgb: [255, 255, 0] });
  const blue = createFormatter(level, { basic: 34, ansi256: 33, rgb: [0, 102, 204] });
  const magenta = createFormatter(level, { basic: 35, ansi256: 201, rgb: [204, 0, 204] });
  const cyan = createFormatter(level, { basic: 36, ansi256: 51, rgb: [0, 204, 204] });
  const white = createFormatter(level, { basic: 37, ansi256: 15, rgb: [255, 255, 255] });
  const gray = createFormatter(level, { basic: 90, ansi256: 245, rgb: [140, 141, 145] });
  const brandRed = createFormatter(level, { basic: 91, ansi256: 203, rgb: [253, 87, 80] });
  const warning = createFormatter(level, { basic: 33, ansi256: 214, rgb: [255, 165, 0] });

  const basicPalette = [
    { rgb: [0, 0, 0], formatter: black },
    { rgb: [255, 0, 0], formatter: red },
    { rgb: [0, 170, 0], formatter: green },
    { rgb: [255, 255, 0], formatter: yellow },
    { rgb: [0, 102, 204], formatter: blue },
    { rgb: [204, 0, 204], formatter: magenta },
    { rgb: [0, 204, 204], formatter: cyan },
    { rgb: [255, 255, 255], formatter: white },
    { rgb: [140, 141, 145], formatter: gray },
  ];

  const aliasFormatters = new Map([
    ['blackbright', level >= 1 ? wrap(`${ESC}90m`) : plain],
    ['redbright', level >= 1 ? wrap(`${ESC}91m`) : plain],
    ['greenbright', level >= 1 ? wrap(`${ESC}92m`) : plain],
    ['yellowbright', level >= 1 ? wrap(`${ESC}93m`) : plain],
    ['bluebright', level >= 1 ? wrap(`${ESC}94m`) : plain],
    ['magentabright', level >= 1 ? wrap(`${ESC}95m`) : plain],
    ['cyanbright', level >= 1 ? wrap(`${ESC}96m`) : plain],
    ['whitebright', level >= 1 ? wrap(`${ESC}97m`) : plain],
  ]);

  const keywordFormatters = new Map();

  const resolveKeywordFormatter = (rgb) => {
    if (level >= 3) {
      return wrap(`${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`);
    }
    if (level >= 2) {
      return wrap(`${ESC}38;5;${toAnsi256Index(rgb)}m`);
    }
    if (level >= 1) {
      let closest = basicPalette[0];
      for (const candidate of basicPalette.slice(1)) {
        if (colorDistance(rgb, candidate.rgb) < colorDistance(rgb, closest.rgb)) {
          closest = candidate;
        }
      }
      return closest.formatter;
    }
    return plain;
  };

  return {
    level,
    reset,
    bold,
    underline,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    gray,
    grey: gray,
    brandRed,
    warning,
    colorize(text, colorName) {
      if (!colorName) return plain(text);

      const normalizedColorName = normalizeColorName(colorName);
      let keywordFormatter = keywordFormatters.get(normalizedColorName);
      if (!keywordFormatter) {
        const rgb = CSS_KEYWORDS[normalizedColorName];
        if (rgb) {
          keywordFormatter = resolveKeywordFormatter(rgb);
          keywordFormatters.set(normalizedColorName, keywordFormatter);
        }
      }

      if (keywordFormatter) return keywordFormatter(text);

      const aliasFormatter = aliasFormatters.get(normalizedColorName);
      return aliasFormatter ? aliasFormatter(text) : plain(text);
    },
  };
};

const stdoutColors = createColors({ stream: process.stdout });
const stderrColors = createColors({ stream: process.stderr });

module.exports = {
  ...stdoutColors,
  createColors,
  getColorLevel,
  stdoutColors,
  stderrColors,
};
