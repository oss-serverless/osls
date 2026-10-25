import createProgressFooter from '../../../../progress-footer.ts';
import { emitter } from '../../log/get-progress-reporter.ts';
import { progress, log } from '../../../log.ts';
import joinTextTokens from '../../log/join-text-tokens.ts';
import style from './style.ts';

export default ({ logLevelIndex }) => {
  const cliProgressFooter = createProgressFooter();
  cliProgressFooter.shouldAddProgressAnimationPrefix = true;
  cliProgressFooter.progressAnimationPrefixFrames =
    cliProgressFooter.progressAnimationPrefixFrames.map((frame) => style.noticeSymbol(frame));

  let mainProgressTextContent;
  let mainProgressIntervalId;
  let mainProgressStartTime;
  let lastMainEventText;

  let isClosed = false;
  progress.clear = () => {
    isClosed = true;
    clearInterval(mainProgressIntervalId);
    cliProgressFooter.updateProgress();
  };

  const ongoingSubProgress = new Map();
  const repaint = () => {
    if (isClosed) {
      return;
    }
    const progressItems = [];
    if (mainProgressStartTime) {
      progressItems.push(
        `${mainProgressTextContent} ${style.aside(
          `(${Math.floor((Date.now() - mainProgressStartTime) / 1000)}s)`
        )}`
      );
    }
    progressItems.push(...ongoingSubProgress.values());
    cliProgressFooter.updateProgress(progressItems);
  };

  emitter.on('update', ({ namespace, name, levelIndex, textTokens, options }) => {
    if (levelIndex > logLevelIndex) {
      return;
    }
    const textContent = joinTextTokens([textTokens]).slice(0, -1);
    if (namespace === 'serverless' && name === 'main') {
      if (options && options.isMainEvent && lastMainEventText !== textContent) {
        lastMainEventText = textContent;
        log.info(textContent);
      }
      mainProgressTextContent = textContent;
      if (!mainProgressStartTime) {
        mainProgressStartTime = Date.now();
        mainProgressIntervalId = setInterval(repaint, 200);
      }
    } else {
      ongoingSubProgress.set(`${namespace}:${name}`, textContent);
    }
    repaint();
  });
  emitter.on('remove', ({ namespace, name }) => {
    ongoingSubProgress.delete(`${namespace}:${name}`);
    repaint();
  });
};
