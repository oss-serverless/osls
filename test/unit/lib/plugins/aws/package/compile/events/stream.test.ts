'use strict';

const expect = require('chai').expect;
const AwsCompileStreamEvents = require('../../../../../../../../lib/plugins/aws/package/compile/events/stream');
const runServerless = require('../../../../../../../utils/run-serverless');
const { createAwsEventCompilerContext } = require('./test-utils');

const dynamodbStreamArn = 'arn:aws:dynamodb:region:account:table/foo/stream/1';
const kinesisStreamArn = 'arn:aws:kinesis:us-east-1:123456789012:stream/some-long-name';
const scalarDynamodbStreamArn = 'arn:aws:dynamodb:region:account:table/scalar/stream/1';
const scalarKinesisStreamArn = 'arn:aws:kinesis:region:account:stream/scalar';
const zeroWindowStreamArn = 'arn:aws:dynamodb:region:account:table/zero/stream/1';
const consumerFalseStreamArn = 'arn:aws:kinesis:region:account:stream/consumer-false';
const kinesisOptionsStreamArn = 'arn:aws:kinesis:region:account:stream/options';
const snsDestinationArn = 'arn:aws:sns:region:account:snstopic';
const kinesisOptionsDestinationArn = 'arn:aws:sns:region:account:kinesisoptions';
const existingConsumerArn = 'arn:aws:kinesis:region:account:stream/xyz/consumer/foobar:1558544531';

const ddbGetAttArn = { 'Fn::GetAtt': ['SomeDdbTable', 'StreamArn'] };
const snsGetAttArn = { 'Fn::GetAtt': ['SomeSNS', 'Arn'] };
const foreignKinesisImportArn = { 'Fn::ImportValue': 'ForeignKinesis' };
const foreignSqsImportArn = { 'Fn::ImportValue': 'ForeignSQS' };
const someDdbTableStreamRef = { Ref: 'SomeDdbTableStreamArn' };
const foreignKinesisStreamRef = { Ref: 'ForeignKinesisStreamArn' };
const someSnsRef = { Ref: 'SomeSNSArn' };
const foreignSqsRef = { Ref: 'ForeignSQSArn' };

function createJoinedKinesisArn() {
  return {
    'Fn::Join': [
      ':',
      [
        'arn',
        'aws',
        'kinesis',
        { Ref: 'AWS::Region' },
        { Ref: 'AWS::AccountId' },
        'stream/MyStream',
      ],
    ],
  };
}

function createJoinedSqsArn() {
  return {
    'Fn::Join': [
      ':',
      ['arn', 'aws', 'sqs', { Ref: 'AWS::Region' }, { Ref: 'AWS::AccountId' }, 'MyQueue'],
    ],
  };
}

function createDefaultCompiledCloudFormationTemplate() {
  return {
    Resources: {
      IamRoleLambdaExecution: {
        Properties: {
          Policies: [
            {
              PolicyDocument: {
                Statement: [],
              },
            },
          ],
        },
      },
    },
    Outputs: {},
  };
}

function createAwsCompileStreamEvents(config = {}) {
  const { awsCompileEvents } = createAwsEventCompilerContext(AwsCompileStreamEvents, {
    ...config,
    provider: {
      compiledCloudFormationTemplate: createDefaultCompiledCloudFormationTemplate(),
      ...config.provider,
    },
  });

  return awsCompileEvents;
}

function getCompiledResources(awsCompileStreamEvents) {
  return awsCompileStreamEvents.serverless.service.provider.compiledCloudFormationTemplate
    .Resources;
}

describe('AwsCompileStreamEvents', () => {
  describe('compiler-unit role dependency behavior', () => {
    it('does not merge role statements when default policy is absent', () => {
      const awsCompileStreamEvents = createAwsCompileStreamEvents({
        functions: {
          first: {
            events: [{ stream: dynamodbStreamArn }],
          },
        },
      });
      const resources = getCompiledResources(awsCompileStreamEvents);
      resources.IamRoleLambdaExecution = null;

      expect(() => awsCompileStreamEvents.compileStreamEvents()).to.not.throw(Error);
      expect(resources.IamRoleLambdaExecution).to.equal(null);
    });

    const roleLogicalId = 'RoleLogicalId';
    for (const { label, functionRole, providerIam, expectedDependsOn } of [
      {
        label: 'function custom IAM role ARN',
        functionRole: 'arn:aws:iam::account:role/foo',
        expectedDependsOn: [],
      },
      {
        label: 'function custom IAM role logical ID',
        functionRole: roleLogicalId,
        expectedDependsOn: [roleLogicalId],
      },
      {
        label: 'function custom IAM role GetAtt reference',
        functionRole: { 'Fn::GetAtt': [roleLogicalId, 'Arn'] },
        expectedDependsOn: [roleLogicalId],
      },
      {
        label: 'function custom IAM role parameter reference',
        functionRole: { Ref: 'MyStreamRoleArn' },
        expectedDependsOn: [],
      },
      {
        label: 'function custom IAM role import',
        functionRole: { 'Fn::ImportValue': 'ExportedRoleId' },
        expectedDependsOn: [],
      },
      {
        label: 'provider custom IAM role ARN',
        providerIam: { role: 'arn:aws:iam::account:role/foo' },
        expectedDependsOn: [],
      },
      {
        label: 'provider custom IAM role logical ID',
        providerIam: { role: roleLogicalId },
        expectedDependsOn: [roleLogicalId],
      },
      {
        label: 'provider custom IAM role GetAtt reference',
        providerIam: { role: { 'Fn::GetAtt': [roleLogicalId, 'Arn'] } },
        expectedDependsOn: [roleLogicalId],
      },
    ]) {
      it(`sets EventSourceMapping DependsOn for ${label}`, () => {
        const functionConfig = {
          events: [{ stream: dynamodbStreamArn }],
        };
        if (functionRole) functionConfig.role = functionRole;
        const awsCompileStreamEvents = createAwsCompileStreamEvents({
          provider: providerIam ? { iam: providerIam } : undefined,
          functions: {
            first: functionConfig,
          },
        });
        const resources = getCompiledResources(awsCompileStreamEvents);
        resources.IamRoleLambdaExecution = null;

        expect(() => awsCompileStreamEvents.compileStreamEvents()).to.not.throw(Error);
        expect(resources.FirstEventSourceMappingDynamodbFoo.DependsOn).to.deep.equal(
          expectedDependsOn
        );
        expect(resources.IamRoleLambdaExecution).to.equal(null);
      });
    }

    it('does not create a stream consumer when consumer is false', () => {
      const awsCompileStreamEvents = createAwsCompileStreamEvents({
        functions: {
          first: {
            events: [
              {
                stream: {
                  arn: consumerFalseStreamArn,
                  consumer: false,
                },
              },
            ],
          },
        },
      });

      awsCompileStreamEvents.compileStreamEvents();

      const resources = getCompiledResources(awsCompileStreamEvents);
      const streamLogicalId = awsCompileStreamEvents.provider.naming.getStreamLogicalId(
        'first',
        'kinesis',
        'consumer-false'
      );
      const consumerName = awsCompileStreamEvents.provider.naming.getStreamConsumerName(
        'first',
        'consumer-false'
      );
      const consumerLogicalId =
        awsCompileStreamEvents.provider.naming.getStreamConsumerLogicalId(consumerName);

      expect(resources[streamLogicalId].Properties.EventSourceArn).to.equal(consumerFalseStreamArn);
      expect(resources[consumerLogicalId]).to.equal(undefined);
    });

    it('creates a legacy-named stream consumer by default', () => {
      const awsCompileStreamEvents = createAwsCompileStreamEvents({
        functions: {
          first: {
            events: [
              {
                stream: {
                  arn: 'arn:aws:kinesis:region:account:stream/abc',
                  consumer: true,
                },
              },
            ],
          },
        },
      });

      awsCompileStreamEvents.compileStreamEvents();

      const resources = getCompiledResources(awsCompileStreamEvents);
      expect(resources.FirstabcConsumerStreamConsumer).to.deep.equal({
        Type: 'AWS::Kinesis::StreamConsumer',
        Properties: {
          StreamARN: 'arn:aws:kinesis:region:account:stream/abc',
          ConsumerName: 'firstabcConsumer',
        },
      });
      expect(resources.FirstEventSourceMappingKinesisAbc.DependsOn).to.include(
        'FirstabcConsumerStreamConsumer'
      );
    });
  });
});

describe('test/unit/lib/plugins/aws/package/compile/events/stream.test.js', () => {
  describe('regular configuration', () => {
    let awsNaming;
    let cfTemplate;
    let eventSourceMappingResource;
    let streamConsumerName;
    let streamConsumerLogicalId;
    let streamConsumerResource;
    let serviceName;
    let stage;

    const getStreamResource = (functionName, streamType, streamName) =>
      cfTemplate.Resources[awsNaming.getStreamLogicalId(functionName, streamType, streamName)];

    const getIamStatements = () =>
      cfTemplate.Resources[awsNaming.getRoleLogicalId()].Properties.Policies[0].PolicyDocument
        .Statement;

    before(async () => {
      const result = await runServerless({
        fixture: 'function',
        configExt: {
          provider: {
            kinesis: {
              consumerNamingMode: 'serviceSpecific',
            },
          },
          resources: {
            Parameters: {
              SomeDdbTableStreamArn: {
                Type: 'String',
              },
              ForeignKinesisStreamArn: {
                Type: 'String',
              },
              SomeSNSArn: {
                Type: 'String',
              },
              ForeignSQSArn: {
                Type: 'String',
              },
            },
          },
          functions: {
            basic: {
              events: [
                {
                  stream: {
                    arn: kinesisStreamArn,
                    functionResponseType: 'ReportBatchItemFailures',
                    tumblingWindowInSeconds: 30,
                    filterPatterns: [{ eventName: ['INSERT'] }, { eventName: ['MODIFY'] }],
                    parallelizationFactor: 10,
                    bisectBatchOnFunctionError: true,
                    consumer: true,
                  },
                },
              ],
            },
            dynamo: {
              handler: 'basic.handler',
              events: [
                {
                  stream: {
                    arn: dynamodbStreamArn,
                    batchSize: 1,
                    startingPosition: 'LATEST',
                    enabled: false,
                    batchWindow: 15,
                    maximumRetryAttempts: 4,
                    maximumRecordAgeInSeconds: 120,
                    destinations: {
                      onFailure: snsDestinationArn,
                    },
                  },
                },
              ],
            },
            scalarDynamo: {
              handler: 'basic.handler',
              events: [{ stream: scalarDynamodbStreamArn }],
            },
            scalarKinesis: {
              handler: 'basic.handler',
              events: [{ stream: scalarKinesisStreamArn }],
            },
            zeroWindow: {
              handler: 'basic.handler',
              events: [
                {
                  stream: {
                    arn: zeroWindowStreamArn,
                    batchWindow: 0,
                  },
                },
              ],
            },
            kinesisOptions: {
              handler: 'basic.handler',
              events: [
                {
                  stream: {
                    arn: kinesisOptionsStreamArn,
                    batchWindow: 15,
                    maximumRetryAttempts: 5,
                    maximumRecordAgeInSeconds: 180,
                    destinations: {
                      onFailure: kinesisOptionsDestinationArn,
                    },
                  },
                },
              ],
            },
            timestamped: {
              handler: 'basic.handler',
              events: [
                {
                  stream: {
                    arn: 'arn:aws:kinesis:region:account:stream/timestamped',
                    consumer: true,
                    startingPosition: 'AT_TIMESTAMP',
                    startingPositionTimestamp: 123,
                  },
                },
              ],
            },
            kinesisImport: {
              handler: 'basic.handler',
              events: [
                {
                  stream: {
                    arn: foreignKinesisImportArn,
                    type: 'kinesis',
                  },
                },
              ],
            },
            kinesisImportCustomIam: {
              handler: 'basic.handler',
              role: {
                'Fn::Sub': 'arn:aws:iam::${AWS::AccountId}:role/iam-role-name',
              },
              events: [
                {
                  stream: {
                    arn: foreignKinesisImportArn,
                    type: 'kinesis',
                    consumer: existingConsumerArn,
                  },
                },
              ],
            },
            arnVariants: {
              handler: 'basic.handler',
              events: [
                {
                  stream: {
                    arn: ddbGetAttArn,
                    type: 'dynamodb',
                  },
                },
                {
                  stream: {
                    arn: createJoinedKinesisArn(),
                    type: 'kinesis',
                  },
                },
                {
                  stream: {
                    arn: someDdbTableStreamRef,
                    type: 'dynamodb',
                    destinations: {
                      onFailure: {
                        arn: foreignSqsImportArn,
                        type: 'sqs',
                      },
                    },
                  },
                },
                {
                  stream: {
                    arn: foreignKinesisStreamRef,
                    type: 'kinesis',
                  },
                },
              ],
            },
            destinationVariants: {
              handler: 'basic.handler',
              events: [
                {
                  stream: {
                    arn: 'arn:aws:dynamodb:region:account:table/foo/stream/1',
                    destinations: {
                      onFailure: {
                        arn: snsGetAttArn,
                        type: 'sns',
                      },
                    },
                  },
                },
                {
                  stream: {
                    arn: 'arn:aws:dynamodb:region:account:table/bar/stream/1',
                    destinations: {
                      onFailure: {
                        arn: createJoinedSqsArn(),
                        type: 'sqs',
                      },
                    },
                  },
                },
                {
                  stream: {
                    arn: 'arn:aws:dynamodb:region:account:table/buzz/stream/1',
                    destinations: {
                      onFailure: {
                        arn: someSnsRef,
                        type: 'sns',
                      },
                    },
                  },
                },
                {
                  stream: {
                    arn: 'arn:aws:dynamodb:region:account:table/fizz/stream/1',
                    destinations: {
                      onFailure: {
                        arn: foreignSqsRef,
                        type: 'sqs',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        command: 'package',
      });

      awsNaming = result.awsNaming;
      cfTemplate = result.cfTemplate;

      const streamLogicalId = awsNaming.getStreamLogicalId('basic', 'kinesis', 'some-long-name');
      eventSourceMappingResource = cfTemplate.Resources[streamLogicalId];

      streamConsumerName = awsNaming.getStreamConsumerName('basic', 'some-long-name');
      streamConsumerLogicalId = awsNaming.getStreamConsumerLogicalId(streamConsumerName);
      streamConsumerResource = cfTemplate.Resources[streamConsumerLogicalId];
      serviceName = result.serverless.service.service;
      stage = result.serverless.service.provider.stage;
    });

    it('should support ARN string for `arn`', () => {
      expect(getStreamResource('dynamo', 'dynamodb', 'foo').Properties.EventSourceArn).to.equal(
        dynamodbStreamArn
      );
      expect(
        getStreamResource('scalarDynamo', 'dynamodb', 'scalar').Properties.EventSourceArn
      ).to.equal(scalarDynamodbStreamArn);
      expect(
        getStreamResource('scalarKinesis', 'kinesis', 'scalar').Properties.EventSourceArn
      ).to.equal(scalarKinesisStreamArn);
      expect(streamConsumerResource.Properties.StreamARN).to.equal(kinesisStreamArn);
      expect(cfTemplate.Resources).to.have.property('BasicEventSourceMappingKinesisSomelongname');
      expect(cfTemplate.Resources).to.have.property(
        awsNaming.getStreamLogicalId('basic', 'kinesis', 'some-long-name')
      );
    });

    it('should support default EventSourceMapping properties', () => {
      const scalarKinesisResource = getStreamResource('scalarKinesis', 'kinesis', 'scalar');

      expect(scalarKinesisResource.Type).to.equal('AWS::Lambda::EventSourceMapping');
      expect(scalarKinesisResource.DependsOn).to.include(awsNaming.getRoleLogicalId());
      expect(scalarKinesisResource.Properties.BatchSize).to.equal(10);
      expect(scalarKinesisResource.Properties.StartingPosition).to.equal('TRIM_HORIZON');
      expect(scalarKinesisResource.Properties.Enabled).to.equal(true);
      expect(scalarKinesisResource.Properties.ParallelizationFactor).to.equal(undefined);
      expect(scalarKinesisResource.Properties.BisectBatchOnFunctionError).to.equal(undefined);
      expect(scalarKinesisResource.Properties.MaximumRecordAgeInSeconds).to.equal(undefined);
    });

    it('should support Fn::GetAtt for `arn`', () => {
      expect(
        getStreamResource('arnVariants', 'dynamodb', 'SomeDdbTable').Properties.EventSourceArn
      ).to.deep.equal(ddbGetAttArn);
    });

    it('should support Fn::ImportValue for `arn`', () => {
      expect(
        getStreamResource('kinesisImport', 'kinesis', 'ForeignKinesis').Properties.EventSourceArn
      ).to.deep.equal(foreignKinesisImportArn);
    });

    it('should support Fn::Join for `arn`', () => {
      expect(
        getStreamResource('arnVariants', 'kinesis', 'MyStream').Properties.EventSourceArn
      ).to.deep.equal(createJoinedKinesisArn());
    });

    it('should support Ref for `arn`', () => {
      expect(
        getStreamResource('arnVariants', 'dynamodb', 'SomeDdbTableStreamArn').Properties
          .EventSourceArn
      ).to.deep.equal(someDdbTableStreamRef);
      expect(
        getStreamResource('arnVariants', 'kinesis', 'ForeignKinesisStreamArn').Properties
          .EventSourceArn
      ).to.deep.equal(foreignKinesisStreamRef);
    });

    it('should support `batchSize`', () => {
      expect(getStreamResource('dynamo', 'dynamodb', 'foo').Properties.BatchSize).to.equal(1);
    });

    it('should support `startingPosition`', () => {
      expect(getStreamResource('dynamo', 'dynamodb', 'foo').Properties.StartingPosition).to.equal(
        'LATEST'
      );
    });

    it('should support `startingPositionTimestamp` with a stream consumer', () => {
      expect(
        getStreamResource('timestamped', 'kinesis', 'timestamped').Properties.StartingPosition
      ).to.equal('AT_TIMESTAMP');
      expect(
        getStreamResource('timestamped', 'kinesis', 'timestamped').Properties
          .StartingPositionTimestamp
      ).to.equal(123);
    });

    it('should support `enabled`', () => {
      expect(getStreamResource('dynamo', 'dynamodb', 'foo').Properties.Enabled).to.equal(false);
    });

    it('should support `batchWindow`', () => {
      expect(
        getStreamResource('dynamo', 'dynamodb', 'foo').Properties.MaximumBatchingWindowInSeconds
      ).to.equal(15);
      expect(
        getStreamResource('zeroWindow', 'dynamodb', 'zero').Properties
          .MaximumBatchingWindowInSeconds
      ).to.equal(0);
      expect(
        getStreamResource('kinesisOptions', 'kinesis', 'options').Properties
          .MaximumBatchingWindowInSeconds
      ).to.equal(15);
    });

    it('should support `maximumRetryAttempts`', () => {
      expect(
        getStreamResource('dynamo', 'dynamodb', 'foo').Properties.MaximumRetryAttempts
      ).to.equal(4);
      expect(
        getStreamResource('kinesisOptions', 'kinesis', 'options').Properties.MaximumRetryAttempts
      ).to.equal(5);
    });

    it('should support `maximumRecordAgeInSeconds`', () => {
      expect(
        getStreamResource('dynamo', 'dynamodb', 'foo').Properties.MaximumRecordAgeInSeconds
      ).to.equal(120);
      expect(
        getStreamResource('kinesisOptions', 'kinesis', 'options').Properties
          .MaximumRecordAgeInSeconds
      ).to.equal(180);
    });

    it('should support `parallelizationFactor`', () => {
      expect(eventSourceMappingResource.Properties.ParallelizationFactor).to.equal(10);
    });

    it('should support `bisectBatchOnFunctionError`', () => {
      expect(eventSourceMappingResource.Properties.BisectBatchOnFunctionError).to.equal(true);
    });

    it('should support `consumer`', () => {
      expect(streamConsumerResource).to.deep.equal({
        Type: 'AWS::Kinesis::StreamConsumer',
        Properties: {
          StreamARN: kinesisStreamArn,
          ConsumerName: streamConsumerName,
        },
      });
      expect(eventSourceMappingResource.DependsOn).to.include(streamConsumerLogicalId);
      expect(eventSourceMappingResource.DependsOn).to.include(awsNaming.getRoleLogicalId());
      expect(eventSourceMappingResource.Properties.EventSourceArn).to.deep.equal({
        Ref: streamConsumerLogicalId,
      });
      expect(
        getStreamResource('kinesisImportCustomIam', 'kinesis', 'ForeignKinesis').Properties
          .EventSourceArn
      ).to.equal(existingConsumerArn);
    });

    it('should support ARN string for `destinations.onFailure`', () => {
      expect(
        getStreamResource('dynamo', 'dynamodb', 'foo').Properties.DestinationConfig.OnFailure
          .Destination
      ).to.equal(snsDestinationArn);
      expect(
        getStreamResource('kinesisOptions', 'kinesis', 'options').Properties.DestinationConfig
          .OnFailure.Destination
      ).to.equal(kinesisOptionsDestinationArn);
    });

    it('should support Fn::GetAtt for `destinations.onFailure`', () => {
      expect(
        getStreamResource('destinationVariants', 'dynamodb', 'foo').Properties.DestinationConfig
          .OnFailure.Destination
      ).to.deep.equal(snsGetAttArn);
    });

    it('should support Fn::ImportValue for `destinations.onFailure`', () => {
      expect(
        getStreamResource('arnVariants', 'dynamodb', 'SomeDdbTableStreamArn').Properties
          .DestinationConfig.OnFailure.Destination
      ).to.deep.equal(foreignSqsImportArn);
    });

    it('should support Fn::Join for `destinations.onFailure`', () => {
      expect(
        getStreamResource('destinationVariants', 'dynamodb', 'bar').Properties.DestinationConfig
          .OnFailure.Destination
      ).to.deep.equal(createJoinedSqsArn());
    });

    it('should support Ref for `destinations.onFailure`', () => {
      expect(
        getStreamResource('destinationVariants', 'dynamodb', 'buzz').Properties.DestinationConfig
          .OnFailure.Destination
      ).to.deep.equal(someSnsRef);
      expect(
        getStreamResource('destinationVariants', 'dynamodb', 'fizz').Properties.DestinationConfig
          .OnFailure.Destination
      ).to.deep.equal(foreignSqsRef);
    });

    it('should support `functionResponseType`', () => {
      expect(eventSourceMappingResource.Properties.FunctionResponseTypes).to.include.members([
        'ReportBatchItemFailures',
      ]);
    });

    it('should have service and stage specific stream consumer name', () => {
      expect(streamConsumerResource.Properties.ConsumerName).to.include(serviceName);
      expect(streamConsumerResource.Properties.ConsumerName).to.include(stage);
    });

    it('should support `tumblingWindowInSeconds`', () => {
      expect(eventSourceMappingResource.Properties.TumblingWindowInSeconds).to.equal(30);
    });

    it('should support `filterPatterns`', () => {
      expect(eventSourceMappingResource.Properties.FilterCriteria).to.deep.equal({
        Filters: [
          {
            Pattern: JSON.stringify({ eventName: ['INSERT'] }),
          },
          {
            Pattern: JSON.stringify({ eventName: ['MODIFY'] }),
          },
        ],
      });
    });

    it('should ensure necessary IAM statements', () => {
      const timestampedConsumerLogicalId = awsNaming.getStreamConsumerLogicalId(
        awsNaming.getStreamConsumerName('timestamped', 'timestamped')
      );
      const streamStatements = getIamStatements().filter(({ Action }) => {
        const actions = Array.isArray(Action) ? Action : [Action];
        return actions.some((action) => /^(dynamodb|kinesis|sns|sqs):/.test(action));
      });
      const expectedStreamStatements = [
        {
          Effect: 'Allow',
          Action: [
            'kinesis:GetRecords',
            'kinesis:GetShardIterator',
            'kinesis:DescribeStreamSummary',
            'kinesis:ListShards',
          ],
          Resource: [kinesisStreamArn],
        },
        {
          Effect: 'Allow',
          Action: ['kinesis:SubscribeToShard'],
          Resource: [{ Ref: streamConsumerLogicalId }],
        },
        {
          Effect: 'Allow',
          Action: [
            'dynamodb:GetRecords',
            'dynamodb:GetShardIterator',
            'dynamodb:DescribeStream',
            'dynamodb:ListStreams',
          ],
          Resource: [dynamodbStreamArn],
        },
        {
          Effect: 'Allow',
          Action: ['sns:Publish'],
          Resource: [snsDestinationArn],
        },
        {
          Effect: 'Allow',
          Action: [
            'dynamodb:GetRecords',
            'dynamodb:GetShardIterator',
            'dynamodb:DescribeStream',
            'dynamodb:ListStreams',
          ],
          Resource: [scalarDynamodbStreamArn],
        },
        {
          Effect: 'Allow',
          Action: [
            'kinesis:GetRecords',
            'kinesis:GetShardIterator',
            'kinesis:DescribeStream',
            'kinesis:ListStreams',
          ],
          Resource: [scalarKinesisStreamArn],
        },
        {
          Effect: 'Allow',
          Action: [
            'dynamodb:GetRecords',
            'dynamodb:GetShardIterator',
            'dynamodb:DescribeStream',
            'dynamodb:ListStreams',
          ],
          Resource: [zeroWindowStreamArn],
        },
        {
          Effect: 'Allow',
          Action: [
            'kinesis:GetRecords',
            'kinesis:GetShardIterator',
            'kinesis:DescribeStream',
            'kinesis:ListStreams',
          ],
          Resource: [kinesisOptionsStreamArn],
        },
        {
          Effect: 'Allow',
          Action: ['sns:Publish'],
          Resource: [kinesisOptionsDestinationArn],
        },
        {
          Effect: 'Allow',
          Action: [
            'kinesis:GetRecords',
            'kinesis:GetShardIterator',
            'kinesis:DescribeStreamSummary',
            'kinesis:ListShards',
          ],
          Resource: ['arn:aws:kinesis:region:account:stream/timestamped'],
        },
        {
          Effect: 'Allow',
          Action: ['kinesis:SubscribeToShard'],
          Resource: [{ Ref: timestampedConsumerLogicalId }],
        },
        {
          Effect: 'Allow',
          Action: [
            'kinesis:GetRecords',
            'kinesis:GetShardIterator',
            'kinesis:DescribeStream',
            'kinesis:ListStreams',
          ],
          Resource: [foreignKinesisImportArn],
        },
        {
          Effect: 'Allow',
          Action: [
            'kinesis:GetRecords',
            'kinesis:GetShardIterator',
            'kinesis:DescribeStreamSummary',
            'kinesis:ListShards',
          ],
          Resource: [foreignKinesisImportArn],
        },
        {
          Effect: 'Allow',
          Action: ['kinesis:SubscribeToShard'],
          Resource: [existingConsumerArn],
        },
        {
          Effect: 'Allow',
          Action: [
            'dynamodb:GetRecords',
            'dynamodb:GetShardIterator',
            'dynamodb:DescribeStream',
            'dynamodb:ListStreams',
          ],
          Resource: [ddbGetAttArn, someDdbTableStreamRef],
        },
        {
          Effect: 'Allow',
          Action: [
            'kinesis:GetRecords',
            'kinesis:GetShardIterator',
            'kinesis:DescribeStream',
            'kinesis:ListStreams',
          ],
          Resource: [createJoinedKinesisArn(), foreignKinesisStreamRef],
        },
        {
          Effect: 'Allow',
          Action: ['sqs:ListQueues', 'sqs:SendMessage'],
          Resource: [foreignSqsImportArn],
        },
        {
          Effect: 'Allow',
          Action: [
            'dynamodb:GetRecords',
            'dynamodb:GetShardIterator',
            'dynamodb:DescribeStream',
            'dynamodb:ListStreams',
          ],
          Resource: [
            'arn:aws:dynamodb:region:account:table/foo/stream/1',
            'arn:aws:dynamodb:region:account:table/bar/stream/1',
            'arn:aws:dynamodb:region:account:table/buzz/stream/1',
            'arn:aws:dynamodb:region:account:table/fizz/stream/1',
          ],
        },
        {
          Effect: 'Allow',
          Action: ['sns:Publish'],
          Resource: [snsGetAttArn, someSnsRef],
        },
        {
          Effect: 'Allow',
          Action: ['sqs:ListQueues', 'sqs:SendMessage'],
          Resource: [createJoinedSqsArn(), foreignSqsRef],
        },
      ];

      expect(streamStatements).to.have.length(expectedStreamStatements.length);
      expect(streamStatements).to.have.deep.members(expectedStreamStatements);
    });
  });

  describe('failures', () => {
    async function expectInvalidConfigForMissingType(configExt, configPath) {
      let caughtError;
      try {
        await runServerless({
          fixture: 'function',
          command: 'package',
          configExt,
        });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).to.be.instanceOf(Error);
      expect(caughtError).to.have.property('code', 'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION');
      expect(caughtError.message).to.include(configPath);
    }

    for (const { label, arn } of [
      { label: 'Ref', arn: someDdbTableStreamRef },
      { label: 'Fn::GetAtt', arn: ddbGetAttArn },
    ]) {
      it(`should fail if ${label}/dynamic stream ARN is used without a type`, async () => {
        await expectInvalidConfigForMissingType(
          {
            functions: {
              basic: {
                events: [
                  {
                    stream: { arn },
                  },
                ],
              },
            },
          },
          'functions.basic.events.0.stream'
        );
      });
    }

    for (const { label, arn } of [
      { label: 'Ref', arn: foreignSqsRef },
      { label: 'Fn::GetAtt', arn: snsGetAttArn },
    ]) {
      it(`should fail if ${label}/dynamic destination ARN is used without a type`, async () => {
        await expectInvalidConfigForMissingType(
          {
            functions: {
              basic: {
                events: [
                  {
                    stream: {
                      arn: dynamodbStreamArn,
                      destinations: {
                        onFailure: { arn },
                      },
                    },
                  },
                ],
              },
            },
          },
          'functions.basic.events.0.stream.destinations.onFailure'
        );
      });
    }

    it('should fail for AT_TIMESTAMP without startingPositionTimestamp with a stream consumer', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              kinesis: {
                consumerNamingMode: 'serviceSpecific',
              },
            },
            functions: {
              basic: {
                events: [
                  {
                    stream: {
                      arn: 'arn:aws:kinesis:region:account:stream/abc',
                      consumer: true,
                      startingPosition: 'AT_TIMESTAMP',
                    },
                  },
                ],
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'FUNCTION_STREAM_STARTING_POSITION_TIMESTAMP_INVALID'
      );
    });
  });

  describe('with provisioned concurrency', () => {
    let naming;
    let eventSourceMappingResource;

    before(async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              provisionedConcurrency: 1,
              events: [{ stream: 'arn:aws:kinesis:us-east-1:123456789012:stream/myStream' }],
            },
          },
        },
        command: 'package',
      });
      naming = awsNaming;
      const streamLogicalId = awsNaming.getStreamLogicalId('basic', 'kinesis', 'myStream');
      eventSourceMappingResource = cfTemplate.Resources[streamLogicalId];
    });

    it('should reference provisioned alias', () => {
      expect(eventSourceMappingResource.Properties.FunctionName).to.deep.equal({
        'Fn::Join': [
          ':',
          [
            {
              'Fn::GetAtt': ['BasicLambdaFunction', 'Arn'],
            },
            'provisioned',
          ],
        ],
      });
    });

    it('should depend on provisioned alias', () => {
      const aliasLogicalId = naming.getLambdaProvisionedConcurrencyAliasLogicalId('basic');
      expect(eventSourceMappingResource.DependsOn).to.include(aliasLogicalId);
    });
  });
});
