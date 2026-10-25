'use strict';

const maxIterations = 1000;
const waitForMacrotask = () => new Promise((resolve) => setImmediate(resolve));

module.exports = async (pendingResolvers, promise) => {
  let isSettled = false;
  promise
    .finally(() => {
      isSettled = true;
    })
    .catch(() => {});
  for (let iteration = 0; !isSettled; iteration += 1) {
    if (iteration >= maxIterations) {
      throw new Error('Timed out waiting for pending requests to settle');
    }
    await waitForMacrotask();
    for (const resolve of pendingResolvers.splice(0)) resolve();
  }
  return promise;
};
