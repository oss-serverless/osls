'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const ServerlessError = require('../../../../../../lib/serverless-error');
const {
  parseTimeInput,
  subtractTime,
  formatLogTimestamp,
  formatDisplayTime,
} = require('../../../../../../lib/plugins/aws/utils/time');

describe('aws/utils/time', () => {
  describe('#parseTimeInput()', () => {
    describe('relative values', () => {
      let clock;
      const fakeTime = Date.UTC(2016, 9, 15, 12);

      beforeEach(() => {
        clock = sinon.useFakeTimers(fakeTime);
      });

      afterEach(() => {
        clock.restore();
      });

      it('should resolve seconds against the current time', () => {
        expect(parseTimeInput('90s', '--startTime')).to.equal(fakeTime - 90 * 1000);
      });

      it('should resolve minutes against the current time', () => {
        expect(parseTimeInput('30m', '--startTime')).to.equal(fakeTime - 30 * 60 * 1000);
      });

      it('should resolve hours against the current time', () => {
        expect(parseTimeInput('2h', '--startTime')).to.equal(fakeTime - 2 * 60 * 60 * 1000);
      });

      it('should resolve days against the current time', () => {
        expect(parseTimeInput('3d', '--startTime')).to.equal(fakeTime - 3 * 24 * 60 * 60 * 1000);
      });
    });

    it('should parse extended dates and datetimes as UTC', () => {
      expect(parseTimeInput('2010-10-20', '--startTime')).to.equal(Date.UTC(2010, 9, 20));
      expect(parseTimeInput('2013-02-08T09', '--startTime')).to.equal(Date.UTC(2013, 1, 8, 9));
      expect(parseTimeInput('2013-02-08 09:30', '--startTime')).to.equal(
        Date.UTC(2013, 1, 8, 9, 30)
      );
      expect(parseTimeInput('2013-02-08T09:30:26.123', '--startTime')).to.equal(
        Date.UTC(2013, 1, 8, 9, 30, 26, 123)
      );
    });

    it('should parse basic dates and datetimes as UTC', () => {
      expect(parseTimeInput('20130208', '--startTime')).to.equal(Date.UTC(2013, 1, 8));
      expect(parseTimeInput('20130208T08', '--startTime')).to.equal(Date.UTC(2013, 1, 8, 8));
      expect(parseTimeInput('20130208T0809', '--startTime')).to.equal(Date.UTC(2013, 1, 8, 8, 9));
      expect(parseTimeInput('20130208T080910', '--startTime')).to.equal(
        Date.UTC(2013, 1, 8, 8, 9, 10)
      );
      expect(parseTimeInput('20130208T080910.123', '--startTime')).to.equal(
        Date.UTC(2013, 1, 8, 8, 9, 10, 123)
      );
    });

    it('should support a comma as the fraction separator', () => {
      expect(parseTimeInput('20130208T080910,123', '--startTime')).to.equal(
        Date.UTC(2013, 1, 8, 8, 9, 10, 123)
      );
    });

    it('should pad fractional seconds', () => {
      expect(parseTimeInput('2013-02-08T09:30:26.5', '--startTime')).to.equal(
        Date.UTC(2013, 1, 8, 9, 30, 26, 500)
      );
    });

    it('should respect an explicit UTC offset', () => {
      expect(parseTimeInput('2013-02-08T09:30:26Z', '--startTime')).to.equal(
        Date.UTC(2013, 1, 8, 9, 30, 26)
      );
      expect(parseTimeInput('2013-02-08T09:30:26+07:00', '--startTime')).to.equal(
        Date.UTC(2013, 1, 8, 2, 30, 26)
      );
    });

    it('should parse a year as January 1st UTC', () => {
      expect(parseTimeInput('2013', '--startTime')).to.equal(Date.UTC(2013, 0, 1));
    });

    it('should parse a year and month via native fallback', () => {
      expect(parseTimeInput('2013-02', '--startTime')).to.equal(Date.UTC(2013, 1, 1));
    });

    it('should accept single-digit months and days', () => {
      expect(parseTimeInput('2013-2-8', '--startTime')).to.equal(Date.UTC(2013, 1, 8));
    });

    it('should accept a lowercase time separator', () => {
      expect(parseTimeInput('2013-02-08t09:30', '--startTime')).to.equal(
        Date.UTC(2013, 1, 8, 9, 30)
      );
    });

    it('should trim surrounding whitespace', () => {
      expect(parseTimeInput(' 2010-10-20 ', '--startTime')).to.equal(Date.UTC(2010, 9, 20));
    });

    it('should parse epoch seconds', () => {
      expect(parseTimeInput('1469694264', '--startTime')).to.equal(1469694264000);
    });

    it('should parse 9-digit epoch seconds', () => {
      expect(parseTimeInput('999999999', '--startTime')).to.equal(999999999000);
    });

    it('should parse epoch milliseconds', () => {
      expect(parseTimeInput('1469694264000', '--startTime')).to.equal(1469694264000);
    });

    it('should treat values at the 10^12 boundary as milliseconds', () => {
      expect(parseTimeInput('999999999999', '--startTime')).to.equal(999999999999000);
      expect(parseTimeInput('1000000000000', '--startTime')).to.equal(1000000000000);
    });

    it('should pass through numbers as epoch milliseconds', () => {
      expect(parseTimeInput(1469694264000, '--startTime')).to.equal(1469694264000);
    });

    it('should throw on unsupported values', () => {
      for (const value of [
        '1h30m', // mixed units
        '2013-W06-5', // ISO week date
        '2013-039', // ISO ordinal date
        '2013050', // basic ordinal date
        '12345', // digits-only but neither a date nor an epoch
        '9999999999999999', // epoch beyond the JavaScript Date range
        '-3600', // negative epoch
        '2013-13-01', // out-of-range month
        '2013-02-08T25:00', // out-of-range hour
        '2013-02-08T09:60', // out-of-range minute
        'invalid',
        '',
      ]) {
        expect(() => parseTimeInput(value, '--startTime'), value)
          .to.throw(ServerlessError, '--startTime')
          .with.property('code', 'INVALID_TIME_INPUT');
      }
    });

    it('should name the failing option in the error message', () => {
      expect(() => parseTimeInput('invalid', '--endTime')).to.throw(ServerlessError, '--endTime');
    });
  });

  describe('#subtractTime()', () => {
    it('should subtract fixed durations for seconds, minutes and hours', () => {
      const date = new Date(1469694264000);
      expect(subtractTime(date, 30, 's').getTime()).to.equal(1469694264000 - 30 * 1000);
      expect(subtractTime(date, 10, 'm').getTime()).to.equal(1469694264000 - 10 * 60 * 1000);
      expect(subtractTime(date, 2, 'h').getTime()).to.equal(1469694264000 - 2 * 60 * 60 * 1000);
    });

    it('should subtract calendar days keeping the local clock time', () => {
      const date = new Date(2016, 9, 15, 12, 30);
      expect(subtractTime(date, 3, 'd').getTime()).to.equal(
        new Date(2016, 9, 12, 12, 30).getTime()
      );
    });
  });

  describe('#formatLogTimestamp()', () => {
    it('should format local time with millisecond precision', () => {
      expect(formatLogTimestamp(new Date(2016, 0, 5, 13, 7, 8, 9))).to.equal(
        '2016-01-05 13:07:08.009'
      );
    });
  });

  describe('#formatDisplayTime()', () => {
    it('should format local time in long form', () => {
      expect(formatDisplayTime(new Date(2016, 0, 5, 13, 7))).to.equal('January 5, 2016 1:07 PM');
    });

    it('should format midnight and noon as 12 AM and 12 PM', () => {
      expect(formatDisplayTime(new Date(2016, 11, 31, 0, 0))).to.equal(
        'December 31, 2016 12:00 AM'
      );
      expect(formatDisplayTime(new Date(2016, 5, 1, 12, 0))).to.equal('June 1, 2016 12:00 PM');
    });
  });
});
