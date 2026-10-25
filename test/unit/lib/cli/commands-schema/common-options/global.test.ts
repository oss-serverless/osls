import { expect } from 'chai';
import globalCommonOptions from '../../../../../../lib/cli/commands-schema/common-options/global.ts';

describe('test/unit/lib/cli/commands-schema/common-options/global.test.ts', () => {
  it('should expose global common options', () =>
    expect(globalCommonOptions).to.have.property('help'));
  it('should not expose service common options', () =>
    expect(globalCommonOptions).to.not.have.property('config'));
  it('should not expose AWS service common options', () =>
    expect(globalCommonOptions).to.not.have.property('region'));
});
