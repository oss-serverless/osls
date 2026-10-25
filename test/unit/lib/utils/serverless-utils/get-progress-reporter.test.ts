import { expect } from 'chai';
import esmock from 'esmock';

describe('serverless-utils/get-progress-reporter', () => {
  let getProgressReporter;
  let events;

  beforeEach(async () => {
    getProgressReporter = (
      await esmock('../../../../../lib/utils/serverless-utils/lib/log/get-progress-reporter.ts')
    ).default;
    events = [];
    getProgressReporter.emitter.on('update', (event) => events.push(event));
  });

  afterEach(() => {
    getProgressReporter.emitter.removeAllListeners();
    getProgressReporter.clear();
  });

  it('emits update events for notice and info progress calls', () => {
    const progress = getProgressReporter('test').get('upload');

    progress.notice('#1');
    progress.info('#2');

    expect(events).to.have.length(2);
    expect(events[0]).to.include({
      namespace: 'test',
      name: 'upload',
      level: 'notice',
    });
    expect(events[1]).to.include({
      namespace: 'test',
      name: 'upload',
      level: 'info',
    });
  });

  it('throws PROGRESS_NAME_TAKEN when a named progress is created twice', () => {
    const progress = getProgressReporter('test');

    expect(progress.create({ name: 'deploy' })).to.equal(progress.get('deploy'));
    expect(() => progress.create({ name: 'deploy' }))
      .to.throw(Error)
      .with.property('code', 'PROGRESS_NAME_TAKEN');
  });
});
