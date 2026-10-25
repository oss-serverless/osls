import * as chai from 'chai';
import Remove from '../../../../lib/plugins/remove.ts';

const expect = chai.expect;

describe('Remove', () => {
  let remove;
  let serverless;

  beforeEach(() => {
    serverless = {};
    remove = new Remove(serverless);
  });

  describe('#constructor()', () => {
    it('should have access to the serverless instance', () => {
      expect(remove.serverless).to.deep.equal(serverless);
    });

    it('should have commands', () => expect(remove.commands).to.be.not.empty);
  });
});
