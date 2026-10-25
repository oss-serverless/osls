'use strict';

const expect = require('chai').expect;
const Metrics = require('../../../../lib/plugins/metrics');

describe('Metrics', () => {
  let metrics;
  let serverless;

  beforeEach(() => {
    serverless = {};
    const options = {};
    metrics = new Metrics(serverless, options);
  });

  describe('#constructor()', () => {
    it('should have the command "metrics"', () => {
      expect(metrics.commands.metrics).to.not.be.undefined;
    });

    it('should have a lifecycle event "metrics"', () => {
      expect(metrics.commands.metrics.lifecycleEvents).to.deep.equal(['metrics']);
    });
  });
});
