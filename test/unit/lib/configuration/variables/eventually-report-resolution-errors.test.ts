import { expect } from 'chai';
import { overrideArgv } from '../../../../utils/process.ts';
import ServerlessError from '../../../../../lib/serverless-error.ts';
import resolveCliInput from '../../../../../lib/cli/resolve-input.ts';
import resolveMeta from '../../../../../lib/configuration/variables/resolve-meta.ts';
import eventuallyReportResolutionErrors from '../../../../../lib/configuration/variables/eventually-report-resolution-errors.ts';

describe('test/unit/lib/configuration/variables/eventually-report-resolution-errors.test.ts', () => {
  beforeEach(() => {
    resolveCliInput.clear();
  });
  it('should return "false" on no errors', () => {
    const configuration = { foo: 'bar' };
    const variablesMeta = resolveMeta(configuration);

    expect(eventuallyReportResolutionErrors(process.cwd(), configuration, variablesMeta)).to.equal(
      false
    );
  });

  describe('On errors', () => {
    it('should throw error in regular circumstances', () => {
      const configuration = { foo: '${foo:raz' };
      const variablesMeta = resolveMeta(configuration);
      overrideArgv({ args: ['serverless', 'foo'] }, () =>
        expect(() => eventuallyReportResolutionErrors(process.cwd(), configuration, variablesMeta))
          .to.throw(ServerlessError)
          .with.property('code', 'VARIABLES_RESOLUTION_ERROR')
      );
    });
  });
});
