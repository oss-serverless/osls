'use strict';

const { expect } = require('chai');

const deferIrrelevantStageParams = require('../../../../../lib/configuration/variables/defer-irrelevant-stage-params');

const p = (...keys) => keys.join('\0');

describe('test/unit/lib/configuration/variables/defer-irrelevant-stage-params.test.js', () => {
  const buildPredicate = ({
    params = { dev: {}, prod: {}, default: {} },
    provider,
    options,
  } = {}) => deferIrrelevantStageParams({ params, provider }, { options });

  it('should defer params of not effective stages', () => {
    const isPropertyDeferred = buildPredicate({ options: { stage: 'dev' } });
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.true;
    expect(isPropertyDeferred(p('params', 'prod', 'nested', 'deep'))).to.be.true;
  });

  it('should not defer the stage section itself', () => {
    // Such section has to resolve, as the configuration schema requires it to be an object
    const isPropertyDeferred = buildPredicate({ options: { stage: 'dev' } });
    expect(isPropertyDeferred(p('params', 'prod'))).to.be.false;
  });

  it('should not defer params of the effective stage', () => {
    const isPropertyDeferred = buildPredicate({ options: { stage: 'prod' } });
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.false;
  });

  it('should not defer default params', () => {
    const isPropertyDeferred = buildPredicate({ options: { stage: 'dev' } });
    expect(isPropertyDeferred(p('params', 'default', 'secret'))).to.be.false;
    expect(isPropertyDeferred(p('params', 'default'))).to.be.false;
  });

  it('should not defer properties outside of "params"', () => {
    const isPropertyDeferred = buildPredicate({ options: { stage: 'dev' } });
    expect(isPropertyDeferred(p('provider', 'stage'))).to.be.false;
    expect(isPropertyDeferred(p('paramsLike', 'prod'))).to.be.false;
    expect(isPropertyDeferred('params')).to.be.false;
  });

  it('should resolve effective stage from "provider.stage" when not passed via options', () => {
    const isPropertyDeferred = buildPredicate({ provider: { stage: 'prod' }, options: {} });
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.false;
    expect(isPropertyDeferred(p('params', 'dev', 'secret'))).to.be.true;
  });

  it('should prioritize stage passed via options over "provider.stage"', () => {
    const isPropertyDeferred = buildPredicate({
      provider: { stage: 'prod' },
      options: { stage: 'dev' },
    });
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.true;
    expect(isPropertyDeferred(p('params', 'dev', 'secret'))).to.be.false;
  });

  it('should default effective stage to "dev"', () => {
    const isPropertyDeferred = buildPredicate({ options: {} });
    expect(isPropertyDeferred(p('params', 'dev', 'secret'))).to.be.false;
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.true;
  });

  it('should ignore non-primitive "provider.stage" values safely', () => {
    const isPropertyDeferred = buildPredicate({
      provider: { stage: { unexpected: 'object' } },
      options: {},
    });
    expect(isPropertyDeferred(p('params', 'dev', 'secret'))).to.be.false;
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.true;
  });

  it('should not defer when "provider.stage" did not resolve yet', () => {
    // Deferring against a stage which is about to change would strand params of the effective
    // stage as never scheduled for resolution
    const isPropertyDeferred = buildPredicate({
      provider: { stage: "${opt:stage, 'prod'}" },
      options: {},
    });
    expect(isPropertyDeferred(p('params', 'dev', 'secret'))).to.be.false;
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.false;
  });

  it('should not defer when stage passed via options did not resolve yet', () => {
    const isPropertyDeferred = buildPredicate({ options: { stage: '${env:STAGE}' } });
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.false;
  });

  it('should not defer when "params" is not a plain object', () => {
    const isPropertyDeferred = buildPredicate({ params: null, options: { stage: 'dev' } });
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.false;
    const isPropertyDeferredForArray = buildPredicate({
      params: ['unexpected'],
      options: { stage: 'dev' },
    });
    expect(isPropertyDeferredForArray(p('params', '0', 'secret'))).to.be.false;
  });

  it('should read configuration and options live', () => {
    const configuration = { params: { dev: {}, prod: {} } };
    const resolverConfiguration = { options: {} };
    const isPropertyDeferred = deferIrrelevantStageParams(configuration, resolverConfiguration);
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.true;
    // Options object is replaced between resolution passes
    resolverConfiguration.options = { stage: 'prod' };
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.false;
    // Plugins may replace the "params" section during initialization
    configuration.params = 'not-an-object';
    expect(isPropertyDeferred(p('params', 'prod', 'secret'))).to.be.false;
  });
});
