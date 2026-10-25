'use strict';

const { expect } = require('chai');
const ensureValidLayerPath = require('../../../../lib/utils/ensure-valid-layer-path');

describe('test/unit/lib/utils/ensure-valid-layer-path.test.js', () => {
  for (const layerPath of ['layer', '/tmp/layer', undefined]) {
    it(`accepts ${JSON.stringify(layerPath)}`, () => {
      expect(() => ensureValidLayerPath('myLayer', layerPath)).to.not.throw();
    });
  }

  for (const layerPath of ['layer\nRUN whoami', 'layer\rfoo', 'layer\0foo']) {
    it(`rejects ${JSON.stringify(layerPath)}`, () => {
      expect(() => ensureValidLayerPath('myLayer', layerPath))
        .to.throw('Invalid "layers.myLayer.path"')
        .and.have.property('code', 'INVALID_LAYER_PATH');
    });
  }

  it('does not include the invalid raw value in the error message', () => {
    let error;

    try {
      ensureValidLayerPath('myLayer', 'layer\nRUN whoami');
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).to.have.property('code', 'INVALID_LAYER_PATH');
    expect(error.message).to.not.include('RUN whoami');
  });
});
