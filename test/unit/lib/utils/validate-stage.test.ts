'use strict';

const { expect } = require('chai');
const validateStage = require('../../../../lib/utils/validate-stage');

describe('test/unit/lib/utils/validate-stage.test.js', () => {
  it('exports the shared stage pattern', () => {
    expect(validateStage.STAGE_NAME_PATTERN).to.equal('^[A-Za-z0-9-]+$');
  });

  for (const stage of ['dev', 'prod', 'prod-1', 'myStage', 'A1-b2', '123', '001', '-']) {
    it(`accepts ${JSON.stringify(stage)}`, () => {
      expect(validateStage(stage)).to.equal(stage);
    });
  }

  for (const stage of [
    '',
    'my_stage',
    'feature.prod',
    'foo/bar',
    'foo\\bar',
    'foo bar',
    'foo\nbar',
    'foo\tbar',
    'foo\u0000bar',
    'café',
    'مرحبا',
    'prod😀',
    'dev@prod',
    '../prod',
  ]) {
    it(`rejects invalid string stage ${JSON.stringify(stage)}`, () => {
      expect(() => validateStage(stage))
        .to.throw()
        .and.have.property('code', 'INVALID_STAGE');
    });
  }

  for (const stage of [true, false, 123, 0, null, undefined, ['dev', 'prod'], { value: 'dev' }]) {
    it(`rejects non-string stage ${JSON.stringify(stage)}`, () => {
      expect(() => validateStage(stage))
        .to.throw()
        .and.have.property('code', 'INVALID_STAGE');
    });
  }

  it('does not include the invalid raw value in the error message', () => {
    let error;
    try {
      validateStage('foo\nbar');
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).to.have.property('code', 'INVALID_STAGE');
    expect(error.message).to.not.include('foo\nbar');
  });
});
