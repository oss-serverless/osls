import { expect } from 'chai';
import generateCommandUsage from '../../../../../lib/cli/render-help/generate-command-usage.ts';
import commandsSchema from '../../../../../lib/cli/commands-schema/no-service.ts';

describe('test/unit/lib/cli/render-help/generate-command-usage.test.ts', () => {
  it('should generate usage info', async () => {
    const commandSchema = commandsSchema.get('config');
    const resultString = generateCommandUsage('config', commandSchema);
    expect(resultString).to.have.string('config');
    expect(resultString).to.have.string(commandSchema.usage);
  });
});
