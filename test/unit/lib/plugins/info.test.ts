'use strict';

const chai = require('chai');
const Info = require('../../../../lib/plugins/info');

const expect = chai.expect;

describe('Info', () => {
  let info;
  let serverless;

  beforeEach(() => {
    serverless = {};
    info = new Info(serverless);
  });

  describe('#constructor()', () => {
    it('should have commands', () => expect(info.commands).to.be.not.empty);
  });
});
