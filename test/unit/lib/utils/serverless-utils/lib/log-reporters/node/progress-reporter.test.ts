'use strict';

const chai = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const expect = chai.expect;

describe('test/unit/lib/utils/serverless-utils/lib/log-reporters/node/progress-reporter.test.js', () => {
  afterEach(() => {
    sinon.restore();
  });

  const loadProgressReporter = () => {
    const handlers = new Map();
    const cliProgressFooter = {
      shouldAddProgressAnimationPrefix: false,
      progressAnimationPrefixFrames: ['.', 'o'],
      updateProgress: sinon.stub(),
    };
    const progress = {};
    const log = { info: sinon.stub() };
    const joinTextTokens = sinon.stub().returns('deploying\n');
    const style = {
      aside: sinon.stub().callsFake((value) => value),
      noticeSymbol: sinon.stub().callsFake((value) => value),
    };

    const load = proxyquire
      .noCallThru()
      .load(
        '../../../../../../../../lib/utils/serverless-utils/lib/log-reporters/node/progress-reporter',
        {
          '../../../../progress-footer': sinon.stub().returns(cliProgressFooter),
          '../../log/get-progress-reporter': {
            emitter: {
              on: sinon.stub().callsFake((eventName, handler) => {
                handlers.set(eventName, handler);
              }),
            },
          },
          '../../../log': { progress, log },
          '../../log/join-text-tokens': joinTextTokens,
          './style': style,
        }
      );

    return { load, handlers, cliProgressFooter, progress, log, joinTextTokens, style };
  };

  it('logs main events once and clears the progress footer', () => {
    const { load, handlers, cliProgressFooter, progress, log, joinTextTokens, style } =
      loadProgressReporter();
    const setIntervalStub = sinon.stub(global, 'setInterval').returns(123);
    const clearIntervalStub = sinon.stub(global, 'clearInterval');
    sinon.stub(Date, 'now').returns(1000);

    load({ logLevelIndex: 2 });
    handlers.get('update')({
      namespace: 'serverless',
      name: 'main',
      levelIndex: 2,
      textTokens: ['deploying'],
      options: { isMainEvent: true },
    });
    handlers.get('update')({
      namespace: 'serverless',
      name: 'main',
      levelIndex: 2,
      textTokens: ['deploying'],
      options: { isMainEvent: true },
    });
    progress.clear();

    expect(joinTextTokens).to.have.been.calledTwice;
    expect(joinTextTokens.firstCall).to.have.been.calledWithExactly([['deploying']]);
    expect(log.info).to.have.been.calledOnceWithExactly('deploying');
    expect(setIntervalStub).to.have.been.calledOnce;
    expect(style.aside).to.have.been.calledWithExactly('(0s)');
    expect(cliProgressFooter.updateProgress.firstCall).to.have.been.calledWithExactly([
      'deploying (0s)',
    ]);
    expect(clearIntervalStub).to.have.been.calledOnceWithExactly(123);
    expect(cliProgressFooter.updateProgress.lastCall).to.have.been.calledWithExactly();
  });

  it('tracks and removes sub-progress items', () => {
    const { load, handlers, cliProgressFooter, joinTextTokens } = loadProgressReporter();

    load({ logLevelIndex: 2 });
    handlers.get('update')({
      namespace: 'serverless:plugin:aws',
      name: 'deploy',
      levelIndex: 2,
      textTokens: ['deploying'],
      options: null,
    });
    handlers.get('remove')({ namespace: 'serverless:plugin:aws', name: 'deploy' });

    expect(joinTextTokens).to.have.been.calledOnceWithExactly([['deploying']]);
    expect(cliProgressFooter.updateProgress.firstCall).to.have.been.calledWithExactly([
      'deploying',
    ]);
    expect(cliProgressFooter.updateProgress.secondCall).to.have.been.calledWithExactly([]);
  });
});
