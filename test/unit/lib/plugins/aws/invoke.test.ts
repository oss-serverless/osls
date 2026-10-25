'use strict';

const chai = require('chai');
const sinon = require('sinon');
const path = require('path');
const { getTmpDirPath } = require('../../../../utils/fs');
const runServerless = require('../../../../utils/run-serverless');
const setupProgrammaticFixture = require('../../../../utils/setup-programmatic-fixture');
const AwsInvoke = require('../../../../../lib/plugins/aws/invoke');
const AwsProvider = require('../../../../../lib/plugins/aws/provider');
const Serverless = require('../../../../../lib/serverless');
const { InvokeCommand } = require('@aws-sdk/client-lambda');

const expect = chai.expect;

describe('test/unit/lib/plugins/aws/invoke.test.js', () => {
  describe('Common', () => {
    let lambdaInvokeStub;
    let result;

    before(async () => {
      lambdaInvokeStub = sinon.stub();

      result = await runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          function: 'callback',
          data: '{"inputKey":"inputValue"}',
          log: true,
        },
        awsSdkV3StubMap: {
          Lambda: {
            invoke: (args) => {
              lambdaInvokeStub.returns({
                Payload: args.Payload,
                LogResult: Buffer.from(
                  'testlogline\nSERVERLESS_ENTERPRISE enterpriseline'
                ).toString('base64'),
              });
              return lambdaInvokeStub(args);
            },
          },
        },
      });
    });

    it('should invoke AWS SDK with expected params', () => {
      expect(lambdaInvokeStub).to.be.calledOnce;
      expect(lambdaInvokeStub).to.be.calledWith({
        FunctionName: result.serverless.service.getFunction('callback').name,
        InvocationType: 'RequestResponse',
        LogType: 'Tail',
        Payload: Buffer.from(JSON.stringify({ inputKey: 'inputValue' })),
      });
    });

    it('should support JSON string data', async () => {
      expect(lambdaInvokeStub).to.be.calledWith({
        FunctionName: result.serverless.service.getFunction('callback').name,
        InvocationType: 'RequestResponse',
        LogType: 'Tail',
        Payload: Buffer.from(JSON.stringify({ inputKey: 'inputValue' })),
      });
    });

    it('should include payload response in output', () => {
      expect(result.output).to.contain('"inputKey": "inputValue"');
    });

    it('should include logs in output', () => {
      expect(result.output).to.contain('testlogline');
      expect(result.output).not.to.contain('enterpriseline');
    });
  });

  it('uses an existing Lambda client promise when invoking a remote function', async () => {
    const serverless = new Serverless({ commands: [], options: {} });
    const options = {
      stage: 'dev',
      region: 'us-east-1',
      function: 'callback',
      functionObj: { name: 'service-dev-callback' },
    };
    serverless.setProvider('aws', new AwsProvider(serverless, options));
    const awsInvoke = new AwsInvoke(serverless, options);
    const send = sinon.stub().resolves({});
    const getAwsSdkV3ConfigStub = sinon
      .stub(awsInvoke.provider, 'getAwsSdkV3Config')
      .throws(new Error('Expected existing Lambda client to be reused'));
    awsInvoke.lambdaClientPromise = Promise.resolve({ send });

    try {
      await awsInvoke.invoke();

      expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
      expect(send).to.have.been.calledOnce;
      expect(send.firstCall.args[0]).to.be.instanceOf(InvokeCommand);
      expect(send.firstCall.args[0].input).to.deep.equal({
        FunctionName: 'service-dev-callback',
        InvocationType: 'RequestResponse',
        LogType: 'None',
        Payload: Buffer.from('{}'),
      });
    } finally {
      getAwsSdkV3ConfigStub.restore();
    }
  });

  it('should accept no data', async () => {
    const lambdaInvokeStub = sinon.stub();
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: Buffer.from('{}'),
    });
  });

  it('should pass durable execution name to Lambda invoke', async () => {
    const lambdaInvokeStub = sinon.stub();
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        'function': 'callback',
        'qualifier': 'durable',
        'durable-execution-name': 'order-123',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });

    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Qualifier: 'durable',
      DurableExecutionName: 'order-123',
      Payload: Buffer.from('{}'),
    });
  });

  it('should accept durable execution names at the 64 character boundary', async () => {
    const lambdaInvokeStub = sinon.stub();
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        'function': 'callback',
        'qualifier': 'durable',
        'durable-execution-name': 'a'.repeat(64),
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });

    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Qualifier: 'durable',
      DurableExecutionName: 'a'.repeat(64),
      Payload: Buffer.from('{}'),
    });
  });

  it('should include durable execution ARN in output', async () => {
    const durableExecutionArn =
      'arn:aws:lambda:us-east-1:123456789012:function:service-dev-callback:1/durable-execution/order-123/execution-123';
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        'function': 'callback',
        'qualifier': 'durable',
        'durable-execution-name': 'order-123',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: {
            DurableExecutionArn: durableExecutionArn,
          },
        },
      },
    });

    expect(result.output).to.contain(`DurableExecutionArn: ${durableExecutionArn}`);
  });

  it('should reject invalid durable execution names', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          'function': 'callback',
          'qualifier': 'durable',
          'durable-execution-name': 'invalid name',
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'INVALID_DURABLE_EXECUTION_NAME');
  });

  it('should require a durable execution name value', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          'function': 'callback',
          'qualifier': 'durable',
          'durable-execution-name': true,
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'MISSING_CLI_PARAM_VALUE');
  });

  it('should reject non-string durable execution names from programmatic options', async () => {
    const serverless = new Serverless({ commands: [], options: {} });
    serverless.serviceDir = __dirname;
    const options = {
      'stage': 'dev',
      'region': 'us-east-1',
      'function': 'callback',
      'qualifier': 'durable',
      'data': '{}',
      'durable-execution-name': true,
    };
    serverless.setProvider('aws', new AwsProvider(serverless, options));
    serverless.service.functions = {
      callback: {
        name: 'service-dev-callback',
        handler: 'callback.handler',
      },
    };

    await expect(
      new AwsInvoke(serverless, options).extendedValidate()
    ).to.be.eventually.rejected.and.have.property('code', 'INVALID_DURABLE_EXECUTION_NAME');
  });

  it('should reject empty durable execution names from programmatic options', async () => {
    const serverless = new Serverless({ commands: [], options: {} });
    serverless.serviceDir = __dirname;
    const options = {
      'stage': 'dev',
      'region': 'us-east-1',
      'function': 'callback',
      'qualifier': 'durable',
      'data': '{}',
      'durable-execution-name': '',
    };
    serverless.setProvider('aws', new AwsProvider(serverless, options));
    serverless.service.functions = {
      callback: {
        name: 'service-dev-callback',
        handler: 'callback.handler',
      },
    };

    await expect(
      new AwsInvoke(serverless, options).extendedValidate()
    ).to.be.eventually.rejected.and.have.property('code', 'INVALID_DURABLE_EXECUTION_NAME');
  });

  it('should reject durable execution names longer than 64 characters', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          'function': 'callback',
          'qualifier': 'durable',
          'durable-execution-name': 'a'.repeat(65),
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'INVALID_DURABLE_EXECUTION_NAME');
  });

  it('should require qualifier with durable execution names', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          'function': 'callback',
          'durable-execution-name': 'order-123',
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'DURABLE_INVOKE_REQUIRES_QUALIFIER');
  });

  it('should require qualifier when invoking configured durable functions', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          function: 'callback',
        },
        configExt: {
          functions: {
            callback: {
              durableConfig: {
                executionTimeout: 3600,
              },
            },
          },
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'DURABLE_INVOKE_REQUIRES_QUALIFIER');
  });

  it('should invoke configured durable functions with explicit qualifier', async () => {
    const lambdaInvokeStub = sinon.stub();
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        qualifier: 'durable',
      },
      configExt: {
        functions: {
          callback: {
            durableConfig: {
              executionTimeout: 3600,
            },
          },
        },
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });

    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Qualifier: 'durable',
      Payload: Buffer.from('{}'),
    });
  });

  it('should ignore empty payload responses', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          function: 'callback',
        },
        awsSdkV3StubMap: {
          Lambda: {
            invoke: {
              Payload: Buffer.alloc(0),
            },
          },
        },
      })
    ).to.eventually.be.fulfilled;
  });

  it('should decode SDK v3 Uint8Array payload responses', async () => {
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        data: '{"inputKey":"inputValue"}',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: {
            Payload: new Uint8Array(Buffer.from(JSON.stringify({ outputKey: 'outputValue' }))),
          },
        },
      },
    });
    const expectedCredentials = result.serverless
      .getProvider('aws')
      .getAwsSdkV3CredentialsProvider();

    expect(result.output).to.contain('"outputKey": "outputValue"');
    expect(result.awsSdkV3Stub.sends[0].input).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: Buffer.from(JSON.stringify({ inputKey: 'inputValue' })),
    });
    expect(result.awsSdkV3Stub.sends[0].clientConfig.region).to.equal(
      result.serverless.getProvider('aws').getRegion()
    );
    expect(result.awsSdkV3Stub.sends[0].clientConfig.credentials).to.equal(expectedCredentials);
  });

  it('should ignore empty SDK v3 Uint8Array payload responses', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          function: 'callback',
        },
        awsSdkV3StubMap: {
          Lambda: {
            invoke: {
              Payload: new Uint8Array(),
            },
          },
        },
      })
    ).to.eventually.be.fulfilled;
  });

  it('should parse plain string payload responses', async () => {
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: {
            Payload: JSON.stringify({ outputKey: 'outputValue' }),
          },
        },
      },
    });

    expect(result.output).to.contain('"outputKey": "outputValue"');
  });

  it('should fail on function errors with empty SDK v3 Uint8Array payload responses', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          function: 'callback',
        },
        awsSdkV3StubMap: {
          Lambda: {
            invoke: {
              FunctionError: 'Unhandled',
              Payload: new Uint8Array(),
            },
          },
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'AWS_LAMBDA_INVOCATION_FAILED');
  });

  it('should support plain string data', async () => {
    const lambdaInvokeStub = sinon.stub();
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        data: 'simple-string',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: Buffer.from(JSON.stringify('simple-string')),
    });
  });

  it('should should not attempt to parse data with raw option', async () => {
    const lambdaInvokeStub = sinon.stub();
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        data: '{"inputKey":"inputValue"}',
        raw: true,
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: Buffer.from(JSON.stringify('{"inputKey":"inputValue"}')),
    });
  });

  it('should support JSON file path as data', async () => {
    const lambdaInvokeStub = sinon.stub();
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        path: 'payload.json',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: Buffer.from(JSON.stringify({ dataInputKey: 'dataInputValue' })),
    });
  });

  it('should support absolute file path as data', async () => {
    const lambdaInvokeStub = sinon.stub();
    const { servicePath: serviceDir } = await setupProgrammaticFixture('invocation');
    const pathToPayload = path.join(serviceDir, 'payload.json');
    const result = await runServerless({
      cwd: serviceDir,
      command: 'invoke',
      options: {
        function: 'callback',
        path: pathToPayload,
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: Buffer.from(JSON.stringify({ dataInputKey: 'dataInputValue' })),
    });
  });

  it('should support YAML file path as data', async () => {
    const lambdaInvokeStub = sinon.stub();
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        path: 'payload.yaml',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: Buffer.from(JSON.stringify({ dataInputKey: 'dataInputValue' })),
    });
  });

  it('should throw error if data file path does not exist', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          function: 'callback',
          path: 'not-existing.yaml',
        },
      })
    ).to.eventually.be.rejected.and.have.property('code', 'FILE_NOT_FOUND');
  });

  it('should throw error if function is not provided', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: { function: 'notExisting' },
      })
    ).to.eventually.be.rejected.and.have.property('code', 'FUNCTION_MISSING_IN_SERVICE');
  });

  it('should support --type option', async () => {
    const lambdaInvokeStub = sinon.stub();
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        type: 'Event',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'Event',
      LogType: 'None',
      Payload: Buffer.from('{}'),
    });
  });

  it('should support --qualifier option', async () => {
    const lambdaInvokeStub = sinon.stub();
    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        qualifier: 'foo',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Qualifier: 'foo',
      Payload: Buffer.from('{}'),
    });
  });

  it('should support `--context` param', async () => {
    const lambdaInvokeStub = sinon.stub();

    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        context: 'somecontext',
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub).to.have.been.calledOnce;
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      ClientContext: 'InNvbWVjb250ZXh0Ig==', // "somecontext"
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: Buffer.from('{}'),
    });
  });

  it('should support `--context` param with `--raw` param', async () => {
    const lambdaInvokeStub = sinon.stub();

    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        context: '{"ctx": "somecontext"}',
        raw: true,
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub).to.have.been.calledOnce;
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      ClientContext: 'IntcImN0eFwiOiBcInNvbWVjb250ZXh0XCJ9Ig==', // "{\"ctx\": \"somecontext\"}"
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: Buffer.from('{}'),
    });
  });

  it('should support `--contextPath` param', async () => {
    const lambdaInvokeStub = sinon.stub();
    const contextDataFilePath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'fixtures',
      'programmatic',
      'invocation',
      'context.json'
    );

    const result = await runServerless({
      fixture: 'invocation',
      command: 'invoke',
      options: {
        function: 'callback',
        contextPath: contextDataFilePath,
      },
      awsSdkV3StubMap: {
        Lambda: {
          invoke: (args) => {
            lambdaInvokeStub.returns('payload');
            return lambdaInvokeStub(args);
          },
        },
      },
    });
    expect(lambdaInvokeStub).to.have.been.calledOnce;
    expect(lambdaInvokeStub.args[0][0]).to.deep.equal({
      ClientContext: 'eyJ0ZXN0UHJvcCI6InRlc3RWYWx1ZSJ9', // {"testProp":"testValue"}
      FunctionName: result.serverless.service.getFunction('callback').name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: Buffer.from('{}'),
    });
  });

  it('should throw error on invoke with contextPath if file not exists', async () => {
    const lambdaInvokeStub = sinon.stub();

    const contextDataFilePath = path.join(getTmpDirPath(), 'context.json');

    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          function: 'callback',
          contextPath: contextDataFilePath,
        },
        awsSdkV3StubMap: {
          Lambda: {
            invoke: (args) => {
              lambdaInvokeStub.returns('payload');
              return lambdaInvokeStub(args);
            },
          },
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'FILE_NOT_FOUND');
    expect(lambdaInvokeStub).to.have.been.callCount(0);
  });

  it('should fail the process for failed invocations', async () => {
    const lambdaInvokeStub = sinon.stub();
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          function: 'callback',
        },
        awsSdkV3StubMap: {
          Lambda: {
            invoke: (args) => {
              lambdaInvokeStub.returns({
                Payload: args.Payload,
                LogResult: Buffer.from('test').toString('base64'),
                FunctionError: true,
              });
              return lambdaInvokeStub(args);
            },
          },
        },
      })
    ).to.be.eventually.rejectedWith(Error, 'Invoked function failed');
  });

  it('should fail the process for failed invocations with empty payload responses', async () => {
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          function: 'callback',
        },
        awsSdkV3StubMap: {
          Lambda: {
            invoke: {
              Payload: Buffer.alloc(0),
              FunctionError: true,
            },
          },
        },
      })
    ).to.be.eventually.rejected.and.have.property('code', 'AWS_LAMBDA_INVOCATION_FAILED');
  });

  it('should resolve if path is not given', async () => {
    const lambdaInvokeStub = sinon.stub();
    await expect(
      runServerless({
        fixture: 'invocation',
        command: 'invoke',
        options: {
          function: 'callback',
          path: false,
        },
        awsSdkV3StubMap: {
          Lambda: {
            invoke: (args) => {
              lambdaInvokeStub.returns('payload');
              return lambdaInvokeStub(args);
            },
          },
        },
      })
    ).to.be.eventually.fulfilled;
  });
});
