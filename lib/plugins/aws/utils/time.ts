'use strict';

const ServerlessError = require('../../../serverless-error');

const UNIT_IN_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};

const RELATIVE_TIME_PATTERN = /^(\d+)(s|m|h|d)$/;

// ISO 8601 date or datetime without a UTC offset designator, in extended
// (2013-02-08T09:30:26.123) or basic (20130208T093026.123) form. Values with
// an explicit offset (e.g. a trailing "Z" or "+07:00") fall through to native
// `Date.parse`.
const EXTENDED_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[Tt ](\d{1,2})(?::(\d{1,2})(?::(\d{1,2})(?:[.,](\d+))?)?)?)?$/;
const BASIC_DATE_TIME_PATTERN =
  /^(\d{4})(\d{2})(\d{2})[Tt](\d{2})(?:(\d{2})(?:(\d{2})(?:[.,](\d+))?)?)?$/;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (number, width = 2) => String(number).padStart(width, '0');

const utcMsFromParts = (year, month, day, hour, minute, second, fraction) => {
  const [numericYear, numericMonth, numericDay, numericHour, numericMinute, numericSecond] = [
    year,
    month,
    day,
    hour || 0,
    minute || 0,
    second || 0,
  ].map(Number);
  if (
    numericMonth < 1 ||
    numericMonth > 12 ||
    numericDay < 1 ||
    numericDay > 31 ||
    numericHour > 23 ||
    numericMinute > 59 ||
    numericSecond > 59
  ) {
    return NaN;
  }
  const milliseconds = fraction == null ? 0 : Number(fraction.slice(0, 3).padEnd(3, '0'));
  return Date.UTC(
    numericYear,
    numericMonth - 1,
    numericDay,
    numericHour,
    numericMinute,
    numericSecond,
    milliseconds
  );
};

const parseUtcMs = (input) => {
  if (/^\d+$/.test(input)) {
    if (input.length === 4) return Date.UTC(Number(input), 0, 1);
    if (input.length === 8)
      return utcMsFromParts(input.slice(0, 4), input.slice(4, 6), input.slice(6, 8));
    if (input.length >= 9) {
      const epoch = Number(input);
      // Values below 10^12 are epoch seconds (covers dates up to the year
      // 33658), larger values are epoch milliseconds
      return epoch < 1e12 ? epoch * 1000 : epoch;
    }
    return NaN;
  }
  const match = input.match(EXTENDED_DATE_TIME_PATTERN) || input.match(BASIC_DATE_TIME_PATTERN);
  if (match) return utcMsFromParts(...match.slice(1, 8));
  // A signed integer is a mistyped epoch or relative value, but native
  // parsing would accept it as a year (V8 parses "-3600" as the year 3600)
  if (/^[+-]\d+$/.test(input)) return NaN;
  return Date.parse(input);
};

// Subtracting days is calendar-aware (the result keeps the local clock time
// across DST changes); other units are fixed durations
const subtractTime = (date, amount, unit) => {
  if (unit === 'd') {
    const result = new Date(date);
    result.setDate(result.getDate() - amount);
    return result;
  }
  return new Date(date.getTime() - amount * UNIT_IN_MS[unit]);
};

// Parses a user-provided time option into epoch milliseconds. Relative values
// (e.g. "30m") are resolved against the current time, dates and datetimes
// without an explicit UTC offset are interpreted as UTC, and digits-only
// values of 9+ characters are treated as Unix epoch time. Numbers pass
// through unchanged (they are already epoch milliseconds).
const parseTimeInput = (value, optionName) => {
  if (typeof value === 'number') return value;

  const input = String(value).trim();
  const relativeMatch = input.match(RELATIVE_TIME_PATTERN);
  if (relativeMatch) {
    return subtractTime(new Date(), Number(relativeMatch[1]), relativeMatch[2]).getTime();
  }

  const utcMs = parseUtcMs(input);
  // 8.64e15 is the JavaScript Date range limit; larger values would
  // construct Invalid Dates downstream
  if (!Number.isNaN(utcMs) && Math.abs(utcMs) <= 8.64e15) return utcMs;

  throw new ServerlessError(
    `Invalid "${optionName}" value: "${value}". Supported formats: ` +
      'relative time ("30s", "30m", "2h" or "3d"), ' +
      'ISO 8601 date or datetime interpreted as UTC unless an offset is given ' +
      '("2013-02-08", "2013-02-08T09:30:26.123" or "2013-02-08T09:30:26+07:00"), ' +
      'or Unix epoch time in seconds or milliseconds ("1469694264")',
    'INVALID_TIME_INPUT'
  );
};

// Local time in "YYYY-MM-DD HH:mm:ss.SSS" format
const formatLogTimestamp = (value) => {
  const date = new Date(value);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}`
  );
};

// Local time in "January 1, 1970 1:00 AM" format
const formatDisplayTime = (value) => {
  const date = new Date(value);
  const hours = date.getHours();
  const hour = hours % 12 || 12;
  const meridiem = hours < 12 ? 'AM' : 'PM';
  return (
    `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ` +
    `${hour}:${pad(date.getMinutes())} ${meridiem}`
  );
};

module.exports = { parseTimeInput, subtractTime, formatLogTimestamp, formatDisplayTime };
