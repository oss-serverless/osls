import { expect } from 'chai';
import serviceCommands from '../../../../../lib/cli/commands-schema/service.ts';

describe('test/unit/lib/cli/commands-schema/service.test.ts', () => {
  it('should expose no service commands', () =>
    expect(serviceCommands.get('create')).to.have.property('options'));
  it('should expose service commands', () =>
    expect(serviceCommands.get('package')).to.have.property('options'));
  it('should not expose AWS service commands', () =>
    expect(serviceCommands.has('deploy')).to.be.false);

  it('should expose no service options on service commands', () =>
    expect(serviceCommands.get('plugin install').options).to.have.property('help'));
  it('should expose service options on service commands', () =>
    expect(serviceCommands.get('plugin install').options).to.have.property('config'));
  it('should not expose AWS service options on service commands', () =>
    expect(serviceCommands.get('plugin install').options).to.not.have.property('region'));
});
