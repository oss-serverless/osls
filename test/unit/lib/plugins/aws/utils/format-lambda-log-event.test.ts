'use strict';

const expect = require('chai').expect;
const { style } = require('../../../../../../lib/utils/serverless-utils/log');
const formatLambdaLogEvent = require('../../../../../../lib/plugins/aws/utils/format-lambda-log-event');

// Log timestamps are printed in local time, so expectations are computed from
// the local clock to stay independent of the machine's time zone
const localTimestamp = (value) => {
  const pad = (number, width = 2) => String(number).padStart(width, '0');
  const date = new Date(value);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}`
  );
};

describe('#formatLambdaLogEvent()', () => {
  it('should format invocation report', () => {
    const msg =
      'REPORT RequestId: 99c30000-b01a-11e5-93f7-b8e85631a00e\tDuration: 0.40 ms\tBilled Duration: 100 ms\tMemory Size: 512 MB\tMax Memory Used: 30 MB\tInit Duration: 160.25 ms';
    const expectedMsg = style.aside('END Duration: 0.40 ms (init: 160.25 ms) Memory Used: 30 MB');

    expect(formatLambdaLogEvent(msg)).to.deep.equal(expectedMsg);
  });

  it('should format invocation failures', () => {
    const msg = 'Process exited before completing request';
    expect(formatLambdaLogEvent(msg)).to.deep.equal(style.error(msg));
  });

  it('should format lambda console.log lines', () => {
    const nodeLogLine = '2016-01-01T12:00:00Z\t99c30000-b01a-11e5-93f7-b8e85631a00e\tINFO\ttest';

    let expectedLogMessage = '';
    const date = localTimestamp('2016-01-01T12:00:00Z');
    expectedLogMessage += `${style.aside(date)}\t`;
    expectedLogMessage += 'INFO\t';
    expectedLogMessage += 'test';

    expect(formatLambdaLogEvent(nodeLogLine)).to.equal(expectedLogMessage);
  });

  it('should format lambda python logger lines', () => {
    const pythonLoggerLine =
      '[INFO]\t2016-01-01T12:00:00Z\t99c30000-b01a-11e5-93f7-b8e85631a00e\ttest';

    let expectedLogMessage = '';
    const date = localTimestamp('2016-01-01T12:00:00Z');
    expectedLogMessage += `${style.aside(date)}\t`;
    expectedLogMessage += `${'[INFO]'}\t`;
    expectedLogMessage += 'test';

    expect(formatLambdaLogEvent(pythonLoggerLine)).to.equal(expectedLogMessage);
  });

  it('should keep millisecond precision in timestamps', () => {
    const nodeLogLine =
      '2016-01-01T12:00:00.123Z\t99c30000-b01a-11e5-93f7-b8e85631a00e\tINFO\ttest';

    const date = localTimestamp('2016-01-01T12:00:00.123Z');
    const expectedLogMessage = `${style.aside(date)}\tINFO\ttest`;

    expect(formatLambdaLogEvent(nodeLogLine)).to.equal(expectedLogMessage);
  });

  it('should pass through log lines with no tabs', () => {
    expect(formatLambdaLogEvent('test')).to.equal('test');
  });

  it('should pass through log lines with tabs but no date', () => {
    const tabLine = 'foo\tbar\tbaz';

    expect(formatLambdaLogEvent(tabLine)).to.equal(tabLine);
  });
});
