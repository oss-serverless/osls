'use strict';

const path = require('path');
const chai = require('chai');
const sinon = require('sinon');
const getServiceState = require('../../../../../../lib/plugins/aws/lib/get-service-state');

const expect = chai.expect;

describe('#getServiceState()', () => {
  let context;
  let readFileSyncStub;

  beforeEach(() => {
    readFileSyncStub = sinon.stub().returns();
    context = {
      options: {},
      provider: {
        naming: {
          getServiceStateFileName: sinon.stub().returns('serverless-state.json'),
        },
      },
      serverless: {
        serviceDir: 'my-service',
        utils: { readFileSync: readFileSyncStub },
      },
      ...getServiceState,
    };
  });

  it('should use the default state file path if the "package" option is not used', () => {
    const stateFilePath = path.resolve('my-service', '.serverless', 'serverless-state.json');
    context.getServiceState();

    expect(context.provider.naming.getServiceStateFileName).to.have.been.calledOnceWithExactly();
    expect(readFileSyncStub).to.be.calledWithExactly(stateFilePath);
  });

  it('should use the argument-based state file path if the "package" option is used ', () => {
    const stateFilePath = path.resolve('my-service', 'some-package-path', 'serverless-state.json');
    context.options.package = 'some-package-path';

    context.getServiceState();
    expect(readFileSyncStub).to.be.calledWithExactly(stateFilePath);
  });
});
