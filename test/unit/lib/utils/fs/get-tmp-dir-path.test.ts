import { expect } from 'chai';
import getTmpDirPath from '../../../../../lib/utils/fs/get-tmp-dir-path.ts';

describe('#getTmpDirPath()', () => {
  it('should return a scoped tmp dir path', () => {
    const tmpDirPath = getTmpDirPath();
    expect(tmpDirPath).to.match(/tmpdirs-serverless[/\\][0-9a-f]{24}[/\\][0-9a-f]{24}$/);
  });
});
