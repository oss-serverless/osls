'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');
const setBucketName = require('../../../../../../lib/plugins/aws/lib/set-bucket-name');

describe('#setBucketName()', () => {
  let context;
  let getServerlessDeploymentBucketNameStub;

  beforeEach(() => {
    getServerlessDeploymentBucketNameStub = sinon.stub().resolves('bucket-name');
    context = {
      provider: {
        getServerlessDeploymentBucketName: getServerlessDeploymentBucketNameStub,
      },
      ...setBucketName,
    };
  });

  it('should store the name of the Serverless deployment bucket', async () => {
    await context.setBucketName();

    expect(context.bucketName).to.equal('bucket-name');
    expect(getServerlessDeploymentBucketNameStub).to.have.been.calledOnceWithExactly();
  });

  it('should resolve if the bucketName is already set', async () => {
    const bucketName = 'someBucket';
    context.bucketName = bucketName;

    await expect(context.setBucketName()).to.eventually.equal(bucketName);

    expect(getServerlessDeploymentBucketNameStub).to.not.have.been.called;
    expect(context.bucketName).to.equal(bucketName);
  });
});
