'use strict';

const chai = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs');
const proxyquire = require('proxyquire');
const {
  LambdaClient,
  GetFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} = require('@aws-sdk/client-lambda');
const { IAMClient, GetRoleCommand } = require('@aws-sdk/client-iam');
const AwsProvider = require('../../../../../lib/plugins/aws/provider');
const Serverless = require('../../../../../lib/serverless');
const runServerless = require('../../../../utils/run-serverless');
const { getTmpDirPath } = require('../../../../utils/fs');

const expect = chai.expect;

const consoleLayerArn = 'arn:aws:lambda:us-east-1:321667558080:layer:sls-sdk:1';
describe('AwsDeployFunction', () => {
  let AwsDeployFunction;
  let serverless;
  let awsDeployFunction;
  let getHashForFilePathStub;

  beforeEach(async () => {
    serverless = new Serverless({ commands: ['print'], options: {}, serviceDir: null });
    serverless.servicePath = true;
    serverless.service.environment = {
      vars: {},
      stages: {
        dev: {
          vars: {},
          regions: {
            'us-east-1': {
              vars: {},
            },
          },
        },
      },
    };
    serverless.service.serviceObject = {};
    serverless.service.functions = {
      first: {
        handler: true,
      },
    };
    const options = {
      stage: 'dev',
      region: 'us-east-1',
      function: 'first',
      functionObj: {
        name: 'first',
      },
    };
    await serverless.init();
    serverless.setProvider('aws', new AwsProvider(serverless, options));
    getHashForFilePathStub = sinon.stub();
    AwsDeployFunction = proxyquire('../../../../../lib/plugins/aws/deploy-function', {
      '../../utils/get-hash-for-file-path': getHashForFilePathStub,
    });
    awsDeployFunction = new AwsDeployFunction(serverless, options);
  });

  describe('#constructor()', () => {
    it('should have hooks', () => expect(awsDeployFunction.hooks).to.be.not.empty);

    it('should set the provider variable to an instance of AwsProvider', () =>
      expect(awsDeployFunction.provider).to.be.instanceof(AwsProvider));

    it('should set an empty options object if no options are given', () => {
      const awsDeployFunctionWithEmptyOptions = new AwsDeployFunction(serverless);

      expect(awsDeployFunctionWithEmptyOptions.options).to.deep.equal({});
    });
  });

  describe('#checkIfFunctionExists()', () => {
    let getFunctionStub;

    beforeEach(() => {
      getFunctionStub = sinon
        .stub(LambdaClient.prototype, 'send')
        .resolves({ func: { name: 'first' } });
    });

    afterEach(() => {
      LambdaClient.prototype.send.restore();
    });

    it('it should throw error if function is not provided', async () => {
      serverless.service.functions = {};
      await expect(awsDeployFunction.checkIfFunctionExists()).to.eventually.be.rejected;
    });

    it('should check if the function is deployed and save the result', async () => {
      awsDeployFunction.serverless.service.functions = {
        first: {
          name: 'first',
          handler: 'handler.first',
        },
      };

      await awsDeployFunction.checkIfFunctionExists();

      expect(getFunctionStub.calledOnce).to.be.equal(true);
      expect(getFunctionStub.firstCall.args[0]).to.be.instanceOf(GetFunctionCommand);
      expect(getFunctionStub.firstCall.args[0].input).to.deep.equal({
        FunctionName: 'first',
      });
      expect(awsDeployFunction.serverless.service.provider.remoteFunctionData).to.deep.equal({
        func: {
          name: 'first',
        },
      });
    });

    it('uses an existing Lambda client promise when checking the remote function', async () => {
      awsDeployFunction.serverless.service.functions = {
        first: {
          name: 'first',
          handler: 'handler.first',
        },
      };
      const send = sinon.stub().resolves({ func: { name: 'first' } });
      const getAwsSdkV3ConfigStub = sinon
        .stub(awsDeployFunction.provider, 'getAwsSdkV3Config')
        .throws(new Error('Expected existing Lambda client to be reused'));
      awsDeployFunction.lambdaClientPromise = Promise.resolve({ send });

      try {
        await awsDeployFunction.checkIfFunctionExists();

        expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
        expect(send).to.have.been.calledOnce;
        expect(send.firstCall.args[0]).to.be.instanceOf(GetFunctionCommand);
        expect(send.firstCall.args[0].input).to.deep.equal({ FunctionName: 'first' });
        expect(awsDeployFunction.serverless.service.provider.remoteFunctionData).to.deep.equal({
          func: {
            name: 'first',
          },
        });
      } finally {
        getAwsSdkV3ConfigStub.restore();
      }
    });

    it('should translate native SDK v3 not found errors', async () => {
      getFunctionStub.rejects(
        Object.assign(new Error('Function not found'), {
          name: 'ResourceNotFoundException',
        })
      );
      awsDeployFunction.serverless.service.functions = {
        first: {
          name: 'first',
          handler: 'handler.first',
        },
      };

      await expect(
        awsDeployFunction.checkIfFunctionExists()
      ).to.eventually.be.rejected.and.have.property('code', 'FUNCTION_NOT_YET_DEPLOYED');
      expect(getFunctionStub.firstCall.args[0]).to.be.instanceOf(GetFunctionCommand);
      expect(getFunctionStub.firstCall.args[0].input).to.deep.equal({
        FunctionName: 'first',
      });
    });
  });

  describe('#normalizeArnRole', () => {
    let getAccountInfoStub;
    let getRoleStub;

    beforeEach(() => {
      // Ensure that memoized function will be properly stubbed
      awsDeployFunction.provider.getAccountInfo;
      getAccountInfoStub = sinon
        .stub(awsDeployFunction.provider, 'getAccountInfo')
        .resolves({ accountId: '123456789012', partition: 'aws' });
      getRoleStub = sinon
        .stub(IAMClient.prototype, 'send')
        .resolves({ Role: { Arn: 'arn:aws:iam::123456789012:role/role_2' } });

      serverless.service.resources = {
        Resources: {
          MyCustomRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'role_123',
            },
          },
        },
      };
    });

    afterEach(() => {
      awsDeployFunction.provider.getAccountInfo.restore();
      IAMClient.prototype.send.restore();
      serverless.service.resources = undefined;
    });

    it('should return unmodified ARN if ARN was provided', async () => {
      const arn = 'arn:aws:iam::123456789012:role/role';

      const result = await awsDeployFunction.normalizeArnRole(arn);

      expect(getAccountInfoStub).to.not.have.been.called;
      expect(result).to.be.equal(arn);
    });

    it('should return compiled ARN if role name was provided', async () => {
      const roleName = 'MyCustomRole';

      const result = await awsDeployFunction.normalizeArnRole(roleName);

      expect(getAccountInfoStub).to.have.been.called;
      expect(result).to.be.equal('arn:aws:iam::123456789012:role/role_123');
    });

    it('should return compiled ARN if role name has a custom path', async () => {
      serverless.service.resources.Resources.MyPathRole = {
        Type: 'AWS::IAM::Role',
        Properties: {
          Path: '/service/',
          RoleName: 'role_123',
        },
      };

      const result = await awsDeployFunction.normalizeArnRole('MyPathRole');

      expect(getAccountInfoStub).to.have.been.called;
      expect(result).to.be.equal('arn:aws:iam::123456789012:role/service/role_123');
    });

    it('should return compiled ARN if object role was provided', async () => {
      const roleObj = {
        'Fn::GetAtt': ['role_2', 'Arn'],
      };

      const result = await awsDeployFunction.normalizeArnRole(roleObj);

      expect(getRoleStub.calledOnce).to.be.equal(true);
      expect(getRoleStub.firstCall.args[0]).to.be.instanceOf(GetRoleCommand);
      expect(getRoleStub.firstCall.args[0].input).to.deep.equal({ RoleName: 'role_2' });
      expect(getAccountInfoStub).to.not.have.been.called;
      expect(result).to.be.equal('arn:aws:iam::123456789012:role/role_2');
    });

    it('uses an existing IAM client promise when resolving an Fn::GetAtt role', async () => {
      const send = sinon
        .stub()
        .resolves({ Role: { Arn: 'arn:aws:iam::123456789012:role/role_2' } });
      const getAwsSdkV3ConfigStub = sinon
        .stub(awsDeployFunction.provider, 'getAwsSdkV3Config')
        .throws(new Error('Expected existing IAM client to be reused'));
      awsDeployFunction.iamClientPromise = Promise.resolve({ send });

      try {
        const result = await awsDeployFunction.normalizeArnRole({
          'Fn::GetAtt': ['role_2', 'Arn'],
        });

        expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
        expect(send).to.have.been.calledOnce;
        expect(send.firstCall.args[0]).to.be.instanceOf(GetRoleCommand);
        expect(send.firstCall.args[0].input).to.deep.equal({ RoleName: 'role_2' });
        expect(getAccountInfoStub).to.not.have.been.called;
        expect(result).to.equal('arn:aws:iam::123456789012:role/role_2');
      } finally {
        getAwsSdkV3ConfigStub.restore();
      }
    });
  });

  describe('#ensureFunctionState()', () => {
    let getFunctionStub;

    beforeEach(() => {
      serverless.service.functions.first.name = 'first';
      getFunctionStub = sinon.stub(LambdaClient.prototype, 'send').resolves({
        Configuration: {
          State: 'Pending',
          LastUpdateStatus: 'InProgress',
        },
      });
      sinon
        .stub(Date, 'now')
        .onFirstCall()
        .returns(0)
        .onSecondCall()
        .returns(60 * 1000 + 1);
    });

    afterEach(() => {
      LambdaClient.prototype.send.restore();
      Date.now.restore();
    });

    it('should time out while waiting for desired function state', async () => {
      await expect(
        awsDeployFunction.ensureFunctionState()
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'DEPLOY_FUNCTION_ENSURE_STATE_TIMED_OUT'
      );
      expect(getFunctionStub.calledOnce).to.equal(true);
      expect(getFunctionStub.firstCall.args[0]).to.be.instanceOf(GetFunctionCommand);
      expect(getFunctionStub.firstCall.args[0].input).to.deep.equal({ FunctionName: 'first' });
    });
  });

  describe('#callUpdateFunctionConfiguration()', () => {
    let updateFunctionConfigurationStub;

    beforeEach(() => {
      updateFunctionConfigurationStub = sinon.stub(LambdaClient.prototype, 'send').rejects(
        Object.assign(new Error('configuration update conflict'), {
          name: 'ResourceConflictException',
        })
      );
      sinon
        .stub(Date, 'now')
        .onFirstCall()
        .returns(0)
        .onSecondCall()
        .returns(60 * 1000 + 1);
    });

    afterEach(() => {
      LambdaClient.prototype.send.restore();
      Date.now.restore();
    });

    it('should time out retryable configuration update conflicts', async () => {
      await expect(
        awsDeployFunction.callUpdateFunctionConfiguration({ FunctionName: 'first' })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'DEPLOY_FUNCTION_CONFIGURATION_UPDATE_TIMED_OUT'
      );
      expect(updateFunctionConfigurationStub.calledOnce).to.equal(true);
    });

    it('should surface non-conflict configuration update errors without retrying', async () => {
      const updateError = Object.assign(new Error('access denied'), {
        name: 'AccessDeniedException',
      });
      updateFunctionConfigurationStub.rejects(updateError);

      try {
        await awsDeployFunction.callUpdateFunctionConfiguration({ FunctionName: 'first' });
      } catch (error) {
        expect(error).to.equal(updateError);
        expect(updateFunctionConfigurationStub.calledOnce).to.equal(true);
        expect(updateFunctionConfigurationStub.firstCall.args[0]).to.be.instanceOf(
          UpdateFunctionConfigurationCommand
        );
        expect(updateFunctionConfigurationStub.firstCall.args[0].input).to.deep.equal({
          FunctionName: 'first',
        });
        return;
      }

      throw new Error('Expected callUpdateFunctionConfiguration to reject');
    });
  });

  describe('#deployFunction()', () => {
    let artifactFilePath;
    let updateFunctionCodeStub;
    let readFileStub;

    beforeEach(() => {
      // write a file to disc to simulate that the deployment artifact exists
      awsDeployFunction.packagePath = getTmpDirPath();
      artifactFilePath = path.join(awsDeployFunction.packagePath, 'first.zip');
      serverless.utils.writeFileSync(artifactFilePath, 'first.zip file content');
      updateFunctionCodeStub = sinon.stub(LambdaClient.prototype, 'send').resolves();
      readFileStub = sinon.stub(fs.promises, 'readFile').resolves(Buffer.from('first.zip content'));
      getHashForFilePathStub.resolves('local-hash-zip-file');
      awsDeployFunction.serverless.service.provider.remoteFunctionData = {
        Configuration: {
          CodeSha256: 'remote-hash-zip-file',
        },
      };
    });

    afterEach(() => {
      LambdaClient.prototype.send.restore();
      fs.promises.readFile.restore();
    });

    it('should deploy the function if the hashes are different', async () => {
      const data = Buffer.from('first.zip content');
      readFileStub.resolves(data);

      await awsDeployFunction.deployFunction();

      expect(updateFunctionCodeStub.calledOnce).to.be.equal(true);
      expect(getHashForFilePathStub).to.have.been.calledWithExactly(artifactFilePath);
      expect(readFileStub).to.have.been.calledWithExactly(artifactFilePath);
      expect(updateFunctionCodeStub.firstCall.args[0]).to.be.instanceOf(UpdateFunctionCodeCommand);
      expect(updateFunctionCodeStub.firstCall.args[0].input).to.deep.equal({
        FunctionName: 'first',
        ZipFile: data,
      });
    });

    it('should deploy the function if the hashes are same but the "force" option is used', async () => {
      awsDeployFunction.options.force = true;
      const data = Buffer.from('first.zip content');
      readFileStub.resolves(data);

      await awsDeployFunction.deployFunction();

      expect(updateFunctionCodeStub.calledOnce).to.be.equal(true);
      expect(getHashForFilePathStub).to.not.have.been.called;
      expect(readFileStub).to.have.been.calledWithExactly(artifactFilePath);
      expect(updateFunctionCodeStub.firstCall.args[0]).to.be.instanceOf(UpdateFunctionCodeCommand);
      expect(updateFunctionCodeStub.firstCall.args[0].input).to.deep.equal({
        FunctionName: 'first',
        ZipFile: data,
      });
    });

    it('should resolve if the hashes are the same', async () => {
      getHashForFilePathStub.resolves('remote-hash-zip-file');

      await awsDeployFunction.deployFunction();

      expect(updateFunctionCodeStub.calledOnce).to.be.equal(false);
      expect(getHashForFilePathStub).to.have.been.calledWithExactly(artifactFilePath);
      expect(readFileStub).to.not.have.been.called;
    });

    it('should log artifact size', async () => {
      await awsDeployFunction.deployFunction();

      expect(readFileStub.calledOnce).to.equal(true);
      expect(readFileStub.calledWithExactly(artifactFilePath)).to.equal(true);
    });

    describe('when artifact is provided', () => {
      let getFunctionStub;
      const artifactZipFile = 'artifact.zip';

      beforeEach(() => {
        getFunctionStub = sinon.stub(serverless.service, 'getFunction').returns({
          handler: true,
          package: {
            artifact: artifactZipFile,
          },
        });
      });

      afterEach(() => {
        serverless.service.getFunction.restore();
      });

      it('should read the provided artifact', async () => {
        const data = Buffer.from('artifact.zip content');
        readFileStub.resolves(data);

        await awsDeployFunction.deployFunction();

        expect(getHashForFilePathStub).to.have.been.calledWithExactly(artifactZipFile);
        expect(readFileStub).to.have.been.calledWithExactly(artifactZipFile);
        expect(getFunctionStub).to.have.been.calledWithExactly('first');
        expect(updateFunctionCodeStub.calledOnce).to.equal(true);
        expect(updateFunctionCodeStub.firstCall.args[0]).to.be.instanceOf(
          UpdateFunctionCodeCommand
        );
        expect(updateFunctionCodeStub.firstCall.args[0].input).to.deep.equal({
          FunctionName: 'first',
          ZipFile: data,
        });
      });
    });
  });
});

describe('test/unit/lib/plugins/aws/deployFunction.test.js', () => {
  const kmsKeyArn = 'arn:aws:kms:us-east-1:123456789012';
  const description = 'func description';
  const handler = 'funcHandler';
  const functionName = 'funcName';
  const memorySize = 255;
  const onErrorHandler = 'arn:aws:sns:us-east-1:123456789012:onerror';
  const timeout = 50;
  const layerArn = 'arn:aws:lambda:us-east-1:123456789012:layer:layer:1';
  const secondLayerArn = 'arn:aws:lambda:us-east-1:123456789012:layer:layer:2';
  const role = 'arn:aws:iam::123456789012:role/Admin';
  const imageSha = '6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38';
  const imageWithSha = `000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:${imageSha}`;
  const updateFunctionCodeStub = sinon.stub();
  const updateFunctionConfigurationStub = sinon.stub();
  const awsSdkV3StubMap = {
    Lambda: {
      getFunction: {
        Configuration: {
          LastModified: '2020-05-20T15:34:16.494+0000',
          State: 'Active',
          LastUpdateStatus: 'Successful',
        },
      },
      updateFunctionCode: updateFunctionCodeStub,
      updateFunctionConfiguration: updateFunctionConfigurationStub,
    },
    STS: {
      getCallerIdentity: {
        ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
        UserId: 'XXXXXXXXXXXXXXXXXXXXX',
        Account: '999999999999',
        Arn: 'arn:aws:iam::999999999999:user/test',
      },
    },
  };

  beforeEach(() => {
    updateFunctionCodeStub.resetHistory();
    updateFunctionConfigurationStub.resetHistory();
  });

  const expectUpdateFunctionConfigurationInput = (expectedInput) => {
    expect(updateFunctionConfigurationStub).to.be.calledOnce;
    expect(updateFunctionConfigurationStub.firstCall.args[0]).to.deep.equal(expectedInput);
  };

  // This is just a happy-path test of images support. Due to sharing code from `provider.js`
  // all further configurations are tested as a part of `test/unit/lib/plugins/aws/provider.test.js`
  it('should support deploying function that has image defined with sha', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'foo' },
      awsSdkV3StubMap,
      configExt: {
        functions: {
          foo: {
            image: imageWithSha,
          },
        },
      },
    });
    expect(updateFunctionCodeStub).to.be.calledOnce;
    expect(updateFunctionCodeStub.args[0][0].ImageUri).to.equal(imageWithSha);
  });

  it('should support updating function with image config', async () => {
    const { awsSdkV3Stub, serverless } = await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'foo' },
      awsSdkV3StubMap,
      configExt: {
        functions: {
          foo: {
            image: {
              uri: imageWithSha,
              workingDirectory: './workdir',
              entryPoint: ['executable', 'param1'],
              command: ['anotherexecutable'],
            },
          },
        },
      },
    });
    expect(updateFunctionCodeStub).to.be.calledOnce;
    expect(updateFunctionCodeStub.args[0][0].ImageUri).to.equal(imageWithSha);
    expect(updateFunctionConfigurationStub).to.be.calledOnce;
    expect(updateFunctionConfigurationStub.args[0][0].ImageConfig).to.deep.equal({
      Command: ['anotherexecutable'],
      EntryPoint: ['executable', 'param1'],
      WorkingDirectory: './workdir',
    });
    const expectedCredentials = serverless.getProvider('aws').getAwsSdkV3CredentialsProvider();
    expect(
      awsSdkV3Stub.sends
        .filter(({ service }) => service === 'Lambda')
        .every(({ clientConfig }) => clientConfig.credentials === expectedCredentials)
    ).to.equal(true);
  });

  it('should skip updating function configuration if image config did not change', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              CodeSha256: imageSha,
              State: 'Active',
              LastUpdateStatus: 'Successful',

              ImageConfigResponse: {
                ImageConfig: {
                  Command: ['anotherexecutable'],
                  EntryPoint: ['executable', 'param1'],
                  WorkingDirectory: './workdir',
                },
              },
            },
          },
        },
      },
      configExt: {
        functions: {
          basic: {
            handler: null,
            image: {
              uri: imageWithSha,
              workingDirectory: './workdir',
              entryPoint: ['executable', 'param1'],
              command: ['anotherexecutable'],
            },
          },
        },
      },
    });
    expect(updateFunctionConfigurationStub).not.to.be.called;
  });

  it('should treat null remote image config as different from an empty local image config', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              CodeSha256: imageSha,
              State: 'Active',
              LastUpdateStatus: 'Successful',
              ImageConfigResponse: {
                ImageConfig: null,
              },
            },
          },
        },
      },
      configExt: {
        functions: {
          basic: {
            image: imageWithSha,
          },
        },
      },
    });

    expect(updateFunctionCodeStub).not.to.be.called;
    expect(updateFunctionConfigurationStub).to.be.calledOnce;
    expect(updateFunctionConfigurationStub.args[0][0].ImageConfig).to.deep.equal({});
  });

  it('should skip deployment if image sha did not change', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              CodeSha256: imageSha,
              State: 'Active',
              LastUpdateStatus: 'Successful',
            },
          },
        },
      },
      configExt: {
        functions: {
          basic: {
            image: imageWithSha,
          },
        },
      },
    });
    expect(updateFunctionCodeStub).not.to.be.called;
  });

  it('should fail if function with image was previously defined with handler', async () => {
    await expect(
      runServerless({
        fixture: 'function',
        command: 'deploy function',
        options: { function: 'basic' },
        awsSdkV3StubMap: {
          ...awsSdkV3StubMap,
          Lambda: {
            ...awsSdkV3StubMap.Lambda,
            getFunction: {
              Configuration: {
                LastModified: '2020-05-20T15:34:16.494+0000',
                PackageType: 'Zip',
                State: 'Active',
                LastUpdateStatus: 'Successful',
              },
            },
          },
        },
        configExt: {
          functions: {
            basic: {
              image: imageWithSha,
            },
          },
        },
      })
    ).to.be.eventually.rejected.and.have.property(
      'code',
      'DEPLOY_FUNCTION_CHANGE_BETWEEN_HANDLER_AND_IMAGE_ERROR'
    );
  });

  it('should fail if function with image was previously defined with handler', async () => {
    await expect(
      runServerless({
        fixture: 'function',
        command: 'deploy function',
        options: { function: 'basic' },
        awsSdkV3StubMap: {
          ...awsSdkV3StubMap,
          Lambda: {
            ...awsSdkV3StubMap.Lambda,
            getFunction: {
              Configuration: {
                LastModified: '2020-05-20T15:34:16.494+0000',
                PackageType: 'Image',
                State: 'Active',
                LastUpdateStatus: 'Successful',
              },
            },
          },
        },
      })
    ).to.be.eventually.rejected.and.have.property(
      'code',
      'DEPLOY_FUNCTION_CHANGE_BETWEEN_HANDLER_AND_IMAGE_ERROR'
    );
  });

  it('should handle retry when `updateFunctionConfiguration` returns `ResourceConflictException` error', async () => {
    const innerUpdateFunctionConfigurationStub = sinon
      .stub()
      .onFirstCall()
      .throws(
        Object.assign(new Error('configuration update conflict'), {
          name: 'ResourceConflictException',
        })
      )
      .onSecondCall()
      .resolves({});
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          updateFunctionConfiguration: innerUpdateFunctionConfigurationStub,
        },
      },
      modulesCacheStub: {
        [path.resolve(__dirname, '../../../../../lib/utils/sleep.js')]: sinon.stub().resolves(),
      },
      configExt: {
        functions: {
          basic: {
            timeout: 50,
          },
        },
      },
    });

    expect(innerUpdateFunctionConfigurationStub.callCount).to.equal(2);
  });

  it('should update function configuration if configuration changed', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              State: 'Active',
              LastUpdateStatus: 'Successful',
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            kmsKeyArn,
            description,
            handler,
            environment: {
              VARIABLE: 'value',
            },
            name: functionName,
            memorySize,
            onError: onErrorHandler,
            role,
            timeout,
            vpc: {
              securityGroupIds: ['sg-111', 'sg-222'],
              subnetIds: ['subnet-111', 'subnet-222'],
            },
            layers: [layerArn, secondLayerArn],
          },
        },
      },
    });
    expectUpdateFunctionConfigurationInput({
      FunctionName: functionName,
      KMSKeyArn: kmsKeyArn,
      Description: description,
      Handler: handler,
      Environment: {
        Variables: {
          ANOTHERVAR: 'anothervalue',
          VARIABLE: 'value',
        },
      },
      MemorySize: memorySize,
      Timeout: timeout,
      DeadLetterConfig: {
        TargetArn: onErrorHandler,
      },
      Role: role,
      VpcConfig: {
        SecurityGroupIds: ['sg-111', 'sg-222'],
        SubnetIds: ['subnet-111', 'subnet-222'],
      },
      Layers: [layerArn, secondLayerArn],
    });
  });

  it('should reject deploy function for durable functions', async () => {
    await expect(
      runServerless({
        fixture: 'function',
        command: 'deploy function',
        options: { function: 'basic' },
        awsSdkV3StubMap: {
          ...awsSdkV3StubMap,
          Lambda: {
            ...awsSdkV3StubMap.Lambda,
            getFunction: {
              Configuration: {
                LastModified: '2020-05-20T15:34:16.494+0000',
                PackageType: 'Zip',
                State: 'Active',
                LastUpdateStatus: 'Successful',
              },
            },
          },
        },
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              durableConfig: {
                executionTimeout: 3600,
                retentionPeriodInDays: 30,
              },
            },
          },
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'DURABLE_DEPLOY_FUNCTION_UNSUPPORTED');

    expect(updateFunctionConfigurationStub).not.to.be.called;
  });

  it('should reject deploy function when remote function is durable', async () => {
    await expect(
      runServerless({
        fixture: 'function',
        command: 'deploy function',
        options: { function: 'basic' },
        awsSdkV3StubMap: {
          ...awsSdkV3StubMap,
          Lambda: {
            ...awsSdkV3StubMap.Lambda,
            getFunction: {
              Configuration: {
                LastModified: '2020-05-20T15:34:16.494+0000',
                PackageType: 'Zip',
                State: 'Active',
                LastUpdateStatus: 'Successful',
                DurableConfig: {
                  ExecutionTimeout: 3600,
                },
              },
            },
          },
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'DURABLE_DEPLOY_FUNCTION_UNSUPPORTED');

    expect(updateFunctionCodeStub).not.to.be.called;
    expect(updateFunctionConfigurationStub).not.to.be.called;
  });

  it('should recognize layers at `provider.layers`', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              State: 'Active',
              LastUpdateStatus: 'Successful',
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
          layers: [layerArn, secondLayerArn],
        },
        functions: {
          basic: {
            kmsKeyArn,
            description,
            handler,
            environment: {
              VARIABLE: 'value',
            },
            name: functionName,
            memorySize,
            onError: onErrorHandler,
            role,
            timeout,
            vpc: {
              securityGroupIds: ['sg-111', 'sg-222'],
              subnetIds: ['subnet-111', 'subnet-222'],
            },
          },
        },
      },
    });
    expectUpdateFunctionConfigurationInput({
      FunctionName: functionName,
      KMSKeyArn: kmsKeyArn,
      Description: description,
      Handler: handler,
      Environment: {
        Variables: {
          ANOTHERVAR: 'anothervalue',
          VARIABLE: 'value',
        },
      },
      MemorySize: memorySize,
      Timeout: timeout,
      DeadLetterConfig: {
        TargetArn: onErrorHandler,
      },
      Role: role,
      VpcConfig: {
        SecurityGroupIds: ['sg-111', 'sg-222'],
        SubnetIds: ['subnet-111', 'subnet-222'],
      },
      Layers: [layerArn, secondLayerArn],
    });
  });

  it('should update function configuration if configuration changed where all arn layers were removed', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              Description: description,
              Handler: handler,
              State: 'Active',
              LastUpdateStatus: 'Successful',
              Environment: {
                Variables: {
                  ANOTHERVAR: 'anothervalue',
                  VARIABLE: 'value',
                },
              },
              FunctionName: functionName,
              MemorySize: memorySize,
              Layers: [{ Arn: secondLayerArn }, { Arn: layerArn }],
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            description,
            handler,
            environment: {
              VARIABLE: 'value',
            },
            name: functionName,
            memorySize,
            layers: [],
          },
        },
      },
    });
    expectUpdateFunctionConfigurationInput({
      FunctionName: functionName,
      Layers: [],
    });
  });

  it('should update function configuration if the configuration changed and is managed by serverless console', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              Description: description,
              Handler: handler,
              State: 'Active',
              LastUpdateStatus: 'Successful',
              Environment: {
                Variables: {
                  ANOTHERVAR: 'anothervalue',
                  VARIABLE: 'value',
                  AWS_LAMBDA_EXEC_WRAPPER: '/opt/lib/libthundra-wrapper.so',
                  SLS_ORG_ID: '123',
                },
              },
              FunctionName: functionName,
              MemorySize: memorySize,
              Layers: [{ Arn: layerArn }, { Arn: consoleLayerArn }],
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            description,
            handler,
            environment: {
              VARIABLE: 'value',
              VARIABLE2: 'value2',
            },
            name: functionName,
            memorySize,
            layers: [layerArn, secondLayerArn],
          },
        },
      },
    });
    expectUpdateFunctionConfigurationInput({
      FunctionName: functionName,
      Environment: {
        Variables: {
          ANOTHERVAR: 'anothervalue',
          VARIABLE: 'value',
          VARIABLE2: 'value2',
          AWS_LAMBDA_EXEC_WRAPPER: '/opt/lib/libthundra-wrapper.so',
          SLS_ORG_ID: '123',
        },
      },
      Layers: [layerArn, secondLayerArn, consoleLayerArn],
    });
  });

  it('should update function configuration and remove local arn layers if the configuration changed and is managed by serverless console', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              Description: description,
              Handler: handler,
              State: 'Active',
              LastUpdateStatus: 'Successful',
              Environment: {
                Variables: {
                  ANOTHERVAR: 'anothervalue',
                  VARIABLE: 'value',
                  AWS_LAMBDA_EXEC_WRAPPER: '/opt/lib/libthundra-wrapper.so',
                  SLS_ORG_ID: '123',
                },
              },
              FunctionName: functionName,
              MemorySize: memorySize,
              Layers: [{ Arn: layerArn }, { Arn: consoleLayerArn }],
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            description,
            handler,
            environment: {},
            name: functionName,
            memorySize,
            layers: [],
          },
        },
      },
    });

    expectUpdateFunctionConfigurationInput({
      FunctionName: functionName,
      Environment: {
        Variables: {
          ANOTHERVAR: 'anothervalue',
          AWS_LAMBDA_EXEC_WRAPPER: '/opt/lib/libthundra-wrapper.so',
          SLS_ORG_ID: '123',
        },
      },
      Layers: [consoleLayerArn],
    });
  });

  it('should skip updating properties that contain references', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              State: 'Active',
              LastUpdateStatus: 'Successful',
            },
          },
        },
      },
      configExt: {
        functions: {
          basic: {
            name: functionName,
            role,
            timeout,
            vpc: {
              securityGroupIds: ['sg-111', { Ref: 'mySGRef' }],
              subnetIds: ['subnet-111', 'subnet-222'],
            },
            environment: {
              VARIABLE: {
                Ref: 'SomeReference',
              },
            },
          },
        },
      },
    });

    expectUpdateFunctionConfigurationInput({
      FunctionName: functionName,
      Handler: 'basic.handler',
      Timeout: timeout,
      VpcConfig: {
        SubnetIds: ['subnet-111', 'subnet-222'],
      },
      Role: role,
    });
  });

  it('should update function configuration if ipv6AllowedForDualStack is true', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              State: 'Active',
              LastUpdateStatus: 'Successful',
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            kmsKeyArn,
            description,
            handler,
            environment: {
              VARIABLE: 'value',
            },
            name: functionName,
            memorySize,
            onError: onErrorHandler,
            role,
            timeout,
            vpc: {
              ipv6AllowedForDualStack: true,
              securityGroupIds: ['sg-111', 'sg-222'],
              subnetIds: ['subnet-111', 'subnet-222'],
            },
            layers: [layerArn, secondLayerArn],
          },
        },
      },
    });
    expectUpdateFunctionConfigurationInput({
      FunctionName: functionName,
      KMSKeyArn: kmsKeyArn,
      Description: description,
      Handler: handler,
      Environment: {
        Variables: {
          ANOTHERVAR: 'anothervalue',
          VARIABLE: 'value',
        },
      },
      MemorySize: memorySize,
      Timeout: timeout,
      DeadLetterConfig: {
        TargetArn: onErrorHandler,
      },
      Role: role,
      VpcConfig: {
        Ipv6AllowedForDualStack: true,
        SecurityGroupIds: ['sg-111', 'sg-222'],
        SubnetIds: ['subnet-111', 'subnet-222'],
      },
      Layers: [layerArn, secondLayerArn],
    });
  });

  it('should update function configuration if ipv6AllowedForDualStack is false', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              State: 'Active',
              LastUpdateStatus: 'Successful',
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            kmsKeyArn,
            description,
            handler,
            environment: {
              VARIABLE: 'value',
            },
            name: functionName,
            memorySize,
            onError: onErrorHandler,
            role,
            timeout,
            vpc: {
              ipv6AllowedForDualStack: false,
              securityGroupIds: ['sg-111', 'sg-222'],
              subnetIds: ['subnet-111', 'subnet-222'],
            },
            layers: [layerArn, secondLayerArn],
          },
        },
      },
    });
    expectUpdateFunctionConfigurationInput({
      FunctionName: functionName,
      KMSKeyArn: kmsKeyArn,
      Description: description,
      Handler: handler,
      Environment: {
        Variables: {
          ANOTHERVAR: 'anothervalue',
          VARIABLE: 'value',
        },
      },
      MemorySize: memorySize,
      Timeout: timeout,
      DeadLetterConfig: {
        TargetArn: onErrorHandler,
      },
      Role: role,
      VpcConfig: {
        SecurityGroupIds: ['sg-111', 'sg-222'],
        SubnetIds: ['subnet-111', 'subnet-222'],
      },
      Layers: [layerArn, secondLayerArn],
    });
  });

  it('should update function configuration with provider-level properties', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              State: 'Active',
              LastUpdateStatus: 'Successful',
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
            VARIABLE: 'value',
          },
          memorySize,
          iam: { role },
          timeout,
          vpc: {
            securityGroupIds: ['sg-111', 'sg-222'],
            subnetIds: ['subnet-111', 'subnet-222'],
          },
        },
        functions: {
          basic: {
            name: functionName,
          },
        },
      },
    });

    expectUpdateFunctionConfigurationInput({
      FunctionName: functionName,
      Handler: 'basic.handler',
      Environment: {
        Variables: {
          ANOTHERVAR: 'anothervalue',
          VARIABLE: 'value',
        },
      },
      MemorySize: memorySize,
      Timeout: timeout,
      Role: role,
      VpcConfig: {
        SecurityGroupIds: ['sg-111', 'sg-222'],
        SubnetIds: ['subnet-111', 'subnet-222'],
      },
    });
  });

  it('should pass credential provider unchanged when resolving IAM role references', async () => {
    const { awsSdkV3Stub, serverless } = await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        IAM: {
          getRole: { Role: { Arn: role } },
        },
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              State: 'Active',
              LastUpdateStatus: 'Successful',
            },
          },
        },
      },
      configExt: {
        functions: {
          basic: {
            name: functionName,
            role: { 'Fn::GetAtt': ['CustomRole', 'Arn'] },
          },
        },
      },
    });

    const getRoleSend = awsSdkV3Stub.sends.find(
      ({ service, method }) => service === 'IAM' && method === 'getRole'
    );

    expect(getRoleSend.input).to.deep.equal({ RoleName: 'CustomRole' });
    expect(getRoleSend.clientConfig.credentials).to.equal(
      serverless.getProvider('aws').getAwsSdkV3CredentialsProvider()
    );
  });

  it('should not update function configuration if configuration did not change', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              KMSKeyArn: kmsKeyArn,
              Description: description,
              Handler: handler,
              State: 'Active',
              LastUpdateStatus: 'Successful',

              Environment: {
                Variables: {
                  ANOTHERVAR: 'anothervalue',
                  VARIABLE: 'value',
                },
              },
              FunctionName: functionName,
              MemorySize: memorySize,
              DeadLetterConfig: {
                TargetArn: onErrorHandler,
              },
              Timeout: timeout,
              Layers: [{ Arn: secondLayerArn }, { Arn: layerArn }],
              Role: role,
              VpcConfig: {
                VpcId: 'vpc-xxxx',
                SecurityGroupIds: ['sg-111', 'sg-222'],
                SubnetIds: ['subnet-222', 'subnet-111'],
              },
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            kmsKeyArn,
            description,
            handler,
            environment: {
              VARIABLE: 'value',
            },
            name: functionName,
            memorySize,
            onError: onErrorHandler,
            role,
            timeout,
            vpc: {
              securityGroupIds: ['sg-111', 'sg-222'],
              subnetIds: ['subnet-111', 'subnet-222'],
            },
            layers: [layerArn, secondLayerArn],
          },
        },
      },
    });

    expect(updateFunctionConfigurationStub).not.to.be.called;
  });

  it('should not update function configuration if configuration includes console managed functions', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              KMSKeyArn: kmsKeyArn,
              Description: description,
              Handler: handler,
              State: 'Active',
              LastUpdateStatus: 'Successful',

              Environment: {
                Variables: {
                  ANOTHERVAR: 'anothervalue',
                  VARIABLE: 'value',
                  AWS_LAMBDA_EXEC_WRAPPER: '/opt/lib/libthundra-wrapper.so',
                  SLS_ORG_ID: '123',
                },
              },
              FunctionName: functionName,
              MemorySize: memorySize,
              DeadLetterConfig: {
                TargetArn: onErrorHandler,
              },
              Timeout: timeout,
              Layers: [{ Arn: secondLayerArn }, { Arn: layerArn }, { Arn: consoleLayerArn }],
              Role: role,
              VpcConfig: {
                VpcId: 'vpc-xxxx',
                SecurityGroupIds: ['sg-111', 'sg-222'],
                SubnetIds: ['subnet-222', 'subnet-111'],
              },
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            kmsKeyArn,
            description,
            handler,
            environment: {
              VARIABLE: 'value',
            },
            name: functionName,
            memorySize,
            onError: onErrorHandler,
            role,
            timeout,
            vpc: {
              securityGroupIds: ['sg-111', 'sg-222'],
              subnetIds: ['subnet-111', 'subnet-222'],
            },
            layers: [layerArn, secondLayerArn],
          },
        },
      },
    });
    expect(updateFunctionConfigurationStub).not.to.be.called;
  });

  it('should not update function configuration if configuration includes console managed layers locally', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              Description: description,
              Handler: handler,
              State: 'Active',
              LastUpdateStatus: 'Successful',

              Environment: {
                Variables: {
                  ANOTHERVAR: 'anothervalue',
                  VARIABLE: 'value',
                  AWS_LAMBDA_EXEC_WRAPPER: '/opt/lib/libthundra-wrapper.so',
                  SLS_ORG_ID: '123',
                },
              },
              FunctionName: functionName,
              MemorySize: memorySize,
              Layers: [{ Arn: secondLayerArn }, { Arn: layerArn }, { Arn: consoleLayerArn }],
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            description,
            handler,
            environment: {
              VARIABLE: 'value',
              AWS_LAMBDA_EXEC_WRAPPER: '/opt/lib/libthundra-wrapper.so',
              SLS_ORG_ID: '123',
            },
            name: functionName,
            memorySize,
            layers: [layerArn, secondLayerArn, consoleLayerArn],
          },
        },
      },
    });
    expect(updateFunctionConfigurationStub).not.to.be.called;
  });

  it('should not update function configuration if function is console managed and has reference layers', async () => {
    const runServerlessConfig = {
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              Description: description,
              Handler: handler,
              State: 'Active',
              LastUpdateStatus: 'Successful',
              Environment: {
                Variables: {
                  ANOTHERVAR: 'anothervalue',
                  VARIABLE: 'value',
                  AWS_LAMBDA_EXEC_WRAPPER: '/opt/lib/libthundra-wrapper.so',
                  SLS_ORG_ID: '123',
                },
              },
              FunctionName: functionName,
              MemorySize: memorySize,
              Layers: [{ Arn: layerArn }, { Arn: consoleLayerArn }],
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            description,
            handler,
            environment: {
              VARIABLE: 'value',
            },
            name: functionName,
            memorySize,
            layers: [layerArn, { Ref: 'TestLambdaLayer' }],
          },
        },
      },
    };

    await runServerless(runServerlessConfig);
    expect(updateFunctionConfigurationStub).not.to.be.called;
  });

  it('should not update function configuration if function has reference layers', async () => {
    const runServerlessConfig = {
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: {
            Configuration: {
              LastModified: '2020-05-20T15:34:16.494+0000',
              PackageType: 'Zip',
              Description: description,
              Handler: handler,
              State: 'Active',
              LastUpdateStatus: 'Successful',
              Environment: {
                Variables: {
                  ANOTHERVAR: 'anothervalue',
                  VARIABLE: 'value',
                },
              },
              FunctionName: functionName,
              MemorySize: memorySize,
              Layers: [{ Arn: layerArn }],
            },
          },
        },
      },
      configExt: {
        provider: {
          environment: {
            ANOTHERVAR: 'anothervalue',
          },
        },
        functions: {
          basic: {
            description,
            handler,
            environment: {
              VARIABLE: 'value',
            },
            name: functionName,
            memorySize,
            layers: [layerArn, { Ref: 'TestLambdaLayer' }],
          },
        },
      },
    };

    await runServerless(runServerlessConfig);
    expect(updateFunctionConfigurationStub).not.to.be.called;
  });

  it('configuration uses `provider.kmsKeyArn` if no `kmsKeyArn` provided on function level', async () => {
    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      lastLifecycleHookName: 'deploy:function:deploy',
      awsSdkV3StubMap,
      configExt: {
        provider: {
          kmsKeyArn: 'arn:aws:kms:us-east-1:oldKey',
        },
        functions: {
          basic: {
            handler: 'index.handler',
            name: 'foobar',
          },
        },
      },
    });

    expectUpdateFunctionConfigurationInput({
      Handler: 'index.handler',
      FunctionName: 'foobar',
      KMSKeyArn: 'arn:aws:kms:us-east-1:oldKey',
    });
  });

  it("should surface request error if it's not about function not being found", async () => {
    await expect(
      runServerless({
        fixture: 'function',
        command: 'deploy function',
        options: { function: 'basic' },
        lastLifecycleHookName: 'deploy:function:deploy',
        awsSdkV3StubMap: {
          ...awsSdkV3StubMap,
          Lambda: {
            ...awsSdkV3StubMap.Lambda,
            getFunction: () => {
              throw new Error('Some side error');
            },
          },
        },
      })
    ).to.be.eventually.rejectedWith('Some side error');
  });

  it('should surface meaningful error if function is not yet deployed', async () => {
    await expect(
      runServerless({
        fixture: 'function',
        command: 'deploy function',
        options: { function: 'basic' },
        lastLifecycleHookName: 'deploy:function:deploy',
        awsSdkV3StubMap: {
          ...awsSdkV3StubMap,
          Lambda: {
            ...awsSdkV3StubMap.Lambda,
            getFunction: () => {
              throw Object.assign(new Error('Function not found'), {
                name: 'ResourceNotFoundException',
              });
            },
          },
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'FUNCTION_NOT_YET_DEPLOYED');
  });

  it('should handle situation where function is not immediately in desired state', async () => {
    const successResponse = {
      Configuration: {
        LastModified: '2020-05-20T15:34:16.494+0000',
        State: 'Active',
        LastUpdateStatus: 'Successful',
      },
    };

    const getFunctionStub = sinon
      .stub()
      .resolves(successResponse)
      .onCall(1)
      .resolves({
        Configuration: {
          LastModified: '2020-05-20T15:34:16.494+0000',
          State: 'Active',
          LastUpdateStatus: 'InProgress',
        },
      })
      .onCall(2)
      .resolves(successResponse);

    await runServerless({
      fixture: 'function',
      command: 'deploy function',
      options: { function: 'basic' },
      lastLifecycleHookName: 'deploy:function:deploy',
      awsSdkV3StubMap: {
        ...awsSdkV3StubMap,
        Lambda: {
          ...awsSdkV3StubMap.Lambda,
          getFunction: getFunctionStub,
        },
      },
    });
    expect(getFunctionStub).to.have.been.calledThrice;
  });
});
