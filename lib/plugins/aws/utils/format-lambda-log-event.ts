'use strict';

const { style } = require('../../../utils/serverless-utils/log');
const { formatLogTimestamp } = require('./time');

module.exports = (msgParam) => {
  let msg = msgParam;

  if (!msg.startsWith('REPORT')) msg = msg.trimRight();

  if (msg.startsWith('START')) {
    msg = 'START';
    return style.aside(msg);
  }

  if (msg.startsWith('REPORT')) {
    const parts = msg.split('\t');
    const duration = parts[1];
    const maxMemoryUsed = parts[4].slice(4);
    const initDuration = parts[5] && parts[5].split(':')[1];
    // Simplify the output and trim out unnecessary information
    if (initDuration) {
      msg = `END ${duration} (init:${initDuration}) ${maxMemoryUsed}`;
    } else {
      msg = `END ${duration} ${maxMemoryUsed}`;
    }
    return style.aside(msg);
  }

  if (msg.trim() === 'Process exited before completing request') {
    return style.error(msg);
  }

  const parts = msg.split('\t');

  if (parts.length < 3) {
    return msg;
  }

  let date;
  let reqId;
  let level = '';
  if (!isNaN(new Date(parts[0]).getTime())) {
    date = parts[0];
    reqId = parts[1];
  } else if (!isNaN(new Date(parts[1]).getTime())) {
    date = parts[1];
    reqId = parts[2];
    level = `${parts[0]}\t`;
  } else {
    return msg;
  }
  const text = msg.split(`${reqId}\t`)[1];
  const time = formatLogTimestamp(date);

  return `${style.aside(`${time}\t`)}${level}${text}`;
};
