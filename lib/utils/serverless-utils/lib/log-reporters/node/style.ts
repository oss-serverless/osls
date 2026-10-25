import identity from 'ext/function/identity.js';
import colors from '../../../../colors.ts';
import { methodDescriptor } from '../../../../property-descriptors.ts';
import { style, log } from '../../../log.ts';
import joinTextTokens from '../../log/join-text-tokens.ts';
const { stderrColors } = colors;

const hasOwnProperty = Object.prototype.hasOwnProperty;

const autoBindDescriptor = (name, fn) =>
  Object.assign(Object.create(null), {
    get() {
      if (hasOwnProperty.call(this, name)) return fn;
      const bound = fn.bind(this);
      Object.defineProperty(this, name, methodDescriptor(bound));
      return bound;
    },
    set: undefined,
    configurable: true,
    enumerable: false,
  });

const cliStyle = {
  aside: stderrColors.gray,
  error: stderrColors.brandRed,
  link: identity,
  linkStrong: stderrColors.underline,
  noticeSymbol: stderrColors.brandRed,
  strong: stderrColors.brandRed,
  title: stderrColors.underline,
  warning: stderrColors.warning,
};

for (const key of Object.keys(style)) {
  const decorator = cliStyle[key];
  if (!decorator) {
    continue;
  }
  style[key] = (text, ...textTokens) =>
    decorator(joinTextTokens([text, ...textTokens]).slice(0, -1));
}

// Notice level message common message decorators
Object.defineProperties(log, {
  success: autoBindDescriptor('success', function (text, ...messageTokens) {
    return this.notice(`${cliStyle.noticeSymbol('✔')} ${text}`, ...messageTokens);
  }),
});

// The shared log style object, with the CLI decorators applied above
export default style;
