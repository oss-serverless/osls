'use strict';

// CI=false means "not running in CI" (the ci-info convention)
const isCi = () => Boolean(process.env.CI && process.env.CI !== 'false');

// stdin matters for flows that read input (prompts); display-only flows (e.g.
// the SSO device login, which just shows a URL) can opt out of requiring it
module.exports = ({ requireStdin = true } = {}) =>
  Boolean((!requireStdin || process.stdin.isTTY) && process.stdout.isTTY && !isCi());
