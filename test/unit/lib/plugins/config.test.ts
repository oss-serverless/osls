import runServerless from '../../../utils/run-serverless.ts';

describe('Config', () => {
  it('should support "config credentials" command', () =>
    runServerless({
      noService: true,
      command: 'config credentials',
      options: { provider: 'aws', key: 'foo', secret: 'bar' },
    }));
});
