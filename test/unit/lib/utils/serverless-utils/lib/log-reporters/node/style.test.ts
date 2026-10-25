import { expect } from 'chai';
import esmock from 'esmock';

describe('test/unit/lib/utils/serverless-utils/lib/log-reporters/node/style.test.ts', () => {
  it('uses stderr colors for shared style decorators', async () => {
    const styleState = {
      aside: (value) => value,
      error: (value) => value,
      link: (value) => value,
      linkStrong: (value) => value,
      noticeSymbol: (value) => value,
      strong: (value) => value,
      title: (value) => value,
      warning: (value) => value,
    };
    const logState = {
      notice: (...tokens) => tokens.join(' '),
    };

    (
      await esmock(
        '../../../../../../../../lib/utils/serverless-utils/lib/log-reporters/node/style.ts',
        {
          'ext/function/identity.js': (value) => value,
          '../../../../../../../../lib/utils/colors.ts': {
            stderrColors: {
              gray: (value) => `stderr-gray(${value})`,
              brandRed: (value) => `stderr-red(${value})`,
              underline: (value) => `stderr-underline(${value})`,
              warning: (value) => `stderr-warning(${value})`,
            },
          },
          '../../../../../../../../lib/utils/serverless-utils/log.ts': {
            style: styleState,
            log: logState,
          },
          '../../../../../../../../lib/utils/serverless-utils/lib/log/join-text-tokens.ts': (
            tokens
          ) => `${tokens.join('')}\n`,
        }
      )
    ).default;

    expect(styleState.aside('x')).to.equal('stderr-gray(x)');
    expect(styleState.error('x')).to.equal('stderr-red(x)');
    expect(styleState.title('x')).to.equal('stderr-underline(x)');
    expect(styleState.warning('x')).to.equal('stderr-warning(x)');

    const descriptor = Object.getOwnPropertyDescriptor(logState, 'success');
    expect(descriptor).to.include({ enumerable: false, configurable: true });
    expect(descriptor.get).to.be.a('function');
    expect(descriptor).to.not.have.property('value');
    expect(logState.success('ok')).to.equal('stderr-red(✔) ok');

    const pluginLog = Object.create(logState);
    pluginLog.notice = (...tokens) => `plugin:${tokens.join(' ')}`;
    const success = pluginLog.success;

    expect(success).to.equal(pluginLog.success);
    expect(success('ok')).to.equal('plugin:stderr-red(✔) ok');

    const pluginDescriptor = Object.getOwnPropertyDescriptor(pluginLog, 'success');
    expect(pluginDescriptor).to.include({
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(pluginDescriptor.value).to.equal(success);
  });
});
