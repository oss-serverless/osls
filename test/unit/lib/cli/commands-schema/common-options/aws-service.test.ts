import { expect } from 'chai';
import awsServiceCommonOptions from '../../../../../../lib/cli/commands-schema/common-options/aws-service.ts';

describe('test/unit/lib/cli/commands-schema/common-options/aws-service.test.ts', () => {
  it('should expose global common options', () =>
    expect(awsServiceCommonOptions).to.have.property('help'));
  it('should expose service common options', () =>
    expect(awsServiceCommonOptions).to.have.property('config'));
  it('should expose AWS service common options', () =>
    expect(awsServiceCommonOptions).to.have.property('region'));
});
