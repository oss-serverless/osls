'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();
const sinon = require('sinon');
const utils = require('../../../../../../../lib/plugins/aws/custom-resources/resources/utils');

describe('Custom resource Cognito user pool handler lifecycle', () => {
  const context = {
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:custom-resource',
  };

  const makeHandler = ({
    findUserPoolByName = sinon.stub().resolves({ Id: 'us-east-1_abc123' }),
    addPermission = sinon.stub().resolves(),
    removePermission = sinon.stub().resolves(),
    updateConfiguration = sinon.stub().resolves(),
    removeConfiguration = sinon.stub().resolves(),
  } = {}) => ({
    handler: proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/cognito-user-pool/handler',
      {
        '../utils': {
          ...utils,
          handlerWrapper: (wrappedHandler) => wrappedHandler,
        },
        './lib/permissions': { addPermission, removePermission },
        './lib/user-pool': {
          findUserPoolByName,
          updateConfiguration,
          removeConfiguration,
        },
      }
    ).handler,
    findUserPoolByName,
    addPermission,
    removePermission,
    updateConfiguration,
    removeConfiguration,
  });

  it('should reject create with a descriptive missing-pool error', async () => {
    const findUserPoolByName = sinon.stub().resolves(null);
    const addPermission = sinon.stub().resolves();
    const { handler } = makeHandler({ findUserPoolByName, addPermission });

    await expect(
      handler(
        {
          RequestType: 'Create',
          ResourceProperties: {
            FunctionName: 'orders',
            UserPoolName: 'orders-pool',
            UserPoolConfigs: [{ Trigger: 'PreSignUp' }],
          },
        },
        context
      )
    ).to.be.rejectedWith('Could not find Cognito User Pool "orders-pool"');

    expect(addPermission).to.not.have.been.called;
  });

  it('should add permission before updating the user pool on create', async () => {
    const calls = [];
    const findUserPoolByName = sinon.stub().resolves({ Id: 'us-east-1_abc123' });
    const addPermission = sinon.stub().callsFake(async () => calls.push('addPermission'));
    const updateConfiguration = sinon
      .stub()
      .callsFake(async () => calls.push('updateConfiguration'));
    const { handler } = makeHandler({
      findUserPoolByName,
      addPermission,
      updateConfiguration,
    });

    await handler(
      {
        RequestType: 'Create',
        ResourceProperties: {
          FunctionName: 'orders',
          UserPoolName: 'orders-pool',
          UserPoolConfigs: [{ Trigger: 'PreSignUp' }],
        },
      },
      context
    );

    expect(calls).to.deep.equal(['addPermission', 'updateConfiguration']);
    expect(addPermission.args[0][0]).to.include({
      functionName: 'orders',
      userPoolName: 'orders-pool',
      userPoolId: 'us-east-1_abc123',
    });
  });

  it('should remove trigger configuration when Lambda permission is already missing', async () => {
    const removePermission = sinon.stub().rejects({ name: 'ResourceNotFoundException' });
    const removeConfiguration = sinon.stub().resolves();
    const { handler } = makeHandler({ removePermission, removeConfiguration });

    await handler(
      {
        RequestType: 'Delete',
        ResourceProperties: {
          FunctionName: 'orders',
          UserPoolName: 'orders-pool',
        },
      },
      context
    );

    expect(removePermission).to.have.been.calledOnce;
    expect(removeConfiguration).to.have.been.calledOnce;
  });

  it('should rethrow AccessDeniedException when removing Lambda permission during delete', async () => {
    const removePermission = sinon
      .stub()
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    const removeConfiguration = sinon.stub().resolves();
    const { handler } = makeHandler({ removePermission, removeConfiguration });

    await expect(
      handler(
        {
          RequestType: 'Delete',
          ResourceProperties: {
            FunctionName: 'orders',
            UserPoolName: 'orders-pool',
          },
        },
        context
      )
    ).to.be.rejectedWith('denied');

    expect(removeConfiguration).to.not.have.been.called;
  });
});

describe('Custom resource Cognito user pool configuration', () => {
  const makeUserPoolLib = (responses) => {
    const sentCommands = [];

    class CognitoIdentityProviderClient {
      constructor() {
        this.config = {};
      }

      send(command) {
        sentCommands.push(command);
        const response = responses.shift();
        if (response instanceof Error) return Promise.reject(response);
        return Promise.resolve(response);
      }
    }

    class ListUserPoolsCommand {
      constructor(input) {
        this.input = input;
      }
    }

    class DescribeUserPoolCommand {
      constructor(input) {
        this.input = input;
      }
    }

    class UpdateUserPoolCommand {
      constructor(input) {
        this.input = input;
      }
    }

    return {
      sentCommands,
      lib: proxyquire(
        '../../../../../../../lib/plugins/aws/custom-resources/resources/cognito-user-pool/lib/user-pool',
        {
          '@aws-sdk/client-cognito-identity-provider': {
            CognitoIdentityProviderClient,
            ListUserPoolsCommand,
            DescribeUserPoolCommand,
            UpdateUserPoolCommand,
          },
        }
      ),
    };
  };

  it('should reject update with a descriptive missing-pool error', async () => {
    const { lib } = makeUserPoolLib([{ UserPools: [] }]);

    await expect(
      lib.updateConfiguration({
        lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders',
        userPoolName: 'orders-pool',
        userPoolConfigs: [{ Trigger: 'PreSignUp' }],
        region: 'us-east-1',
      })
    ).to.be.rejectedWith('Could not find Cognito User Pool "orders-pool"');
  });

  it('should configure the InboundFederation trigger with its Lambda version', async () => {
    const { sentCommands, lib } = makeUserPoolLib([
      { UserPools: [{ Id: 'us-east-1_orders', Name: 'orders-pool' }] },
      {
        UserPool: {
          Id: 'us-east-1_orders',
          Name: 'orders-pool',
          LambdaConfig: {
            PreSignUp: 'arn:aws:lambda:us-east-1:123456789012:function:signup',
          },
          Policies: { PasswordPolicy: {} },
          AdminCreateUserConfig: {},
        },
      },
      {},
    ]);

    await lib.updateConfiguration({
      lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders',
      userPoolName: 'orders-pool',
      userPoolConfigs: [{ Trigger: 'InboundFederation', LambdaVersion: 'V1_0' }],
      region: 'us-east-1',
    });

    expect(sentCommands.map((command) => command.constructor.name)).to.deep.equal([
      'ListUserPoolsCommand',
      'DescribeUserPoolCommand',
      'UpdateUserPoolCommand',
    ]);
    expect(sentCommands[2].input.LambdaConfig).to.deep.equal({
      PreSignUp: 'arn:aws:lambda:us-east-1:123456789012:function:signup',
      InboundFederation: {
        LambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders',
        LambdaVersion: 'V1_0',
      },
    });
  });

  it('should remove only the InboundFederation trigger owned by the function', async () => {
    const { sentCommands, lib } = makeUserPoolLib([
      { UserPools: [{ Id: 'us-east-1_orders', Name: 'orders-pool' }] },
      {
        UserPool: {
          Id: 'us-east-1_orders',
          Name: 'orders-pool',
          LambdaConfig: {
            PreSignUp: 'arn:aws:lambda:us-east-1:123456789012:function:signup',
            PreTokenGenerationConfig: {
              LambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:tokens',
              LambdaVersion: 'V2_0',
            },
            InboundFederation: {
              LambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders',
              LambdaVersion: 'V1_0',
            },
          },
          Policies: { PasswordPolicy: {} },
          AdminCreateUserConfig: {},
        },
      },
      {},
    ]);

    await lib.removeConfiguration({
      lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders',
      userPoolName: 'orders-pool',
      region: 'us-east-1',
    });

    expect(sentCommands.map((command) => command.constructor.name)).to.deep.equal([
      'ListUserPoolsCommand',
      'DescribeUserPoolCommand',
      'UpdateUserPoolCommand',
    ]);
    expect(sentCommands[2].input.LambdaConfig).to.deep.equal({
      PreSignUp: 'arn:aws:lambda:us-east-1:123456789012:function:signup',
      PreTokenGenerationConfig: {
        LambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:tokens',
        LambdaVersion: 'V2_0',
      },
    });
  });

  it('should no-op delete when the target user pool no longer exists', async () => {
    const { sentCommands, lib } = makeUserPoolLib([{ UserPools: [] }]);

    await lib.removeConfiguration({
      lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders',
      userPoolName: 'orders-pool',
      region: 'us-east-1',
    });

    expect(sentCommands.map((command) => command.constructor.name)).to.deep.equal([
      'ListUserPoolsCommand',
    ]);
  });
});
