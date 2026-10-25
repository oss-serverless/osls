'use strict';

const expect = require('chai').expect;
const Rollback = require('../../../../lib/plugins/rollback');

describe('Rollback', () => {
  let rollback;
  let serverless;

  beforeEach(() => {
    serverless = {};
    rollback = new Rollback(serverless);
  });

  describe('#constructor()', () => {
    describe('when dealing with normal rollbacks', () => {
      it('should have the command "rollback"', () => {
        expect(rollback.commands.rollback).to.not.be.undefined;
      });

      it('should have a lifecycle events initialize and rollback', () => {
        expect(rollback.commands.rollback.lifecycleEvents).to.deep.equal([
          'initialize',
          'rollback',
        ]);
      });

      it('should not have a required option timestamp', () => {
        expect(rollback.commands.rollback.options.timestamp.required).to.be.false;
      });
    });

    describe('when dealing with function rollbacks', () => {
      it('should have the command "rollback function"', () => {
        expect(rollback.commands.rollback.commands.function).to.not.be.undefined;
      });

      it('should have a lifecycle event rollback', () => {
        expect(rollback.commands.rollback.commands.function.lifecycleEvents).to.deep.equal([
          'rollback',
        ]);
      });

      it('should have a required option function', () => {
        expect(rollback.commands.rollback.commands.function.options.function.required).to.be.true;
      });
    });
  });
});
