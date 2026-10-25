'use strict';

const wait = require('../utils/sleep');
const { log } = require('../utils/serverless-utils/log');
const { isAwsThrottlingError, isTransientNetworkError } = require('./aws-sdk-v3-error');

// Jitter so processes throttled together do not retry in lockstep (4 to 7 s by default, as in v3)
const jitteredDelay = (delayMs) => Math.round(delayMs * (0.8 + Math.random() * 0.6));

const createRetry =
  (isRetryable, { defaultMaxRetries, defaultDelayMs, reason }) =>
  async (
    task,
    { name = 'AWS request', maxRetries = defaultMaxRetries, delayMs = defaultDelayMs } = {}
  ) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await task();
      } catch (error) {
        if (attempt >= maxRetries || !isRetryable(error)) throw error;
        const delay = jitteredDelay(delayMs);
        log.info(
          `Recoverable error occurred (${name} ${reason}), retrying in ${Math.round(delay / 1000)}s`
        );
        await wait(delay);
      }
    }
  };

// On top of the SDK's own per-request retries: sustained throttling outlives the SDK
// retry budget during polling and bulk uploads, and body-phase network failures occur
// after send() resolves, outside the SDK retry middleware entirely.
module.exports = {
  retryOnThrottlingError: createRetry(isAwsThrottlingError, {
    defaultMaxRetries: 4,
    defaultDelayMs: 5000,
    reason: 'was throttled',
  }),
  retryOnTransientNetworkError: createRetry(isTransientNetworkError, {
    defaultMaxRetries: 2,
    defaultDelayMs: 1000,
    reason: 'failed on the network',
  }),
};
