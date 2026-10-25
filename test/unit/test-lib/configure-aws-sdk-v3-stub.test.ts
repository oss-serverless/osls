'use strict';

const { PassThrough } = require('node:stream');
const { expect } = require('chai');
const configureAwsSdkV3Stub = require('../../lib/configure-aws-sdk-v3-stub');
const { createDeployAwsStubMap } = require('../../utils/aws-stub-maps');

describe('test/unit/test-lib/configure-aws-sdk-v3-stub.test.js', () => {
  it('stubs client commands and records send context', async () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      S3: {
        headBucket: { BucketRegion: 'us-east-1' },
      },
    });
    const { S3Client, HeadBucketCommand } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];

    const client = new S3Client({ region: 'us-east-1' });
    const result = await client.send(new HeadBucketCommand({ Bucket: 'bucket' }));

    expect(result).to.deep.equal({ BucketRegion: 'us-east-1' });
    expect(awsSdkV3Stub.clients).to.have.length(1);
    expect(awsSdkV3Stub.clients[0]).to.include({ service: 'S3', client });
    expect(awsSdkV3Stub.sends).to.have.length(1);
    expect(awsSdkV3Stub.sends[0]).to.include({
      service: 'S3',
      method: 'headBucket',
      commandName: 'HeadBucketCommand',
      client,
    });
    expect(awsSdkV3Stub.sends[0].input).to.deep.equal({ Bucket: 'bucket' });
  });

  it('uses fresh deploy stub-map factory objects with strict callback context', async () => {
    const firstStubMap = createDeployAwsStubMap();
    const secondStubMap = createDeployAwsStubMap({
      CloudFormation: {
        describeStacks: { Stacks: [] },
      },
      S3: {
        headBucket: (input, context) => {
          expect(context.service).to.equal('S3');
          expect(context.method).to.equal('headBucket');
          expect(context.commandName).to.equal('HeadBucketCommand');
          expect(input).to.deep.equal({ Bucket: 'deployment-bucket' });
          return { BucketRegion: 'us-east-1' };
        },
      },
    });

    firstStubMap.S3.listObjectsV2.Contents.push({ Key: 'first' });

    expect(secondStubMap.S3.listObjectsV2.Contents).to.deep.equal([]);
    expect(secondStubMap.CloudFormation.describeStacks.Stacks).to.deep.equal([]);

    const awsSdkV3Stub = configureAwsSdkV3Stub(secondStubMap);
    const { S3Client, HeadBucketCommand } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];
    const client = new S3Client({ region: 'us-east-1' });

    const result = await client.send(new HeadBucketCommand({ Bucket: 'deployment-bucket' }));

    expect(result).to.deep.equal({ BucketRegion: 'us-east-1' });
    expect(awsSdkV3Stub.sends.map(({ service, method }) => `${service}.${method}`)).to.deep.equal([
      'S3.headBucket',
    ]);
  });

  it('routes paginator pages through client send with continuation tokens', async () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      S3: {
        listObjectsV2: [
          { Contents: [{ Key: 'first' }], NextContinuationToken: 'next-page' },
          { Contents: [{ Key: 'second' }] },
        ],
      },
    });
    const { S3Client, ListObjectsV2Command, paginateListObjectsV2 } =
      awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];
    const client = new S3Client({ region: 'us-east-1' });

    const pages = [];
    for await (const page of paginateListObjectsV2(
      { client },
      { Bucket: 'bucket', Prefix: 'prefix' }
    )) {
      pages.push(page);
    }

    expect(pages).to.deep.equal([
      { Contents: [{ Key: 'first' }], NextContinuationToken: 'next-page' },
      { Contents: [{ Key: 'second' }] },
    ]);
    expect(awsSdkV3Stub.sends).to.have.length(2);
    expect(awsSdkV3Stub.sends[0].command).to.be.instanceOf(ListObjectsV2Command);
    expect(awsSdkV3Stub.sends[0].input).to.deep.equal({
      Bucket: 'bucket',
      Prefix: 'prefix',
    });
    expect(awsSdkV3Stub.sends[1].input).to.deep.equal({
      Bucket: 'bucket',
      Prefix: 'prefix',
      ContinuationToken: 'next-page',
    });
  });

  it('supports SDK v3 clients used during variable resolution', async () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      CloudFormation: { describeStacks: { Stacks: [] } },
      S3: { getObject: { Body: 'body' } },
      SSM: { getParameter: { Parameter: { Type: 'String', Value: 'value' } } },
      STS: { getCallerIdentity: { Account: '123456789012' } },
    });
    const { CloudFormationClient, DescribeStacksCommand } =
      awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-cloudformation'];
    const { S3Client, GetObjectCommand } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];
    const { SSMClient, GetParameterCommand } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-ssm'];
    const { STSClient, GetCallerIdentityCommand } =
      awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-sts'];
    const credentials = async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' });

    await new CloudFormationClient({ credentials }).send(
      new DescribeStacksCommand({ StackName: 'stack' })
    );
    await new S3Client({ credentials }).send(
      new GetObjectCommand({ Bucket: 'bucket', Key: 'key' })
    );
    await new SSMClient({ credentials }).send(new GetParameterCommand({ Name: 'param' }));
    await new STSClient({ credentials }).send(new GetCallerIdentityCommand({}));

    expect(awsSdkV3Stub.sends.map(({ service, method }) => `${service}.${method}`)).to.deep.equal([
      'CloudFormation.describeStacks',
      'S3.getObject',
      'SSM.getParameter',
      'STS.getCallerIdentity',
    ]);
    expect(awsSdkV3Stub.clients.map(({ config }) => config.credentials)).to.deep.equal([
      credentials,
      credentials,
      credentials,
      credentials,
    ]);
  });

  it('stubs ECR, Lambda, and IAM operational commands', async () => {
    const credentials = async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' });
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      ECR: {
        getAuthorizationToken: { authorizationData: [] },
        describeRepositories: { repositories: [] },
        createRepository: { repository: { repositoryUri: 'repository-uri' } },
        putLifecyclePolicy: {},
        describeImages: { imageDetails: [{ imageDigest: 'sha256:digest' }] },
        deleteRepository: {},
      },
      Lambda: {
        invoke: { Payload: new Uint8Array() },
        getFunction: { Configuration: {} },
        getLayerVersion: { Content: { Location: 'https://example.test/layer.zip' } },
        updateFunctionCode: {},
        updateFunctionConfiguration: {},
      },
      IAM: {
        getRole: { Role: { Arn: 'arn:aws:iam::123456789012:role/role' } },
      },
    });
    const {
      ECRClient,
      GetAuthorizationTokenCommand,
      DescribeRepositoriesCommand,
      CreateRepositoryCommand,
      PutLifecyclePolicyCommand,
      DescribeImagesCommand,
      DeleteRepositoryCommand,
    } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-ecr'];
    const {
      LambdaClient,
      InvokeCommand,
      GetFunctionCommand,
      GetLayerVersionCommand,
      UpdateFunctionCodeCommand,
      UpdateFunctionConfigurationCommand,
    } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-lambda'];
    const { IAMClient, GetRoleCommand } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-iam'];

    const ecr = new ECRClient({ region: 'us-east-1', credentials });
    const lambda = new LambdaClient({ region: 'us-east-1', credentials });
    const iam = new IAMClient({ region: 'us-east-1', credentials });

    await ecr.send(new GetAuthorizationTokenCommand({ registryIds: ['123456789012'] }));
    await ecr.send(
      new DescribeRepositoriesCommand({
        repositoryNames: ['repo'],
        registryId: '123456789012',
      })
    );
    await ecr.send(
      new CreateRepositoryCommand({
        repositoryName: 'repo',
        imageScanningConfiguration: { scanOnPush: true },
      })
    );
    await ecr.send(
      new PutLifecyclePolicyCommand({
        repositoryName: 'repo',
        lifecyclePolicyText: '{"rules":[]}',
      })
    );
    await ecr.send(
      new DescribeImagesCommand({
        imageIds: [{ imageTag: 'stable' }],
        repositoryName: 'repo/name',
        registryId: '123456789012',
      })
    );
    await ecr.send(
      new DeleteRepositoryCommand({
        registryId: '123456789012',
        repositoryName: 'repo',
        force: true,
      })
    );
    await lambda.send(
      new InvokeCommand({
        FunctionName: 'fn',
        InvocationType: 'RequestResponse',
        LogType: 'Tail',
        Payload: Buffer.from('{}'),
      })
    );
    await lambda.send(new GetFunctionCommand({ FunctionName: 'fn' }));
    await lambda.send(
      new GetLayerVersionCommand({
        LayerName: 'arn:aws:lambda:us-east-1:123456789012:layer:layer',
        VersionNumber: 1,
      })
    );
    await lambda.send(
      new UpdateFunctionCodeCommand({ FunctionName: 'fn', ZipFile: Buffer.from('zip') })
    );
    await lambda.send(
      new UpdateFunctionConfigurationCommand({ FunctionName: 'fn', Runtime: 'nodejs24.x' })
    );
    await iam.send(new GetRoleCommand({ RoleName: 'role' }));

    expect(awsSdkV3Stub.sends.map(({ service, method }) => `${service}.${method}`)).to.deep.equal([
      'ECR.getAuthorizationToken',
      'ECR.describeRepositories',
      'ECR.createRepository',
      'ECR.putLifecyclePolicy',
      'ECR.describeImages',
      'ECR.deleteRepository',
      'Lambda.invoke',
      'Lambda.getFunction',
      'Lambda.getLayerVersion',
      'Lambda.updateFunctionCode',
      'Lambda.updateFunctionConfiguration',
      'IAM.getRole',
    ]);
    expect(awsSdkV3Stub.sends[0].input).to.deep.equal({ registryIds: ['123456789012'] });
    expect(awsSdkV3Stub.sends[1].input).to.deep.equal({
      repositoryNames: ['repo'],
      registryId: '123456789012',
    });
    expect(awsSdkV3Stub.sends[2].input).to.deep.equal({
      repositoryName: 'repo',
      imageScanningConfiguration: { scanOnPush: true },
    });
    expect(awsSdkV3Stub.sends[3].input).to.deep.equal({
      repositoryName: 'repo',
      lifecyclePolicyText: '{"rules":[]}',
    });
    expect(awsSdkV3Stub.sends[4].input).to.deep.equal({
      imageIds: [{ imageTag: 'stable' }],
      repositoryName: 'repo/name',
      registryId: '123456789012',
    });
    expect(awsSdkV3Stub.sends[5].input).to.deep.equal({
      registryId: '123456789012',
      repositoryName: 'repo',
      force: true,
    });
    expect(awsSdkV3Stub.sends[6].input).to.deep.equal({
      FunctionName: 'fn',
      InvocationType: 'RequestResponse',
      LogType: 'Tail',
      Payload: Buffer.from('{}'),
    });
    expect(awsSdkV3Stub.sends[7].input).to.deep.equal({ FunctionName: 'fn' });
    expect(awsSdkV3Stub.sends[8].input).to.deep.equal({
      LayerName: 'arn:aws:lambda:us-east-1:123456789012:layer:layer',
      VersionNumber: 1,
    });
    expect(awsSdkV3Stub.sends[9].input).to.deep.equal({
      FunctionName: 'fn',
      ZipFile: Buffer.from('zip'),
    });
    expect(awsSdkV3Stub.sends[10].input).to.deep.equal({
      FunctionName: 'fn',
      Runtime: 'nodejs24.x',
    });
    expect(awsSdkV3Stub.sends[11].input).to.deep.equal({ RoleName: 'role' });
    expect(awsSdkV3Stub.clients.every(({ config }) => config.credentials === credentials)).to.equal(
      true
    );
  });

  it('stubs CloudFormation deploy and remove commands', async () => {
    const credentials = async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' });
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      CloudFormation: {
        createStack: { StackId: 'stack' },
        updateStack: { StackId: 'stack' },
        deleteStack: {},
        createChangeSet: { Id: 'change-set-id', StackId: 'stack' },
        describeChangeSet: { Status: 'CREATE_COMPLETE', Changes: [] },
        executeChangeSet: {},
        deleteChangeSet: {},
        getTemplate: { TemplateBody: '{}' },
        setStackPolicy: {},
        updateTerminationProtection: {},
        describeStackEvents: { StackEvents: [] },
        describeStacks: { Stacks: [] },
        listStackResources: { StackResourceSummaries: [] },
      },
    });
    const {
      CloudFormationClient,
      CreateStackCommand,
      UpdateStackCommand,
      DeleteStackCommand,
      CreateChangeSetCommand,
      DescribeChangeSetCommand,
      ExecuteChangeSetCommand,
      DeleteChangeSetCommand,
      GetTemplateCommand,
      SetStackPolicyCommand,
      UpdateTerminationProtectionCommand,
      DescribeStackEventsCommand,
      DescribeStacksCommand,
      ListStackResourcesCommand,
    } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-cloudformation'];

    const cloudFormation = new CloudFormationClient({ region: 'us-east-1', credentials });

    await cloudFormation.send(new CreateStackCommand({ StackName: 'stack' }));
    await cloudFormation.send(new UpdateStackCommand({ StackName: 'stack' }));
    await cloudFormation.send(new DeleteStackCommand({ StackName: 'stack' }));
    await cloudFormation.send(
      new CreateChangeSetCommand({ StackName: 'stack', ChangeSetName: 'change-set' })
    );
    await cloudFormation.send(
      new DescribeChangeSetCommand({ StackName: 'stack', ChangeSetName: 'change-set' })
    );
    await cloudFormation.send(
      new ExecuteChangeSetCommand({ StackName: 'stack', ChangeSetName: 'change-set' })
    );
    await cloudFormation.send(
      new DeleteChangeSetCommand({ StackName: 'stack', ChangeSetName: 'change-set' })
    );
    await cloudFormation.send(new GetTemplateCommand({ StackName: 'stack' }));
    await cloudFormation.send(new SetStackPolicyCommand({ StackName: 'stack' }));
    await cloudFormation.send(new UpdateTerminationProtectionCommand({ StackName: 'stack' }));
    await cloudFormation.send(new DescribeStackEventsCommand({ StackName: 'stack' }));
    await cloudFormation.send(new DescribeStacksCommand({ StackName: 'stack' }));
    await cloudFormation.send(new ListStackResourcesCommand({ StackName: 'stack' }));

    expect(awsSdkV3Stub.sends.map(({ service, method }) => `${service}.${method}`)).to.deep.equal([
      'CloudFormation.createStack',
      'CloudFormation.updateStack',
      'CloudFormation.deleteStack',
      'CloudFormation.createChangeSet',
      'CloudFormation.describeChangeSet',
      'CloudFormation.executeChangeSet',
      'CloudFormation.deleteChangeSet',
      'CloudFormation.getTemplate',
      'CloudFormation.setStackPolicy',
      'CloudFormation.updateTerminationProtection',
      'CloudFormation.describeStackEvents',
      'CloudFormation.describeStacks',
      'CloudFormation.listStackResources',
    ]);
    expect(awsSdkV3Stub.sends[0].input).to.deep.equal({ StackName: 'stack' });
    expect(awsSdkV3Stub.sends[3].input).to.deep.equal({
      StackName: 'stack',
      ChangeSetName: 'change-set',
    });
    expect(awsSdkV3Stub.clients.every(({ config }) => config.credentials === credentials)).to.equal(
      true
    );
  });

  it('stubs API Gateway and CloudWatch Logs commands', async () => {
    const credentials = async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' });
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      APIGateway: {
        getRestApis: { items: [] },
        getDeployments: { items: [] },
        getStage: {},
        createStage: {},
        updateStage: {},
        tagResource: {},
        untagResource: {},
        getUsagePlans: { items: [] },
        updateUsagePlan: {},
      },
      CloudWatchLogs: {
        describeSubscriptionFilters: { subscriptionFilters: [] },
        deleteSubscriptionFilter: {},
        deleteLogGroup: {},
      },
      CloudFormation: {
        describeStackResource: { StackResourceDetail: { PhysicalResourceId: 'api-id' } },
      },
    });
    const {
      APIGatewayClient,
      GetRestApisCommand,
      GetDeploymentsCommand,
      GetStageCommand,
      CreateStageCommand,
      UpdateStageCommand,
      TagResourceCommand,
      UntagResourceCommand,
      GetUsagePlansCommand,
      UpdateUsagePlanCommand,
    } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-api-gateway'];
    const {
      CloudWatchLogsClient,
      DescribeSubscriptionFiltersCommand,
      DeleteSubscriptionFilterCommand,
      DeleteLogGroupCommand,
    } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-cloudwatch-logs'];
    const { CloudFormationClient, DescribeStackResourceCommand } =
      awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-cloudformation'];
    const apiGateway = new APIGatewayClient({ region: 'us-east-1', credentials });
    const cloudWatchLogs = new CloudWatchLogsClient({ region: 'us-east-1', credentials });
    const cloudFormation = new CloudFormationClient({ region: 'us-east-1', credentials });

    await apiGateway.send(new GetRestApisCommand({ limit: 500 }));
    await apiGateway.send(new GetDeploymentsCommand({ restApiId: 'api-id', limit: 500 }));
    await apiGateway.send(new GetStageCommand({ restApiId: 'api-id', stageName: 'dev' }));
    await apiGateway.send(
      new CreateStageCommand({
        restApiId: 'api-id',
        deploymentId: 'deployment-id',
        stageName: 'dev',
      })
    );
    await apiGateway.send(
      new UpdateStageCommand({
        restApiId: 'api-id',
        stageName: 'dev',
        patchOperations: [],
      })
    );
    await apiGateway.send(new TagResourceCommand({ resourceArn: 'arn', tags: { key: 'value' } }));
    await apiGateway.send(new UntagResourceCommand({ resourceArn: 'arn', tagKeys: ['old'] }));
    await apiGateway.send(new GetUsagePlansCommand({ limit: 500 }));
    await apiGateway.send(
      new UpdateUsagePlanCommand({
        usagePlanId: 'plan-id',
        patchOperations: [{ op: 'remove', path: '/apiStages', value: 'api-id:dev' }],
      })
    );
    await cloudWatchLogs.send(
      new DescribeSubscriptionFiltersCommand({ logGroupName: 'log-group' })
    );
    await cloudWatchLogs.send(
      new DeleteSubscriptionFilterCommand({ logGroupName: 'log-group', filterName: 'filter' })
    );
    await cloudWatchLogs.send(new DeleteLogGroupCommand({ logGroupName: 'log-group' }));
    await cloudFormation.send(
      new DescribeStackResourceCommand({ StackName: 'stack', LogicalResourceId: 'RestApi' })
    );

    expect(awsSdkV3Stub.sends.map(({ service, method }) => `${service}.${method}`)).to.deep.equal([
      'APIGateway.getRestApis',
      'APIGateway.getDeployments',
      'APIGateway.getStage',
      'APIGateway.createStage',
      'APIGateway.updateStage',
      'APIGateway.tagResource',
      'APIGateway.untagResource',
      'APIGateway.getUsagePlans',
      'APIGateway.updateUsagePlan',
      'CloudWatchLogs.describeSubscriptionFilters',
      'CloudWatchLogs.deleteSubscriptionFilter',
      'CloudWatchLogs.deleteLogGroup',
      'CloudFormation.describeStackResource',
    ]);
    expect(awsSdkV3Stub.sends[0].command).to.be.instanceOf(GetRestApisCommand);
    expect(awsSdkV3Stub.sends[0].input).to.deep.equal({ limit: 500 });
    expect(awsSdkV3Stub.sends[1].input).to.deep.equal({ restApiId: 'api-id', limit: 500 });
    expect(awsSdkV3Stub.sends[2].input).to.deep.equal({ restApiId: 'api-id', stageName: 'dev' });
    expect(awsSdkV3Stub.sends[3].input).to.deep.equal({
      restApiId: 'api-id',
      deploymentId: 'deployment-id',
      stageName: 'dev',
    });
    expect(awsSdkV3Stub.sends[4].commandName).to.equal('UpdateStageCommand');
    expect(awsSdkV3Stub.sends[4].input).to.deep.equal({
      restApiId: 'api-id',
      stageName: 'dev',
      patchOperations: [],
    });
    expect(awsSdkV3Stub.sends[5].input).to.deep.equal({
      resourceArn: 'arn',
      tags: { key: 'value' },
    });
    expect(awsSdkV3Stub.sends[6].input).to.deep.equal({
      resourceArn: 'arn',
      tagKeys: ['old'],
    });
    expect(awsSdkV3Stub.sends[7].input).to.deep.equal({ limit: 500 });
    expect(awsSdkV3Stub.sends[8].commandName).to.equal('UpdateUsagePlanCommand');
    expect(awsSdkV3Stub.sends[8].input).to.deep.equal({
      usagePlanId: 'plan-id',
      patchOperations: [{ op: 'remove', path: '/apiStages', value: 'api-id:dev' }],
    });
    expect(awsSdkV3Stub.sends[9].input).to.deep.equal({ logGroupName: 'log-group' });
    expect(awsSdkV3Stub.sends[10].command).to.be.instanceOf(DeleteSubscriptionFilterCommand);
    expect(awsSdkV3Stub.sends[10].input).to.deep.equal({
      logGroupName: 'log-group',
      filterName: 'filter',
    });
    expect(awsSdkV3Stub.sends[11].input).to.deep.equal({ logGroupName: 'log-group' });
    expect(awsSdkV3Stub.sends[12].command).to.be.instanceOf(DescribeStackResourceCommand);
    expect(awsSdkV3Stub.sends[12].input).to.deep.equal({
      StackName: 'stack',
      LogicalResourceId: 'RestApi',
    });
    expect(awsSdkV3Stub.clients.every(({ config }) => config.credentials === credentials)).to.equal(
      true
    );
  });

  it('returns sequential direct command responses for manual API Gateway pagination', async () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      APIGateway: {
        getUsagePlans: [
          { items: [{ id: 'first' }], position: 'next-page' },
          { items: [{ id: 'second' }] },
        ],
      },
    });
    const { APIGatewayClient, GetUsagePlansCommand } =
      awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-api-gateway'];
    const apiGateway = new APIGatewayClient({ region: 'us-east-1' });

    const first = await apiGateway.send(new GetUsagePlansCommand({ limit: 500 }));
    const second = await apiGateway.send(
      new GetUsagePlansCommand({ position: 'next-page', limit: 500 })
    );

    expect(first).to.deep.equal({ items: [{ id: 'first' }], position: 'next-page' });
    expect(second).to.deep.equal({ items: [{ id: 'second' }] });
    expect(awsSdkV3Stub.sends.map(({ input }) => input)).to.deep.equal([
      { limit: 500 },
      { position: 'next-page', limit: 500 },
    ]);
  });

  it('passes send context to repeated SDK v3 stub callbacks', async () => {
    const observedContexts = [];
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      Lambda: {
        getFunction: (input, context) => {
          observedContexts.push(context);
          return { Configuration: { FunctionName: input.FunctionName } };
        },
      },
    });
    const { LambdaClient, GetFunctionCommand } =
      awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-lambda'];
    const client = new LambdaClient({ region: 'us-east-1' });

    await client.send(new GetFunctionCommand({ FunctionName: 'first' }));
    await client.send(new GetFunctionCommand({ FunctionName: 'second' }));

    expect(observedContexts).to.have.length(2);
    expect(observedContexts[0]).to.include({
      service: 'Lambda',
      method: 'getFunction',
      commandName: 'GetFunctionCommand',
      client,
    });
    expect(observedContexts[0].input).to.deep.equal({ FunctionName: 'first' });
    expect(observedContexts[1].input).to.deep.equal({ FunctionName: 'second' });
    expect(awsSdkV3Stub.sends.map(({ input }) => input.FunctionName)).to.deep.equal([
      'first',
      'second',
    ]);
  });

  it('passes send context to SDK v3 stub callbacks that accept it', async () => {
    let observedContext;
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      Lambda: {
        invoke: (input, context) => {
          observedContext = context;
          return { Payload: input.Payload };
        },
      },
    });
    const { LambdaClient, InvokeCommand } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-lambda'];
    const client = new LambdaClient({ region: 'us-east-1' });
    const input = {
      FunctionName: 'fn',
      Payload: Buffer.from('{}'),
    };

    await expect(client.send(new InvokeCommand(input))).to.eventually.deep.equal({
      Payload: input.Payload,
    });

    expect(observedContext).to.include({
      service: 'Lambda',
      method: 'invoke',
      commandName: 'InvokeCommand',
      client,
    });
    expect(observedContext.input).to.equal(input);
    expect(observedContext.clientConfig).to.equal(client.config);
  });

  it('passes send context to SDK v3 stub callbacks with default parameters', async () => {
    let observedContext;
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      Lambda: {
        invoke: (input, context = null) => {
          observedContext = context;
          return { Payload: input.Payload };
        },
      },
    });
    const { LambdaClient, InvokeCommand } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-lambda'];
    const client = new LambdaClient({ region: 'us-east-1' });
    const input = {
      FunctionName: 'fn',
      Payload: Buffer.from('{}'),
    };

    await expect(client.send(new InvokeCommand(input))).to.eventually.deep.equal({
      Payload: input.Payload,
    });

    expect(observedContext).to.include({
      service: 'Lambda',
      method: 'invoke',
      commandName: 'InvokeCommand',
      client,
    });
    expect(observedContext.input).to.equal(input);
  });

  it('can omit send context for legacy fallback callbacks', async () => {
    const observedArgs = [];
    const awsSdkV3Stub = configureAwsSdkV3Stub(
      {
        Lambda: {
          invoke: (...args) => {
            observedArgs.push(args);
            return {};
          },
        },
      },
      { passContextToCallbacks: false }
    );
    const { LambdaClient, InvokeCommand } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-lambda'];
    const client = new LambdaClient({ region: 'us-east-1' });
    const input = { FunctionName: 'fn' };

    await expect(client.send(new InvokeCommand(input))).to.eventually.deep.equal({});

    expect(observedArgs).to.deep.equal([[input]]);
  });

  it('stubs additional S3 data-plane commands', async () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      S3: {
        getObject: { Body: 'body' },
        deleteObjects: { Deleted: [{ Key: 'key' }] },
        listObjectVersions: { Versions: [{ Key: 'key', VersionId: 'version' }] },
      },
    });
    const { S3Client, GetObjectCommand, DeleteObjectsCommand, ListObjectVersionsCommand } =
      awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];
    const client = new S3Client({ region: 'us-east-1' });

    await expect(
      client.send(new GetObjectCommand({ Bucket: 'bucket', Key: 'key' }))
    ).to.eventually.deep.equal({ Body: 'body' });
    await expect(
      client.send(new DeleteObjectsCommand({ Bucket: 'bucket', Delete: { Objects: [] } }))
    ).to.eventually.deep.equal({ Deleted: [{ Key: 'key' }] });
    await expect(
      client.send(new ListObjectVersionsCommand({ Bucket: 'bucket' }))
    ).to.eventually.deep.equal({ Versions: [{ Key: 'key', VersionId: 'version' }] });

    expect(awsSdkV3Stub.sends.map((send) => send.method)).to.deep.equal([
      'getObject',
      'deleteObjects',
      'listObjectVersions',
    ]);
  });

  it('stubs lib-storage Upload and records upload context', async () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      S3: {
        upload: { Location: 's3://bucket/key' },
      },
    });
    const { S3Client } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];
    const { Upload } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/lib-storage'];
    const client = new S3Client({ region: 'us-east-1' });
    const params = { Bucket: 'bucket', Key: 'key', Body: 'body' };
    const upload = new Upload({ client, params, queueSize: 6 });

    expect(upload.on('httpUploadProgress', () => {})).to.equal(upload);
    await expect(upload.done()).to.eventually.deep.equal({ Location: 's3://bucket/key' });

    expect(awsSdkV3Stub.sends).to.have.length(1);
    expect(awsSdkV3Stub.sends[0]).to.include({
      service: 'S3',
      method: 'upload',
      commandName: 'Upload',
      client,
      upload,
    });
    expect(awsSdkV3Stub.sends[0].input).to.equal(params);
    expect(awsSdkV3Stub.sends[0].clientConfig).to.equal(client.config);
    expect(awsSdkV3Stub.sends[0].options).to.equal(upload.options);
    expect(awsSdkV3Stub.sends[0].options).to.include({ queueSize: 6 });
  });

  it('drains readable Upload bodies before resolving', async () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      S3: {
        upload: { Location: 's3://bucket/key' },
      },
    });
    const { S3Client } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];
    const { Upload } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/lib-storage'];
    const body = new PassThrough();
    const client = new S3Client({});
    const upload = new Upload({
      client,
      params: { Bucket: 'bucket', Key: 'key', Body: body },
    });
    let isResolved = false;

    const donePromise = upload.done().then((result) => {
      isResolved = true;
      return result;
    });
    await Promise.resolve();
    expect(isResolved).to.equal(false);

    body.end('body');

    await expect(donePromise).to.eventually.deep.equal({ Location: 's3://bucket/key' });
    expect(isResolved).to.equal(true);
    expect(awsSdkV3Stub.sends[0].input.Body).to.equal(body);
  });

  it('rejects lib-storage Upload when a readable body errors', async () => {
    const streamError = new Error('stream failed');
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      S3: {
        upload: { Location: 's3://bucket/key' },
      },
    });
    const { S3Client } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];
    const { Upload } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/lib-storage'];
    const body = new PassThrough();
    const client = new S3Client({});
    const upload = new Upload({
      client,
      params: { Bucket: 'bucket', Key: 'key', Body: body },
    });

    const donePromise = upload.done();
    body.destroy(streamError);

    try {
      await donePromise;
    } catch (caughtError) {
      expect(caughtError).to.equal(streamError);
      expect(awsSdkV3Stub.sends[0].input.Body).to.equal(body);
      return;
    }

    throw new Error('Expected upload to reject');
  });

  it('stubs lib-storage Upload even when S3.upload is not configured', async () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub({ S3: {} });
    const { S3Client } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];
    const { Upload } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/lib-storage'];
    const client = new S3Client({});
    const upload = new Upload({
      client,
      params: { Bucket: 'bucket', Key: 'key', Body: 'body' },
    });

    await expect(upload.done()).to.be.rejectedWith(
      'Missing AWS SDK v3 stub configuration for S3.upload'
    );
  });

  it('propagates configured Upload rejections', async () => {
    const error = new Error('upload failed');
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      S3: {
        upload: () => {
          throw error;
        },
      },
    });
    const { S3Client } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];
    const { Upload } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/lib-storage'];
    const client = new S3Client({});
    const upload = new Upload({
      client,
      params: { Bucket: 'bucket', Key: 'key', Body: 'body' },
    });

    try {
      await upload.done();
    } catch (caughtError) {
      expect(caughtError).to.equal(error);
      return;
    }

    throw new Error('Expected upload to reject');
  });

  it('throws a clear error for missing method stubs', async () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub({ S3: {} });
    const { S3Client, HeadBucketCommand } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];
    const client = new S3Client({});

    await expect(client.send(new HeadBucketCommand({ Bucket: 'bucket' }))).to.be.rejectedWith(
      'Missing AWS SDK v3 stub configuration for S3.headBucket'
    );
  });

  it('requires paginator config to include a client send function', async () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub({
      S3: { listObjectsV2: { Contents: [] } },
    });
    const { paginateListObjectsV2 } = awsSdkV3Stub.modulesCacheStub['@aws-sdk/client-s3'];

    await expect(
      (async () => {
        for await (const ignored of paginateListObjectsV2({}, { Bucket: 'bucket' })) {
          void ignored;
        }
      })()
    ).to.be.rejectedWith(
      'AWS SDK v3 stub paginator paginateListObjectsV2 requires config.client.send'
    );
  });

  it('rejects unsupported explicit services', () => {
    expect(() => configureAwsSdkV3Stub({ Unsupported: { read: {} } })).to.throw(
      'Unsupported AWS SDK v3 stub service Unsupported'
    );
  });

  it('ignores unsupported services and methods in fallback mode', () => {
    const awsSdkV3Stub = configureAwsSdkV3Stub(
      {
        Unsupported: { read: {} },
        Lambda: { unsupportedInvoke: {} },
      },
      { ignoreUnsupportedServices: true }
    );

    expect(awsSdkV3Stub.modulesCacheStub).to.deep.equal({});
  });
});
