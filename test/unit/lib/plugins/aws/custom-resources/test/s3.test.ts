'use strict';

const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');
const utils = require('../../../../../../../lib/plugins/aws/custom-resources/resources/utils');

describe('Custom resource S3 permissions', () => {
  let sentCommands;
  let addPermission;
  let removePermission;

  beforeEach(() => {
    sentCommands = [];

    class LambdaClient {
      constructor() {
        this.config = {};
      }

      send(command) {
        sentCommands.push(command);
        return Promise.resolve();
      }
    }

    class AddPermissionCommand {
      constructor(input) {
        this.input = input;
      }
    }

    class RemovePermissionCommand {
      constructor(input) {
        this.input = input;
      }
    }

    ({ addPermission, removePermission } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/lib/permissions',
      {
        '@aws-sdk/client-lambda': {
          LambdaClient,
          AddPermissionCommand,
          RemovePermissionCommand,
        },
      }
    ));
  });

  it('should pass qualifier when adding Lambda permission', async () => {
    await addPermission({
      functionName: 'orders',
      functionQualifier: 'provisioned',
      bucketName: 'orders-bucket',
      partition: 'aws',
      region: 'us-east-1',
      accountId: '123456789012',
    });

    expect(sentCommands[0].input).to.include({
      FunctionName: 'orders',
      Qualifier: 'provisioned',
    });
  });

  it('should pass qualifier when removing Lambda permission', async () => {
    await removePermission({
      functionName: 'orders',
      functionQualifier: 'provisioned',
      bucketName: 'orders-bucket',
      region: 'us-east-1',
    });

    expect(sentCommands[0].input).to.include({
      FunctionName: 'orders',
      Qualifier: 'provisioned',
    });
  });
});

describe('Custom resource S3 handler', () => {
  function getStatementId(functionName, bucketName) {
    return `${functionName}-${bucketName.replace(/[.:*]/g, '')}`;
  }

  function makeHandler({
    addPermission = sinon.stub().resolves(),
    updateConfiguration = sinon.stub().resolves(),
    removePermission = sinon.stub().resolves(),
    removeConfiguration = sinon.stub().resolves(),
    getStatementId: resolveStatementId = getStatementId,
  } = {}) {
    const { handler } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/handler',
      {
        '../utils': {
          ...utils,
          getEnvironment: () => ({
            Partition: 'aws',
            Region: 'us-east-1',
            AccountId: '123456789012',
          }),
          handlerWrapper: (wrappedHandler) => wrappedHandler,
        },
        './lib/permissions': {
          addPermission,
          removePermission,
          getStatementId: resolveStatementId,
        },
        './lib/bucket': { updateConfiguration, removeConfiguration },
      }
    );

    return { handler, addPermission, updateConfiguration, removePermission, removeConfiguration };
  }

  it('should not churn Lambda permission on same-target ForceDeploy updates', async () => {
    const { handler, addPermission, updateConfiguration, removePermission } = makeHandler();

    await handler(
      {
        RequestType: 'Update',
        ResourceProperties: {
          FunctionName: 'orders',
          BucketName: 'orders-bucket',
          BucketConfigs: [],
          ForceDeploy: 'new',
        },
        OldResourceProperties: {
          FunctionName: 'orders',
          BucketName: 'orders-bucket',
          BucketConfigs: [],
          ForceDeploy: 'old',
        },
      },
      {}
    );

    expect(addPermission).to.not.have.been.called;
    expect(updateConfiguration).to.have.been.calledOnce;
    expect(removePermission).to.not.have.been.called;
  });

  it('should remove and re-add conflicting Lambda permission on create', async () => {
    const calls = [];
    const addPermission = sinon.stub();
    addPermission.onFirstCall().callsFake(async (input) => {
      calls.push(['addPermission', input]);
      throw Object.assign(new Error('permission exists'), {
        name: 'ResourceConflictException',
      });
    });
    addPermission.onSecondCall().callsFake(async (input) => {
      calls.push(['addPermission', input]);
    });
    const updateConfiguration = sinon.stub().callsFake(async (input) => {
      calls.push(['updateConfiguration', input]);
    });
    const removePermission = sinon.stub().callsFake(async (input) => {
      calls.push(['removePermission', input]);
    });
    const { handler } = makeHandler({ addPermission, updateConfiguration, removePermission });

    await handler(
      {
        RequestType: 'Create',
        ResourceProperties: {
          FunctionName: 'orders',
          FunctionQualifier: 'provisioned',
          BucketName: 'orders-bucket',
          BucketConfigs: [],
        },
      },
      {}
    );

    expect(addPermission).to.have.been.calledTwice;
    expect(removePermission).to.have.been.calledOnce;
    expect(removePermission.args[0][0]).to.include({
      functionName: 'orders',
      functionQualifier: 'provisioned',
      bucketName: 'orders-bucket',
    });
    expect(calls.map(([name]) => name)).to.deep.equal([
      'addPermission',
      'removePermission',
      'addPermission',
      'updateConfiguration',
    ]);
  });

  it('should rethrow non-conflict Lambda permission add errors', async () => {
    const addPermission = sinon
      .stub()
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    const { handler, updateConfiguration, removePermission } = makeHandler({ addPermission });

    await expect(
      handler(
        {
          RequestType: 'Create',
          ResourceProperties: {
            FunctionName: 'orders',
            BucketName: 'orders-bucket',
            BucketConfigs: [],
          },
        },
        {}
      )
    ).to.be.rejectedWith('denied');

    expect(removePermission).to.not.have.been.called;
    expect(updateConfiguration).to.not.have.been.called;
  });

  it('should add qualified permission before migrating existing notification target', async () => {
    const calls = [];
    const addPermission = sinon.stub().callsFake(async (input) => {
      calls.push(['addPermission', input]);
    });
    const updateConfiguration = sinon.stub().callsFake(async (input) => {
      calls.push(['updateConfiguration', input]);
    });
    const removePermission = sinon.stub().callsFake(async (input) => {
      calls.push(['removePermission', input]);
    });
    const removeConfiguration = sinon.stub().resolves();

    const { handler } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/handler',
      {
        '../utils': {
          ...utils,
          getEnvironment: () => ({
            Partition: 'aws',
            Region: 'us-east-1',
            AccountId: '123456789012',
          }),
          handlerWrapper: (wrappedHandler) => wrappedHandler,
        },
        './lib/permissions': { addPermission, removePermission },
        './lib/bucket': { updateConfiguration, removeConfiguration },
      }
    );

    await handler(
      {
        RequestType: 'Update',
        ResourceProperties: {
          FunctionName: 'orders',
          FunctionQualifier: 'provisioned',
          BucketName: 'orders-bucket',
          BucketConfigs: [],
        },
        OldResourceProperties: {
          FunctionName: 'orders',
          BucketName: 'orders-bucket',
          BucketConfigs: [],
        },
      },
      {}
    );

    expect(addPermission).to.have.been.calledOnce;
    expect(addPermission.args[0][0]).to.include({
      functionName: 'orders',
      functionQualifier: 'provisioned',
      bucketName: 'orders-bucket',
    });
    expect(updateConfiguration.args[0][0]).to.include({
      lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders:provisioned',
      functionName: 'orders',
      bucketName: 'orders-bucket',
    });
    expect(removePermission.args[0][0]).to.include({
      functionName: 'orders',
      bucketName: 'orders-bucket',
    });
    expect(removePermission.args[0][0]).to.have.property('functionQualifier', undefined);
    expect(removeConfiguration).to.not.have.been.called;
    expect(calls.map(([name]) => name)).to.deep.equal([
      'addPermission',
      'updateConfiguration',
      'removePermission',
    ]);
  });

  it('should remove old same-bucket function notifications in the update put', async () => {
    const updateConfiguration = sinon.stub().resolves();
    const removeConfiguration = sinon.stub().resolves();
    const { handler } = makeHandler({ updateConfiguration, removeConfiguration });

    await handler(
      {
        RequestType: 'Update',
        ResourceProperties: {
          FunctionName: 'orders-v2',
          BucketName: 'orders-bucket',
          BucketConfigs: [],
        },
        OldResourceProperties: {
          FunctionName: 'orders-v1',
          BucketName: 'orders-bucket',
          BucketConfigs: [],
        },
      },
      {}
    );

    expect(updateConfiguration.args[0][0]).to.include({
      functionName: 'orders-v2',
      previousFunctionName: 'orders-v1',
      bucketName: 'orders-bucket',
    });
    expect(removeConfiguration).to.not.have.been.called;
  });

  it('should remove old function notifications from the new bucket during rename and bucket migration', async () => {
    const updateConfiguration = sinon.stub().resolves();
    const removeConfiguration = sinon.stub().resolves();
    const { handler } = makeHandler({ updateConfiguration, removeConfiguration });

    await handler(
      {
        RequestType: 'Update',
        ResourceProperties: {
          FunctionName: 'orders-v2',
          BucketName: 'new-orders-bucket',
          BucketConfigs: [],
        },
        OldResourceProperties: {
          FunctionName: 'orders-v1',
          BucketName: 'old-orders-bucket',
          BucketConfigs: [],
        },
      },
      {}
    );

    expect(updateConfiguration.args[0][0]).to.include({
      functionName: 'orders-v2',
      previousFunctionName: 'orders-v1',
      bucketName: 'new-orders-bucket',
    });
    expect(removeConfiguration).to.have.been.calledOnceWithExactly({
      region: 'us-east-1',
      functionName: 'orders-v1',
      bucketName: 'old-orders-bucket',
    });
  });

  it('should clean up old notification target only when the bucket changes', async () => {
    const removeConfiguration = sinon.stub().resolves();
    const { handler, updateConfiguration, removePermission } = makeHandler({
      removeConfiguration,
    });

    await handler(
      {
        RequestType: 'Update',
        ResourceProperties: {
          FunctionName: 'orders',
          BucketName: 'new-orders-bucket',
          BucketConfigs: [],
        },
        OldResourceProperties: {
          FunctionName: 'orders',
          BucketName: 'old-orders-bucket',
          BucketConfigs: [],
        },
      },
      {}
    );

    expect(updateConfiguration.args[0][0]).to.have.property('previousFunctionName', undefined);
    expect(removeConfiguration).to.have.been.calledOnceWithExactly({
      region: 'us-east-1',
      functionName: 'orders',
      bucketName: 'old-orders-bucket',
    });
    expect(removePermission).to.have.been.calledOnce;
    expect(removePermission.args[0][0]).to.include({
      functionName: 'orders',
      bucketName: 'old-orders-bucket',
      region: 'us-east-1',
    });
  });

  it('should not remove old permission when migrated buckets share a statement ID', async () => {
    const removeConfiguration = sinon.stub().resolves();
    const { handler, removePermission } = makeHandler({ removeConfiguration });

    await handler(
      {
        RequestType: 'Update',
        ResourceProperties: {
          FunctionName: 'orders',
          BucketName: 'ordersbucket',
          BucketConfigs: [],
        },
        OldResourceProperties: {
          FunctionName: 'orders',
          BucketName: 'orders.bucket',
          BucketConfigs: [],
        },
      },
      {}
    );

    expect(removeConfiguration).to.have.been.calledOnceWithExactly({
      region: 'us-east-1',
      functionName: 'orders',
      bucketName: 'orders.bucket',
    });
    expect(removePermission).to.not.have.been.called;
  });

  it('should tolerate missing old bucket while cleaning up migrated notification target', async () => {
    const removeConfiguration = sinon.stub().rejects({ name: 'NoSuchBucket' });
    const { handler } = makeHandler({ removeConfiguration });

    await handler(
      {
        RequestType: 'Update',
        ResourceProperties: {
          FunctionName: 'orders',
          BucketName: 'new-orders-bucket',
          BucketConfigs: [],
        },
        OldResourceProperties: {
          FunctionName: 'orders',
          BucketName: 'old-orders-bucket',
          BucketConfigs: [],
        },
      },
      {}
    );

    expect(removeConfiguration).to.have.been.calledOnce;
  });

  it('should tolerate denied old bucket cleanup after updating the new notification target', async () => {
    const removeConfiguration = sinon
      .stub()
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    const log = sinon.stub(console, 'log');
    const { handler } = makeHandler({ removeConfiguration });

    try {
      await handler(
        {
          RequestType: 'Update',
          ResourceProperties: {
            FunctionName: 'orders',
            BucketName: 'new-orders-bucket',
            BucketConfigs: [],
          },
          OldResourceProperties: {
            FunctionName: 'orders',
            BucketName: 'old-orders-bucket',
            BucketConfigs: [],
          },
        },
        {}
      );
    } finally {
      log.restore();
    }

    expect(removeConfiguration).to.have.been.calledOnce;
    expect(log).to.have.been.calledWith(
      'Skipping S3 notification cleanup after AccessDenied; stale configuration may remain on the old bucket.'
    );
  });

  it('should reject denied new notification target updates', async () => {
    const updateConfiguration = sinon
      .stub()
      .rejects(Object.assign(new Error('denied new bucket'), { name: 'AccessDenied' }));
    const removeConfiguration = sinon.stub().resolves();
    const { handler } = makeHandler({ updateConfiguration, removeConfiguration });

    await expect(
      handler(
        {
          RequestType: 'Update',
          ResourceProperties: {
            FunctionName: 'orders',
            BucketName: 'new-orders-bucket',
            BucketConfigs: [],
          },
          OldResourceProperties: {
            FunctionName: 'orders',
            BucketName: 'old-orders-bucket',
            BucketConfigs: [],
          },
        },
        {}
      )
    ).to.be.rejectedWith('denied new bucket');

    expect(removeConfiguration).to.not.have.been.called;
  });

  it('should reject denied old Lambda permission cleanup during migration', async () => {
    const removePermission = sinon
      .stub()
      .rejects(Object.assign(new Error('denied permission'), { name: 'AccessDeniedException' }));
    const { handler } = makeHandler({ removePermission });

    await expect(
      handler(
        {
          RequestType: 'Update',
          ResourceProperties: {
            FunctionName: 'orders',
            BucketName: 'new-orders-bucket',
            BucketConfigs: [],
          },
          OldResourceProperties: {
            FunctionName: 'orders',
            BucketName: 'old-orders-bucket',
            BucketConfigs: [],
          },
        },
        {}
      )
    ).to.be.rejectedWith('denied permission');
  });

  it('should continue migration when qualified permission already exists', async () => {
    const calls = [];
    const addPermission = sinon.stub();
    addPermission.onFirstCall().callsFake(async (input) => {
      calls.push(['addPermission', input]);
      throw Object.assign(new Error('permission exists'), {
        name: 'ResourceConflictException',
      });
    });
    addPermission.onSecondCall().callsFake(async (input) => {
      calls.push(['addPermission', input]);
    });
    const updateConfiguration = sinon.stub().callsFake(async (input) => {
      calls.push(['updateConfiguration', input]);
    });
    const removePermission = sinon.stub().callsFake(async (input) => {
      calls.push(['removePermission', input]);
    });
    const removeConfiguration = sinon.stub().resolves();

    const { handler } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/handler',
      {
        '../utils': {
          ...utils,
          getEnvironment: () => ({
            Partition: 'aws',
            Region: 'us-east-1',
            AccountId: '123456789012',
          }),
          handlerWrapper: (wrappedHandler) => wrappedHandler,
        },
        './lib/permissions': { addPermission, removePermission, getStatementId },
        './lib/bucket': { updateConfiguration, removeConfiguration },
      }
    );

    await handler(
      {
        RequestType: 'Update',
        ResourceProperties: {
          FunctionName: 'orders',
          FunctionQualifier: 'provisioned',
          BucketName: 'orders-bucket',
          BucketConfigs: [],
        },
        OldResourceProperties: {
          FunctionName: 'orders',
          BucketName: 'orders-bucket',
          BucketConfigs: [],
        },
      },
      {}
    );

    expect(addPermission).to.have.been.calledTwice;
    expect(updateConfiguration).to.have.been.calledOnce;
    expect(removePermission).to.have.been.calledTwice;
    expect(removePermission.args[0][0]).to.include({
      functionName: 'orders',
      functionQualifier: 'provisioned',
      bucketName: 'orders-bucket',
    });
    expect(removePermission.args[1][0]).to.include({
      functionName: 'orders',
      bucketName: 'orders-bucket',
    });
    expect(removePermission.args[1][0]).to.have.property('functionQualifier', undefined);
    expect(calls.map(([name]) => name)).to.deep.equal([
      'addPermission',
      'removePermission',
      'addPermission',
      'updateConfiguration',
      'removePermission',
    ]);
  });

  it('should remove notification configuration when Lambda permission is already missing', async () => {
    const addPermission = sinon.stub().resolves();
    const updateConfiguration = sinon.stub().resolves();
    const removePermission = sinon.stub().rejects({ name: 'ResourceNotFoundException' });
    const removeConfiguration = sinon.stub().resolves();

    const { handler } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/handler',
      {
        '../utils': {
          ...utils,
          getEnvironment: () => ({
            Partition: 'aws',
            Region: 'us-east-1',
            AccountId: '123456789012',
          }),
          handlerWrapper: (wrappedHandler) => wrappedHandler,
        },
        './lib/permissions': { addPermission, removePermission },
        './lib/bucket': { updateConfiguration, removeConfiguration },
      }
    );

    await handler(
      {
        RequestType: 'Delete',
        ResourceProperties: {
          FunctionName: 'orders',
          FunctionQualifier: 'provisioned',
          BucketName: 'orders-bucket',
        },
      },
      {}
    );

    expect(removeConfiguration).to.have.been.calledOnce;
  });

  it('should ignore NoSuchBucket while deleting notification configuration', async () => {
    const addPermission = sinon.stub().resolves();
    const updateConfiguration = sinon.stub().resolves();
    const removePermission = sinon.stub().resolves();
    const removeConfiguration = sinon.stub().rejects({ name: 'NoSuchBucket' });

    const { handler } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/handler',
      {
        '../utils': {
          ...utils,
          getEnvironment: () => ({
            Partition: 'aws',
            Region: 'us-east-1',
            AccountId: '123456789012',
          }),
          handlerWrapper: (wrappedHandler) => wrappedHandler,
        },
        './lib/permissions': { addPermission, removePermission },
        './lib/bucket': { updateConfiguration, removeConfiguration },
      }
    );

    await handler(
      {
        RequestType: 'Delete',
        ResourceProperties: {
          FunctionName: 'orders',
          FunctionQualifier: 'provisioned',
          BucketName: 'orders-bucket',
        },
      },
      {}
    );

    expect(removeConfiguration).to.have.been.calledOnce;
  });

  it('should rethrow AccessDeniedException when removing Lambda permission during delete', async () => {
    const addPermission = sinon.stub().resolves();
    const updateConfiguration = sinon.stub().resolves();
    const removePermission = sinon
      .stub()
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    const removeConfiguration = sinon.stub().resolves();

    const { handler } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/handler',
      {
        '../utils': {
          ...utils,
          getEnvironment: () => ({
            Partition: 'aws',
            Region: 'us-east-1',
            AccountId: '123456789012',
          }),
          handlerWrapper: (wrappedHandler) => wrappedHandler,
        },
        './lib/permissions': { addPermission, removePermission },
        './lib/bucket': { updateConfiguration, removeConfiguration },
      }
    );

    await expect(
      handler(
        {
          RequestType: 'Delete',
          ResourceProperties: {
            FunctionName: 'orders',
            FunctionQualifier: 'provisioned',
            BucketName: 'orders-bucket',
          },
        },
        {}
      )
    ).to.be.rejectedWith('denied');

    expect(removeConfiguration).to.not.have.been.called;
  });

  it('should tolerate AccessDenied when removing notification configuration during delete', async () => {
    const addPermission = sinon.stub().resolves();
    const updateConfiguration = sinon.stub().resolves();
    const removePermission = sinon.stub().resolves();
    const removeConfiguration = sinon
      .stub()
      .rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    const log = sinon.stub(console, 'log');

    const { handler } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/handler',
      {
        '../utils': {
          ...utils,
          getEnvironment: () => ({
            Partition: 'aws',
            Region: 'us-east-1',
            AccountId: '123456789012',
          }),
          handlerWrapper: (wrappedHandler) => wrappedHandler,
        },
        './lib/permissions': { addPermission, removePermission },
        './lib/bucket': { updateConfiguration, removeConfiguration },
      }
    );

    try {
      await handler(
        {
          RequestType: 'Delete',
          ResourceProperties: {
            FunctionName: 'orders',
            FunctionQualifier: 'provisioned',
            BucketName: 'orders-bucket',
          },
        },
        {}
      );
    } finally {
      log.restore();
    }

    expect(removeConfiguration).to.have.been.calledOnce;
  });
});

describe('Custom resource S3 bucket configuration', () => {
  it('should only replace owned notification configurations', async () => {
    const sentCommands = [];

    class S3Client {
      constructor() {
        this.config = {};
      }

      send(command) {
        sentCommands.push(command);
        if (command.constructor.name === 'GetBucketNotificationConfigurationCommand') {
          return Promise.resolve({
            LambdaFunctionConfigurations: [
              {
                Id: `orders-${'a'.repeat(32)}`,
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders',
              },
              {
                Id: `orders-api-${'b'.repeat(32)}`,
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders-api',
              },
              {
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:external',
              },
            ],
          });
        }
        return Promise.resolve();
      }
    }

    class GetBucketNotificationConfigurationCommand {
      constructor(input) {
        this.input = input;
      }
    }

    class PutBucketNotificationConfigurationCommand {
      constructor(input) {
        this.input = input;
      }
    }

    const { updateConfiguration } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/lib/bucket',
      {
        '@aws-sdk/client-s3': {
          S3Client,
          GetBucketNotificationConfigurationCommand,
          PutBucketNotificationConfigurationCommand,
        },
      }
    );

    await updateConfiguration({
      lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders:provisioned',
      functionName: 'orders',
      bucketName: 'orders-bucket',
      bucketConfigs: [{ Event: 's3:ObjectCreated:*', Rules: [] }],
      region: 'us-east-1',
    });

    const putInput = sentCommands[1].input;
    const configs = putInput.NotificationConfiguration.LambdaFunctionConfigurations;

    expect(configs).to.have.length(3);
    expect(configs.map((config) => config.LambdaFunctionArn)).to.deep.equal([
      'arn:aws:lambda:us-east-1:123456789012:function:orders-api',
      'arn:aws:lambda:us-east-1:123456789012:function:external',
      'arn:aws:lambda:us-east-1:123456789012:function:orders:provisioned',
    ]);
  });

  it('should replace current and previous owned notification configurations', async () => {
    const sentCommands = [];

    class S3Client {
      constructor() {
        this.config = {};
      }

      send(command) {
        sentCommands.push(command);
        if (command.constructor.name === 'GetBucketNotificationConfigurationCommand') {
          return Promise.resolve({
            LambdaFunctionConfigurations: [
              {
                Id: `orders-v2-${'a'.repeat(32)}`,
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders-v2-old',
              },
              {
                Id: `orders-v1-${'b'.repeat(32)}`,
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders-v1',
              },
              {
                Id: `orders-v2-api-${'c'.repeat(32)}`,
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders-v2-api',
              },
              {
                Id: 'orders-v1-manual',
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:manual',
              },
              {
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:external',
              },
            ],
          });
        }
        return Promise.resolve();
      }
    }

    class GetBucketNotificationConfigurationCommand {
      constructor(input) {
        this.input = input;
      }
    }

    class PutBucketNotificationConfigurationCommand {
      constructor(input) {
        this.input = input;
      }
    }

    const { updateConfiguration } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/lib/bucket',
      {
        '@aws-sdk/client-s3': {
          S3Client,
          GetBucketNotificationConfigurationCommand,
          PutBucketNotificationConfigurationCommand,
        },
      }
    );

    await updateConfiguration({
      lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders-v2',
      functionName: 'orders-v2',
      previousFunctionName: 'orders-v1',
      bucketName: 'orders-bucket',
      bucketConfigs: [{ Event: 's3:ObjectCreated:*', Rules: [] }],
      region: 'us-east-1',
    });

    const putInput = sentCommands[1].input;
    const configs = putInput.NotificationConfiguration.LambdaFunctionConfigurations;

    expect(configs).to.have.length(4);
    expect(configs.map((config) => config.LambdaFunctionArn)).to.deep.equal([
      'arn:aws:lambda:us-east-1:123456789012:function:orders-v2-api',
      'arn:aws:lambda:us-east-1:123456789012:function:manual',
      'arn:aws:lambda:us-east-1:123456789012:function:external',
      'arn:aws:lambda:us-east-1:123456789012:function:orders-v2',
    ]);
  });

  it('should only remove owned notification configurations', async () => {
    const sentCommands = [];

    class S3Client {
      constructor() {
        this.config = {};
      }

      send(command) {
        sentCommands.push(command);
        if (command.constructor.name === 'GetBucketNotificationConfigurationCommand') {
          return Promise.resolve({
            LambdaFunctionConfigurations: [
              {
                Id: `orders-${'a'.repeat(32)}`,
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders',
              },
              {
                Id: `orders-api-${'b'.repeat(32)}`,
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:orders-api',
              },
              {
                Id: 'orders-manual',
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:manual',
              },
              {
                LambdaFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:external',
              },
            ],
          });
        }
        return Promise.resolve();
      }
    }

    class GetBucketNotificationConfigurationCommand {
      constructor(input) {
        this.input = input;
      }
    }

    class PutBucketNotificationConfigurationCommand {
      constructor(input) {
        this.input = input;
      }
    }

    const { removeConfiguration } = proxyquire(
      '../../../../../../../lib/plugins/aws/custom-resources/resources/s3/lib/bucket',
      {
        '@aws-sdk/client-s3': {
          S3Client,
          GetBucketNotificationConfigurationCommand,
          PutBucketNotificationConfigurationCommand,
        },
      }
    );

    await removeConfiguration({
      functionName: 'orders',
      bucketName: 'orders-bucket',
      region: 'us-east-1',
    });

    const putInput = sentCommands[1].input;
    const configs = putInput.NotificationConfiguration.LambdaFunctionConfigurations;

    expect(configs.map((config) => config.LambdaFunctionArn)).to.deep.equal([
      'arn:aws:lambda:us-east-1:123456789012:function:orders-api',
      'arn:aws:lambda:us-east-1:123456789012:function:manual',
      'arn:aws:lambda:us-east-1:123456789012:function:external',
    ]);
  });
});
