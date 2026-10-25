'use strict';

const { stripVTControlCharacters } = require('node:util');

const moveUp = '\x1b[1A';
const clearLine = '\x1b[2K';
const emptyLinesPattern = /^[\n\r\u2028\u2029]{2}$/u;

const defaultFrames =
  process.platform === 'win32'
    ? ['┤', '┘', '┴', '└', '├', '┌', '┬', '┐']
    : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const defaultAnimationIntervalMs = process.platform === 'win32' ? 100 : 80;

const splitRows = (rows) => {
  if (Array.isArray(rows)) return rows.map(String);
  if (!rows) return [];
  return String(rows).split(/[\n\r]/u);
};

const stringifyChunk = (chunk) => {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString();
  return String(chunk);
};

const getVisibleLength = (value) => [...stripVTControlCharacters(value)].length;

const areEmptyLines = (value) => emptyLinesPattern.test(value);

class ProgressFooter {
  constructor(options = {}) {
    if (!options || typeof options !== 'object') options = {};
    const { stdout = process.stdout, stderr = process.stderr } = options;

    this.stdout = stdout;
    this.stderr = stderr;
    this.rawRows = [];
    this.renderedLineCount = 0;
    this.hasLeadingProgressSpacer = false;
    this.hasTerminatedPartialLine = false;
    this.lastOutLineLength = 0;
    this.lastOutCharacters = '';
    this.frameIndex = 0;
    this.animationIntervalId = null;
    this.isActive = false;
    this.originalStdoutWrite = this.stdout.write;
    this.originalStderrWrite = this.stderr.write;
    this._shouldAddProgressAnimationPrefix = false;
    this._progressAnimationPrefixFrames = defaultFrames;
    this.installPassiveObserver();
  }

  get progressAnimationPrefixFrames() {
    return this._progressAnimationPrefixFrames;
  }

  set progressAnimationPrefixFrames(frames) {
    const normalizedFrames = Array.from(frames, String);
    if (normalizedFrames.length < 2) {
      throw new TypeError('Expected at least two animation frames');
    }
    this._progressAnimationPrefixFrames = normalizedFrames;
    this.frameIndex = 0;
    this.repaint();
  }

  get shouldAddProgressAnimationPrefix() {
    return this._shouldAddProgressAnimationPrefix;
  }

  set shouldAddProgressAnimationPrefix(value) {
    this._shouldAddProgressAnimationPrefix = Boolean(value);
    if (this.isActive) {
      if (this._shouldAddProgressAnimationPrefix) {
        this.startAnimation();
      } else {
        this.stopAnimation();
      }
    }
    this.repaint();
  }

  updateProgress(rows) {
    this.rawRows = splitRows(rows);

    if (!this.rawRows.length) {
      this.clearRenderedProgress();
      this.deactivate();
      return;
    }

    this.activate();
    this.repaint();
  }

  startAnimation() {
    if (this.animationIntervalId) return;

    this.animationIntervalId = setInterval(() => {
      if (!this.rawRows.length) return;
      this.frameIndex = (this.frameIndex + 1) % this.progressAnimationPrefixFrames.length;
      this.repaint();
    }, defaultAnimationIntervalMs);

    if (this.animationIntervalId.unref) {
      this.animationIntervalId.unref();
    }
  }

  stopAnimation() {
    clearInterval(this.animationIntervalId);
    this.animationIntervalId = null;
  }

  activate() {
    if (this.isActive) return;

    this.restoreOriginalWrites();

    this.stdout.write = (chunk, encoding, callback) =>
      this.writeAroundProgress(this.writeOriginalStdout.bind(this), chunk, encoding, callback);

    this.stderr.write = (chunk, encoding, callback) =>
      this.writeAroundProgress(this.writeOriginalStdout.bind(this), chunk, encoding, callback);

    this.isActive = true;
    if (this.shouldAddProgressAnimationPrefix) this.startAnimation();
  }

  deactivate() {
    if (!this.isActive) return;

    this.restoreOriginalWrites();
    this.stopAnimation();
    this.isActive = false;
    this.installPassiveObserver();
  }

  installPassiveObserver() {
    this.stdout.write = (chunk, ...args) => {
      const result = this.originalStdoutWrite.call(this.stdout, chunk, ...args);
      this.updateLastOutLineLength(stringifyChunk(chunk));
      return result;
    };

    this.stderr.write = (chunk, ...args) => {
      const result = this.originalStderrWrite.call(this.stderr, chunk, ...args);
      this.updateLastOutLineLength(stringifyChunk(chunk));
      return result;
    };
  }

  restoreOriginalWrites() {
    this.stdout.write = this.originalStdoutWrite;
    this.stderr.write = this.originalStderrWrite;
  }

  writeOriginalStdout(chunk, ...args) {
    return this.originalStdoutWrite.call(this.stdout, chunk, ...args);
  }

  writeAroundProgress(write, chunk, encoding, callback) {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }

    this.clearRenderedProgress();

    let result;
    if (encoding === undefined) {
      result = callback ? write(chunk, callback) : write(chunk);
    } else {
      result = write(chunk, encoding, callback);
    }

    this.updateLastOutLineLength(stringifyChunk(chunk));
    this.writeProgress();
    return result;
  }

  updateLastOutLineLength(content) {
    const strippedContent = stripVTControlCharacters(content);
    const trailingContent = strippedContent.slice(-50);

    if (trailingContent.length === 1) {
      this.lastOutCharacters = `${this.lastOutCharacters.slice(-1)}${trailingContent}`;
    } else if (trailingContent.length > 1) {
      this.lastOutCharacters = trailingContent.slice(-2);
    }

    const lines = strippedContent.split(/[\n\r]/u);
    const lastLine = lines[lines.length - 1];

    if (lines.length === 1) {
      this.lastOutLineLength += [...lastLine].length;
    } else {
      this.lastOutLineLength = [...lastLine].length;
    }
  }

  repaint() {
    if (!this.rawRows.length || !this.isActive) return;
    this.clearRenderedProgress();
    this.writeProgress();
  }

  getRows() {
    if (!this.shouldAddProgressAnimationPrefix) return this.rawRows;

    const prefix = `${this.progressAnimationPrefixFrames[this.frameIndex]} `;
    const padding = ' '.repeat(getVisibleLength(prefix));

    return this.rawRows.map((row) => {
      if (!row) return row;
      return `${prefix}${row.split('\n').join(`\n${padding}`)}`;
    });
  }

  writeProgress() {
    const rows = this.getRows();
    if (!rows.length) return;

    this.hasTerminatedPartialLine = Boolean(this.lastOutLineLength);
    this.hasLeadingProgressSpacer = !areEmptyLines(this.lastOutCharacters);

    if (this.hasTerminatedPartialLine) {
      this.writeOriginalStdout('\n');
    }

    if (this.hasLeadingProgressSpacer) {
      this.writeOriginalStdout('\n');
    }

    for (const row of rows) {
      this.writeOriginalStdout(`${row}\n`);
    }

    this.renderedLineCount = rows.reduce((count, row) => count + this.getLineCount(row), 0);
  }

  clearRenderedProgress() {
    if (!this.renderedLineCount) return;

    const lineCountToClear = this.renderedLineCount + (this.hasLeadingProgressSpacer ? 1 : 0);

    for (let index = 0; index < lineCountToClear; index += 1) {
      this.writeOriginalStdout(`${moveUp}${clearLine}`);
    }

    this.renderedLineCount = 0;
    this.hasLeadingProgressSpacer = false;

    if (this.hasTerminatedPartialLine) {
      const columns = this.stdout.columns || 80;
      const column = this.lastOutLineLength % columns || columns;
      this.writeOriginalStdout(`${moveUp}\x1b[${column}C`);
    }

    this.hasTerminatedPartialLine = false;
  }

  getLineCount(row) {
    const columns = this.stdout.columns || 80;
    return String(row)
      .split(/[\n\r]/u)
      .reduce((count, line) => count + (Math.ceil(getVisibleLength(line) / columns) || 1), 0);
  }
}

module.exports = (options) => new ProgressFooter(options);
