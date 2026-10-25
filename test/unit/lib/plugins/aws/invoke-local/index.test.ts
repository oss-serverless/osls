'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const chai = require('chai');
const sinon = require('sinon');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const EventEmitter = require('events');
const proxyquire = require('proxyquire');
const { overrideEnv } = require('../../../../../utils/process');
const AwsProvider = require('../../../../../../lib/plugins/aws/provider');
const {
  CloudFormationClient,
  ListExportsCommand,
  ListStackResourcesCommand,
} = require('@aws-sdk/client-cloudformation');
const Serverless = require('../../../../../../lib/serverless');
const ServerlessError = require('../../../../../../lib/serverless-error');
const CLI = require('../../../../../../lib/classes/cli');
const { getTmpDirPath } = require('../../../../../utils/fs');
const skipWithNotice = require('../../../../../lib/skip-with-notice');
const runServerless = require('../../../../../utils/run-serverless');
const setupProgrammaticFixture = require('../../../../../utils/setup-programmatic-fixture');
const spawnExt = require('../../../../../../lib/utils/spawn');
const configureAwsSdkV3Stub = require('../../../../../lib/configure-aws-sdk-v3-stub');
const releasePendingRequestsUntilSettled = require('../../../../../utils/release-pending-requests-until-settled');

const tmpServicePath = __dirname;
const getStdinModulePath = path.resolve(__dirname, '../../../../../../lib/utils/get-stdin.js');

chai.should();

const expect = chai.expect;

const parseJsonOutput = (output) => {
  const objectStartIndex = output.indexOf('{');
  const arrayStartIndex = output.indexOf('[');
  const startIndex = [objectStartIndex, arrayStartIndex]
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];
  const objectEndIndex = output.lastIndexOf('}');
  const arrayEndIndex = output.lastIndexOf(']');
  const endIndex = Math.max(objectEndIndex, arrayEndIndex);

  return JSON.parse(output.slice(startIndex, endIndex + 1));
};

const parseInvokeLocalOutput = (output) => {
  const response = parseJsonOutput(output);
  return { response, responseBody: JSON.parse(response.body) };
};

const runInvokeLocal = async ({
  functionName = 'callback',
  options = {},
  configExt,
  cwd,
  env,
  modulesCacheStub,
} = {}) => {
  const result = await runServerless({
    ...(cwd ? { cwd } : { fixture: 'invocation', configExt }),
    command: 'invoke local',
    options: {
      function: functionName,
      ...options,
    },
    env,
    modulesCacheStub: {
      [getStdinModulePath]: sinon.stub().resolves(''),
      ...modulesCacheStub,
    },
  });

  return { ...result, ...parseInvokeLocalOutput(result.output) };
};

describe('AwsInvokeLocal', () => {
  let AwsInvokeLocal;
  let awsInvokeLocal;
  let options;
  let serverless;
  let provider;
  let stdinStub;
  let spawnExtStub;

  beforeEach(() => {
    options = {
      stage: 'dev',
      region: 'us-east-1',
      function: 'first',
    };
    spawnExtStub = sinon.stub().callsFake(() => {
      const result = Promise.resolve({ stdoutBuffer: Buffer.from('Mocked output') });
      result.stderr = new EventEmitter().on('data', () => {});
      result.stdout = new EventEmitter().on('data', () => {});
      return result;
    });

    stdinStub = sinon.stub().resolves('');
    AwsInvokeLocal = proxyquire('../../../../../../lib/plugins/aws/invoke-local/index', {
      '../../../utils/get-stdin': stdinStub,
      '../../../utils/spawn': spawnExtStub,
    });
    serverless = new Serverless({ commands: [], options: {} });
    serverless.serviceDir = 'servicePath';
    serverless.cli = new CLI(serverless);
    serverless.processedInput = { commands: ['invoke'] };
    provider = new AwsProvider(serverless, options);
    serverless.setProvider('aws', provider);
    awsInvokeLocal = new AwsInvokeLocal(serverless, options);
    awsInvokeLocal.provider = provider;
  });

  afterEach(() => {
    delete Object.prototype.polluted;
    delete Object.prototype.adversarial;
  });

  describe('#extendedValidate()', () => {
    let backupIsTTY;
    beforeEach(() => {
      serverless.serviceDir = true;
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
      serverless.service.functions = {
        first: {
          handler: true,
        },
      };
      awsInvokeLocal.options.data = null;
      awsInvokeLocal.options.path = false;

      // Ensure there's no attempt to read path from stdin
      backupIsTTY = process.stdin.isTTY;
      process.stdin.isTTY = true;
    });

    afterEach(() => {
      if (backupIsTTY) process.stdin.isTTY = backupIsTTY;
      else delete process.stdin.isTTY;
    });

    it('should not throw error when there are no input data', async () => {
      awsInvokeLocal.options.data = undefined;

      await expect(awsInvokeLocal.extendedValidate()).to.be.fulfilled;
      expect(awsInvokeLocal.options.data).to.equal('');
    });

    it('it should throw error if function is not provided', () => {
      serverless.service.functions = null;
      return expect(awsInvokeLocal.extendedValidate()).to.be.rejected;
    });

    it('should keep data if it is a simple string', async () => {
      awsInvokeLocal.options.data = 'simple-string';

      await expect(awsInvokeLocal.extendedValidate()).to.be.fulfilled;
      expect(awsInvokeLocal.options.data).to.equal('simple-string');
    });

    it('should parse data if it is a json string', async () => {
      awsInvokeLocal.options.data = '{"key": "value"}';

      await expect(awsInvokeLocal.extendedValidate()).to.be.fulfilled;
      expect(awsInvokeLocal.options.data).to.deep.equal({ key: 'value' });
    });

    it('should skip parsing data if "raw" requested', async () => {
      awsInvokeLocal.options.data = '{"key": "value"}';
      awsInvokeLocal.options.raw = true;

      await expect(awsInvokeLocal.extendedValidate()).to.be.fulfilled;
      expect(awsInvokeLocal.options.data).to.deep.equal('{"key": "value"}');
    });

    it('should parse context if it is a json string', async () => {
      awsInvokeLocal.options.context = '{"key": "value"}';

      await expect(awsInvokeLocal.extendedValidate()).to.be.fulfilled;
      expect(awsInvokeLocal.options.context).to.deep.equal({ key: 'value' });
    });

    it('should skip parsing context if "raw" requested', async () => {
      awsInvokeLocal.options.context = '{"key": "value"}';
      awsInvokeLocal.options.raw = true;

      await expect(awsInvokeLocal.extendedValidate()).to.be.fulfilled;
      expect(awsInvokeLocal.options.context).to.deep.equal('{"key": "value"}');
    });

    it('it should parse file if relative file path is provided', async () => {
      serverless.serviceDir = getTmpDirPath();
      const data = {
        testProp: 'testValue',
      };
      serverless.utils.writeFileSync(
        path.join(serverless.serviceDir, 'data.json'),
        JSON.stringify(data)
      );
      awsInvokeLocal.options.contextPath = 'data.json';

      await expect(awsInvokeLocal.extendedValidate()).to.be.fulfilled;
      expect(awsInvokeLocal.options.context).to.deep.equal(data);
    });

    it('it should parse file if absolute file path is provided', async () => {
      serverless.serviceDir = getTmpDirPath();
      const data = {
        event: {
          testProp: 'testValue',
        },
      };
      const dataFile = path.join(serverless.serviceDir, 'data.json');
      serverless.utils.writeFileSync(dataFile, JSON.stringify(data));
      awsInvokeLocal.options.path = dataFile;
      awsInvokeLocal.options.contextPath = false;

      await expect(awsInvokeLocal.extendedValidate()).to.be.fulfilled;
      expect(awsInvokeLocal.options.data).to.deep.equal(data);
    });

    it('it should parse a yaml file if file path is provided', async () => {
      serverless.serviceDir = getTmpDirPath();
      const yamlContent = 'event: data';

      serverless.utils.writeFileSync(path.join(serverless.serviceDir, 'data.yml'), yamlContent);
      awsInvokeLocal.options.path = 'data.yml';

      await expect(awsInvokeLocal.extendedValidate()).to.be.fulfilled;
      expect(awsInvokeLocal.options.data).to.deep.equal({ event: 'data' });
    });

    it('it should require a js file if file path is provided', async () => {
      serverless.serviceDir = getTmpDirPath();
      const jsContent = [
        'module.exports = {',
        '  headers: { "Content-Type" : "application/json" },',
        '  body: JSON.stringify([100, 200]),',
        '}',
      ].join('\n');

      serverless.utils.writeFileSync(path.join(serverless.serviceDir, 'data.js'), jsContent);
      awsInvokeLocal.options.path = 'data.js';

      await expect(awsInvokeLocal.extendedValidate()).to.be.fulfilled;
      expect(awsInvokeLocal.options.data).to.deep.equal({
        headers: { 'Content-Type': 'application/json' },
        body: '[100,200]',
      });
    });

    it('it should reject error if file path does not exist', () => {
      serverless.serviceDir = getTmpDirPath();
      awsInvokeLocal.options.path = 'some/path';

      return expect(awsInvokeLocal.extendedValidate()).to.be.rejected;
    });
  });

  describe('#getCredentialEnvVars()', () => {
    let credentialsProviderStub;
    let getAwsSdkV3CredentialsProviderStub;

    beforeEach(() => {
      credentialsProviderStub = sinon.stub().resolves({});
      getAwsSdkV3CredentialsProviderStub = sinon
        .stub(provider, 'getAwsSdkV3CredentialsProvider')
        .returns(credentialsProviderStub);
    });

    afterEach(() => getAwsSdkV3CredentialsProviderStub.restore());

    it('returns empty object when SDK v3 credentials have no env fields', async () => {
      const credentialEnvVars = await awsInvokeLocal.getCredentialEnvVars();

      expect(credentialEnvVars).to.be.eql({});
      expect(getAwsSdkV3CredentialsProviderStub).to.have.been.calledOnce;
      expect(credentialsProviderStub).to.have.been.calledOnceWithExactly({
        callerClientConfig: { region: 'us-east-1' },
      });
    });

    it('returns credential env vars from SDK v3 credentials', async () => {
      credentialsProviderStub.resolves({
        accessKeyId: 'ID',
        secretAccessKey: 'SECRET',
        sessionToken: 'TOKEN',
      });

      const credentialEnvVars = await awsInvokeLocal.getCredentialEnvVars();

      expect(credentialEnvVars).to.be.eql({
        AWS_ACCESS_KEY_ID: 'ID',
        AWS_SECRET_ACCESS_KEY: 'SECRET',
        AWS_SESSION_TOKEN: 'TOKEN',
      });
    });

    it('omits undefined SDK v3 credential fields', async () => {
      credentialsProviderStub.resolves({
        accessKeyId: 'ID',
        secretAccessKey: 'SECRET',
      });

      const credentialEnvVars = await awsInvokeLocal.getCredentialEnvVars();

      expect(credentialEnvVars).to.be.eql({
        AWS_ACCESS_KEY_ID: 'ID',
        AWS_SECRET_ACCESS_KEY: 'SECRET',
      });
    });

    it('returns empty object for missing default-chain credentials', async () => {
      credentialsProviderStub.rejects(
        new ServerlessError('AWS provider credentials not found.', 'AWS_CREDENTIALS_NOT_FOUND')
      );

      const credentialEnvVars = await awsInvokeLocal.getCredentialEnvVars();

      expect(credentialEnvVars).to.be.eql({});
    });

    it('surfaces configured credential provider failures', async () => {
      const credentialsError = Object.assign(new Error('The SSO session has expired'), {
        name: 'CredentialsProviderError',
      });
      credentialsProviderStub.rejects(credentialsError);

      await expect(awsInvokeLocal.getCredentialEnvVars()).to.be.rejectedWith(
        'The SSO session has expired'
      );
    });
  });

  describe('#getConfiguredEnvVars()', () => {
    it('merges provider and function env vars with function precedence and null filtering', () => {
      const providerValue = { Ref: 'providerValue' };
      const functionValue = { 'Fn::ImportValue': 'functionValue' };

      serverless.service.provider.environment = {
        SHARED: providerValue,
        DROP_ME: null,
      };
      awsInvokeLocal.options.functionObj = {
        environment: {
          SHARED: functionValue,
          KEEP_ME: 'yes',
        },
      };

      const result = awsInvokeLocal.getConfiguredEnvVars();

      expect(result).to.deep.equal({
        SHARED: functionValue,
        KEEP_ME: 'yes',
      });
      expect(serverless.service.provider.environment.SHARED).to.equal(providerValue);
    });

    it('does not drop or pollute when provider env contains an own __proto__ key', () => {
      const providerEnv = JSON.parse('{"__proto__":{"polluted":"yes"},"REGULAR":"value"}');
      serverless.service.provider.environment = providerEnv;
      awsInvokeLocal.options.functionObj = { environment: {} };

      const result = awsInvokeLocal.getConfiguredEnvVars();

      expect(result.REGULAR).to.equal('value');
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).to.equal(true);
      expect({}.polluted).to.equal(undefined);
    });

    it('preserves function env values including __proto__ without silent drops', () => {
      const functionEnv = JSON.parse('{"__proto__":"value","NORMAL":"yes"}');
      serverless.service.provider.environment = {};
      awsInvokeLocal.options.functionObj = { environment: functionEnv };

      const result = awsInvokeLocal.getConfiguredEnvVars();

      expect(result.NORMAL).to.equal('yes');
      expect(Reflect.get(result, '__proto__')).to.equal('value');
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).to.equal(true);
      expect({}.polluted).to.equal(undefined);
    });
  });

  describe('#resolveConfiguredEnvVars()', () => {
    afterEach(() => {
      if (CloudFormationClient.prototype.send.restore) {
        CloudFormationClient.prototype.send.restore();
      }
    });

    it('resolves Fn::ImportValue env vars', async () => {
      const listExportsStub = sinon.stub(CloudFormationClient.prototype, 'send').resolves({
        Exports: [{ Name: 'some-export', Value: 'imported-value' }],
      });

      const result = await awsInvokeLocal.resolveConfiguredEnvVars({
        IMPORTED: {
          'Fn::ImportValue': 'some-export',
        },
      });

      expect(result).to.deep.equal({
        IMPORTED: 'imported-value',
      });
      expect(listExportsStub).to.have.been.calledOnce;
      expect(listExportsStub.firstCall.args[0]).to.be.instanceOf(ListExportsCommand);
      expect(listExportsStub.firstCall.args[0].input).to.deep.equal({});
    });

    it('follows Fn::ImportValue pagination', async () => {
      const listExportsStub = sinon
        .stub(CloudFormationClient.prototype, 'send')
        .onFirstCall()
        .resolves({ Exports: [{ Name: 'other-export', Value: 'other-value' }], NextToken: 'next' })
        .onSecondCall()
        .resolves({ Exports: [{ Name: 'some-export', Value: 'imported-value' }] });

      const result = await awsInvokeLocal.resolveConfiguredEnvVars({
        IMPORTED: {
          'Fn::ImportValue': 'some-export',
        },
      });

      expect(result).to.deep.equal({ IMPORTED: 'imported-value' });
      expect(listExportsStub).to.have.been.calledTwice;
      expect(listExportsStub.secondCall.args[0]).to.be.instanceOf(ListExportsCommand);
      expect(listExportsStub.secondCall.args[0].input).to.deep.equal({ NextToken: 'next' });
    });

    it('tolerates Fn::ImportValue pages without Exports', async () => {
      const listExportsStub = sinon
        .stub(CloudFormationClient.prototype, 'send')
        .onFirstCall()
        .resolves({ NextToken: 'next' })
        .onSecondCall()
        .resolves({ Exports: [{ Name: 'some-export', Value: 'imported-value' }] });

      const result = await awsInvokeLocal.resolveConfiguredEnvVars({
        IMPORTED: {
          'Fn::ImportValue': 'some-export',
        },
      });

      expect(result).to.deep.equal({ IMPORTED: 'imported-value' });
      expect(listExportsStub).to.have.been.calledTwice;
    });

    it('rejects missing Fn::ImportValue env vars', async () => {
      sinon
        .stub(CloudFormationClient.prototype, 'send')
        .resolves({ Exports: [{ Name: 'other-export', Value: 'other-value' }] });

      await expect(
        awsInvokeLocal.resolveConfiguredEnvVars({
          IMPORTED: {
            'Fn::ImportValue': 'missing-export',
          },
        })
      ).to.be.rejected.then((error) => {
        expect(error.code).to.equal('INVOKE_LOCAL_INVALID_ENV_VARIABLE');
        expect(error.message).to.include(
          'Could not resolve Fn::ImportValue with name missing-export'
        );
      });
    });

    it('resolves Ref env vars', async () => {
      const listStackResourcesStub = sinon.stub(CloudFormationClient.prototype, 'send').resolves({
        StackResourceSummaries: [
          {
            LogicalResourceId: 'SomeResource',
            PhysicalResourceId: 'physical-resource-id',
          },
        ],
      });

      const result = await awsInvokeLocal.resolveConfiguredEnvVars({
        TARGET: {
          Ref: 'SomeResource',
        },
      });

      expect(result).to.deep.equal({
        TARGET: 'physical-resource-id',
      });
      expect(listStackResourcesStub).to.have.been.calledOnce;
      expect(listStackResourcesStub.firstCall.args[0]).to.be.instanceOf(ListStackResourcesCommand);
      expect(listStackResourcesStub.firstCall.args[0].input).to.deep.equal({
        StackName: provider.naming.getStackName(),
      });
    });

    it('follows Ref pagination', async () => {
      const listStackResourcesStub = sinon
        .stub(CloudFormationClient.prototype, 'send')
        .onFirstCall()
        .resolves({
          StackResourceSummaries: [{ LogicalResourceId: 'OtherResource' }],
          NextToken: 'next-page',
        })
        .onSecondCall()
        .resolves({
          StackResourceSummaries: [
            {
              LogicalResourceId: 'SomeResource',
              PhysicalResourceId: 'physical-resource-id',
            },
          ],
        });

      const result = await awsInvokeLocal.resolveConfiguredEnvVars({
        TARGET: {
          Ref: 'SomeResource',
        },
      });

      expect(result).to.deep.equal({ TARGET: 'physical-resource-id' });
      expect(listStackResourcesStub).to.have.been.calledTwice;
      expect(listStackResourcesStub.secondCall.args[0]).to.be.instanceOf(ListStackResourcesCommand);
      expect(listStackResourcesStub.secondCall.args[0].input).to.deep.equal({
        StackName: provider.naming.getStackName(),
        NextToken: 'next-page',
      });
    });

    it('stops Ref pagination when a match is found on the first page', async () => {
      const listStackResourcesStub = sinon.stub(CloudFormationClient.prototype, 'send').resolves({
        StackResourceSummaries: [
          {
            LogicalResourceId: 'SomeResource',
            PhysicalResourceId: 'physical-resource-id',
          },
        ],
        NextToken: 'next-page',
      });

      const result = await awsInvokeLocal.resolveConfiguredEnvVars({
        TARGET: {
          Ref: 'SomeResource',
        },
      });

      expect(result).to.deep.equal({ TARGET: 'physical-resource-id' });
      expect(listStackResourcesStub).to.have.been.calledOnce;
    });

    it('rejects missing Ref env vars', async () => {
      sinon
        .stub(CloudFormationClient.prototype, 'send')
        .onFirstCall()
        .resolves({
          StackResourceSummaries: [{ LogicalResourceId: 'OtherResource' }],
          NextToken: 'next-page',
        })
        .onSecondCall()
        .resolves({ StackResourceSummaries: [{ LogicalResourceId: 'AnotherResource' }] });

      await expect(
        awsInvokeLocal.resolveConfiguredEnvVars({
          TARGET: {
            Ref: 'SomeResource',
          },
        })
      ).to.be.rejected.then((error) => {
        expect(error.code).to.equal('INVOKE_LOCAL_INVALID_ENV_VARIABLE');
        expect(error.message).to.include('Could not resolve Ref with name SomeResource');
      });
    });

    it('reuses one CloudFormation client across env var resolutions', async () => {
      const getAwsSdkV3ConfigSpy = sinon.spy(provider, 'getAwsSdkV3Config');
      const sendStub = sinon
        .stub(CloudFormationClient.prototype, 'send')
        .callsFake(async (command) => {
          if (command instanceof ListExportsCommand) {
            return { Exports: [{ Name: 'some-export', Value: 'imported-value' }] };
          }
          if (command instanceof ListStackResourcesCommand) {
            return {
              StackResourceSummaries: [
                {
                  LogicalResourceId: 'SomeResource',
                  PhysicalResourceId: 'physical-resource-id',
                },
              ],
            };
          }
          throw new Error(`Unexpected CloudFormation command ${command.constructor.name}`);
        });

      try {
        const result = await awsInvokeLocal.resolveConfiguredEnvVars({
          IMPORTED: {
            'Fn::ImportValue': 'some-export',
          },
          TARGET: {
            Ref: 'SomeResource',
          },
        });

        expect(result).to.deep.equal({
          IMPORTED: 'imported-value',
          TARGET: 'physical-resource-id',
        });
        expect(getAwsSdkV3ConfigSpy).to.have.been.calledOnce;
        expect(sendStub).to.have.been.calledTwice;
        expect(sendStub.secondCall.thisValue).to.equal(sendStub.firstCall.thisValue);
      } finally {
        getAwsSdkV3ConfigSpy.restore();
      }
    });

    it('passes credential provider unchanged to the CloudFormation client constructor', async () => {
      const credentials = async () => ({ accessKeyId: 'key', secretAccessKey: 'secret' });
      const clientConfigs = [];
      const commands = [];
      class StubCloudFormationClient {
        constructor(config) {
          clientConfigs.push(config);
        }

        async send(command) {
          commands.push(command);
          return { Exports: [{ Name: 'some-export', Value: 'imported-value' }] };
        }
      }
      const AwsInvokeLocalWithStub = proxyquire(
        '../../../../../../lib/plugins/aws/invoke-local/index',
        {
          '../../../utils/get-stdin': stdinStub,
          '../../../utils/spawn': spawnExtStub,
          '@aws-sdk/client-cloudformation': {
            CloudFormationClient: StubCloudFormationClient,
            ListExportsCommand,
            ListStackResourcesCommand,
          },
        }
      );
      const invokeLocal = new AwsInvokeLocalWithStub(serverless, options);
      invokeLocal.provider = {
        ...provider,
        getAwsSdkV3Config: sinon.stub().resolves({ region: 'us-west-2', credentials }),
      };

      const result = await invokeLocal.resolveConfiguredEnvVars({
        IMPORTED: {
          'Fn::ImportValue': 'some-export',
        },
      });

      expect(result).to.deep.equal({ IMPORTED: 'imported-value' });
      expect(clientConfigs).to.have.length(1);
      expect(clientConfigs[0].region).to.equal('us-west-2');
      expect(clientConfigs[0].credentials).to.equal(credentials);
      expect(commands).to.have.length(1);
      expect(commands[0]).to.be.instanceOf(ListExportsCommand);
    });

    it('rejects unsupported environment variable objects', async () => {
      return expect(
        awsInvokeLocal.resolveConfiguredEnvVars({
          TARGET: {
            Unsupported: true,
          },
        })
      ).to.be.rejected.then((error) => {
        expect(error.code).to.equal('INVOKE_LOCAL_INVALID_ENV_VARIABLE');
      });
    });
  });

  describe('#loadEnvVars()', () => {
    let credentialsProviderStub;
    let getAwsSdkV3CredentialsProviderStub;
    let restoreEnv;

    beforeEach(() => {
      ({ restoreEnv } = overrideEnv());
      credentialsProviderStub = sinon.stub().resolves({});
      getAwsSdkV3CredentialsProviderStub = sinon
        .stub(provider, 'getAwsSdkV3CredentialsProvider')
        .returns(credentialsProviderStub);
      serverless.serviceDir = true;
      serverless.service.provider = {
        environment: {
          providerVar: 'providerValue',
        },
      };

      awsInvokeLocal.provider.options.region = 'us-east-1';
      awsInvokeLocal.options = {
        functionObj: {
          name: 'serviceName-dev-hello',
          environment: {
            functionVar: 'functionValue',
          },
        },
      };
    });

    afterEach(() => {
      restoreEnv();
      getAwsSdkV3CredentialsProviderStub.restore();
    });

    it('it should load provider env vars', async () => {
      await awsInvokeLocal.loadEnvVars();
      expect(process.env.providerVar).to.be.equal('providerValue');
    });

    it('it should load provider profile env', async () => {
      serverless.service.provider.profile = 'jdoe';
      await awsInvokeLocal.loadEnvVars();
      expect(process.env.AWS_PROFILE).to.be.equal('jdoe');
    });

    it('it should load function env vars', async () => {
      await awsInvokeLocal.loadEnvVars();
      expect(process.env.functionVar).to.be.equal('functionValue');
    });

    it('it should load default lambda env vars', async () => {
      await awsInvokeLocal.loadEnvVars();
      expect(process.env.LANG).to.equal('en_US.UTF-8');
      expect(process.env.LD_LIBRARY_PATH).to.equal(
        '/var/lang/lib:/lib64:/usr/lib64:/var/runtime:/var/runtime/lib:/var/task:/var/task/lib'
      );
      expect(process.env.LAMBDA_TASK_ROOT).to.equal('/var/task');
      expect(process.env.LAMBDA_RUNTIME_DIR).to.equal('/var/runtime');
      expect(process.env.AWS_REGION).to.equal('us-east-1');
      expect(process.env.AWS_DEFAULT_REGION).to.equal('us-east-1');
      expect(process.env.AWS_LAMBDA_LOG_GROUP_NAME).to.equal('/aws/lambda/serviceName-dev-hello');
      expect(process.env.AWS_LAMBDA_LOG_STREAM_NAME).to.equal(
        '2016/12/02/[$LATEST]f77ff5e4026c45bda9a9ebcec6bc9cad'
      );
      expect(process.env.AWS_LAMBDA_FUNCTION_NAME).to.equal('serviceName-dev-hello');
      expect(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE).to.equal('1024');
      expect(process.env.AWS_LAMBDA_FUNCTION_VERSION).to.equal('$LATEST');
      expect(process.env.NODE_PATH).to.equal('/var/runtime:/var/task:/var/runtime/node_modules');
    });

    it('it should set credential env vars #1', async () => {
      credentialsProviderStub.resolves({
        accessKeyId: 'ID',
        secretAccessKey: 'SECRET',
      });

      await awsInvokeLocal.loadEnvVars();
      expect(process.env.AWS_ACCESS_KEY_ID).to.equal('ID');
      expect(process.env.AWS_SECRET_ACCESS_KEY).to.equal('SECRET');
      expect('AWS_SESSION_TOKEN' in process.env).to.equal(false);
    });

    it('it should set credential env vars #2', async () => {
      credentialsProviderStub.resolves({
        sessionToken: 'TOKEN',
      });
      await awsInvokeLocal.loadEnvVars();

      expect(process.env.AWS_SESSION_TOKEN).to.equal('TOKEN');
      expect('AWS_ACCESS_KEY_ID' in process.env).to.equal(false);
      expect('AWS_SECRET_ACCESS_KEY' in process.env).to.equal(false);
    });

    it('it should work without credentials set', async () => {
      credentialsProviderStub.rejects(
        new ServerlessError('AWS provider credentials not found.', 'AWS_CREDENTIALS_NOT_FOUND')
      );

      await awsInvokeLocal.loadEnvVars();

      expect('AWS_SESSION_TOKEN' in process.env).to.equal(false);
      expect('AWS_ACCESS_KEY_ID' in process.env).to.equal(false);
      expect('AWS_SECRET_ACCESS_KEY' in process.env).to.equal(false);
    });

    it('loads credential env vars from SDK v3 credentials', async () => {
      credentialsProviderStub.resolves({
        accessKeyId: 'ID',
        secretAccessKey: 'SECRET',
        sessionToken: 'TOKEN',
      });

      await awsInvokeLocal.loadEnvVars();

      expect(process.env.AWS_ACCESS_KEY_ID).to.equal('ID');
      expect(process.env.AWS_SECRET_ACCESS_KEY).to.equal('SECRET');
      expect(process.env.AWS_SESSION_TOKEN).to.equal('TOKEN');
    });

    it('preserves configured env var precedence over SDK v3 credentials', async () => {
      credentialsProviderStub.resolves({
        accessKeyId: 'ID',
        secretAccessKey: 'SECRET',
        sessionToken: 'TOKEN',
      });
      serverless.service.provider.environment.AWS_ACCESS_KEY_ID = 'CONFIGURED_ID';
      awsInvokeLocal.options.functionObj.environment.AWS_SECRET_ACCESS_KEY = 'CONFIGURED_SECRET';

      await awsInvokeLocal.loadEnvVars();

      expect(process.env.AWS_ACCESS_KEY_ID).to.equal('CONFIGURED_ID');
      expect(process.env.AWS_SECRET_ACCESS_KEY).to.equal('CONFIGURED_SECRET');
      expect(process.env.AWS_SESSION_TOKEN).to.equal('TOKEN');
    });

    it('should fallback to service provider configuration when options are not available', async () => {
      awsInvokeLocal.provider.options.region = null;
      awsInvokeLocal.serverless.service.provider.region = 'us-west-1';

      await awsInvokeLocal.loadEnvVars();
      expect(process.env.AWS_REGION).to.equal('us-west-1');
      expect(process.env.AWS_DEFAULT_REGION).to.equal('us-west-1');
    });

    it('it should overwrite provider env vars', async () => {
      awsInvokeLocal.options.functionObj.environment.providerVar = 'providerValueOverwritten';

      await awsInvokeLocal.loadEnvVars();
      expect(process.env.providerVar).to.be.equal('providerValueOverwritten');
    });

    it('loads unsafe env names onto process.env without prototype pollution', async () => {
      const originalProcessEnvPrototype = Object.getPrototypeOf(process.env);
      const originalConstructor = Object.prototype.constructor;

      serverless.service.provider.environment = JSON.parse(
        '{"__proto__":"proto-value","constructor":"ctor-value","prototype":"prototype-value"}'
      );
      awsInvokeLocal.options.functionObj.environment = {};

      await awsInvokeLocal.loadEnvVars();

      expect(Object.getPrototypeOf(process.env)).to.equal(originalProcessEnvPrototype);
      expect(Object.prototype.hasOwnProperty.call(process.env, '__proto__')).to.equal(true);
      expect(Object.prototype.hasOwnProperty.call(process.env, 'constructor')).to.equal(true);
      expect(Object.prototype.hasOwnProperty.call(process.env, 'prototype')).to.equal(true);
      expect(Reflect.get(process.env, '__proto__')).to.equal('proto-value');
      expect(process.env.constructor).to.equal('ctor-value');
      expect(process.env.prototype).to.equal('prototype-value');
      expect(Object.keys(process.env)).to.include.members([
        '__proto__',
        'constructor',
        'prototype',
      ]);
      expect(Object.prototype.constructor).to.equal(originalConstructor);
      expect({}.polluted).to.equal(undefined);
    });
  });

  describe('#ensurePackage()', () => {
    let accessStub;
    let pluginSpawnStub;

    beforeEach(() => {
      accessStub = sinon.stub(fsp, 'access');
      pluginSpawnStub = sinon.stub(serverless.pluginManager, 'spawn').resolves();
      serverless.serviceDir = getTmpDirPath();
    });

    afterEach(() => {
      fsp.access.restore();
      serverless.pluginManager.spawn.restore();
    });

    it('skips packaging when skip-package is set and the state file exists', async () => {
      awsInvokeLocal.options['skip-package'] = true;
      accessStub.resolves();

      await awsInvokeLocal.ensurePackage();

      expect(accessStub).to.have.been.calledOnce;
      expect(pluginSpawnStub).to.not.have.been.called;
    });

    it('packages when skip-package is set but the state file is missing', async () => {
      awsInvokeLocal.options['skip-package'] = true;
      accessStub.rejects(Object.assign(new Error('missing'), { code: 'ENOENT' }));

      await awsInvokeLocal.ensurePackage();

      expect(pluginSpawnStub).to.have.been.calledOnceWithExactly('package');
    });
  });

  describe('#extractArtifact()', () => {
    let chmodStub;

    beforeEach(() => {
      chmodStub = sinon.stub(fsp, 'chmod').resolves();
      serverless.serviceDir = getTmpDirPath();
      awsInvokeLocal.options.functionObj = {};
      serverless.service.package = {};
    });

    afterEach(() => {
      fsp.chmod.restore();
    });

    it('filters directory placeholders and chmods bootstrap to 755', async () => {
      const artifactPath = path.join(serverless.serviceDir, 'artifact.zip');
      const zip = new AdmZip();

      zip.addFile('bootstrap', Buffer.from('#!/bin/sh\n'));
      zip.addFile('nested/', Buffer.alloc(0));
      zip.writeZip(artifactPath);

      awsInvokeLocal.options.functionObj.package = {
        artifact: artifactPath,
      };

      const destination = await awsInvokeLocal.extractArtifact();

      expect(chmodStub).to.have.been.calledWith(path.join(destination, 'bootstrap'), '755');
    });
  });

  describe('#invokeLocal()', () => {
    let invokeLocalNodeJsStub;
    let invokeLocalPythonStub;
    let invokeLocalJavaStub;
    let invokeLocalRubyStub;
    let invokeLocalDockerStub;

    beforeEach(() => {
      invokeLocalNodeJsStub = sinon.stub(awsInvokeLocal, 'invokeLocalNodeJs').resolves();
      invokeLocalPythonStub = sinon.stub(awsInvokeLocal, 'invokeLocalPython').resolves();
      invokeLocalJavaStub = sinon.stub(awsInvokeLocal, 'invokeLocalJava').resolves();
      invokeLocalRubyStub = sinon.stub(awsInvokeLocal, 'invokeLocalRuby').resolves();
      invokeLocalDockerStub = sinon.stub(awsInvokeLocal, 'invokeLocalDocker').resolves();

      awsInvokeLocal.serverless.service.service = 'new-service';
      awsInvokeLocal.provider.options.stage = 'dev';
      awsInvokeLocal.options = {
        function: 'first',
        functionObj: {
          handler: 'handler.hello',
          name: 'hello',
        },
        data: {},
      };
    });

    afterEach(() => {
      awsInvokeLocal.invokeLocalNodeJs.restore();
      awsInvokeLocal.invokeLocalPython.restore();
      awsInvokeLocal.invokeLocalJava.restore();
      awsInvokeLocal.invokeLocalRuby.restore();
    });

    it('should call invokeLocalNodeJs when no runtime is set', async () => {
      await awsInvokeLocal.invokeLocal();
      expect(invokeLocalNodeJsStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalNodeJsStub.calledWithExactly('handler', 'hello', {}, undefined)
      ).to.be.equal(true);
    });

    describe('for different handler paths', () => {
      [
        { path: 'handler.hello', expected: 'handler' },
        { path: '.build/handler.hello', expected: '.build/handler' },
      ].forEach((item) => {
        it(`should call invokeLocalNodeJs for any node.js runtime version for ${item.path}`, async () => {
          awsInvokeLocal.options.functionObj.handler = item.path;

          awsInvokeLocal.options.functionObj.runtime = 'nodejs20.x';
          await awsInvokeLocal.invokeLocal();
          expect(invokeLocalNodeJsStub.calledOnce).to.be.equal(true);
          expect(
            invokeLocalNodeJsStub.calledWithExactly(item.expected, 'hello', {}, undefined)
          ).to.be.equal(true);
        });
      });
    });

    it('should call invokeLocalNodeJs with custom context if provided', async () => {
      awsInvokeLocal.options.context = 'custom context';
      await awsInvokeLocal.invokeLocal();
      expect(invokeLocalNodeJsStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalNodeJsStub.calledWithExactly('handler', 'hello', {}, 'custom context')
      ).to.be.equal(true);
    });

    it('should call invokeLocalPython when python3.10 runtime is set', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'python3.10';
      await awsInvokeLocal.invokeLocal();
      // NOTE: this is important so that tests on Windows won't fail
      const runtime = process.platform === 'win32' ? 'python.exe' : 'python3.10';
      expect(invokeLocalPythonStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalPythonStub.calledWithExactly(runtime, 'handler', 'hello', {}, undefined)
      ).to.be.equal(true);
    });

    it('should call invokeLocalPython when python3.11 runtime is set', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'python3.11';
      await awsInvokeLocal.invokeLocal();
      // NOTE: this is important so that tests on Windows won't fail
      const runtime = process.platform === 'win32' ? 'python.exe' : 'python3.11';
      expect(invokeLocalPythonStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalPythonStub.calledWithExactly(runtime, 'handler', 'hello', {}, undefined)
      ).to.be.equal(true);
    });

    it('should call invokeLocalPython when python3.12 runtime is set', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'python3.12';
      await awsInvokeLocal.invokeLocal();
      // NOTE: this is important so that tests on Windows won't fail
      const runtime = process.platform === 'win32' ? 'python.exe' : 'python3.12';
      expect(invokeLocalPythonStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalPythonStub.calledWithExactly(runtime, 'handler', 'hello', {}, undefined)
      ).to.be.equal(true);
    });

    it('should call invokeLocalPython when python3.13 runtime is set', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'python3.13';
      await awsInvokeLocal.invokeLocal();
      // NOTE: this is important so that tests on Windows won't fail
      const runtime = process.platform === 'win32' ? 'python.exe' : 'python3.13';
      expect(invokeLocalPythonStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalPythonStub.calledWithExactly(runtime, 'handler', 'hello', {}, undefined)
      ).to.be.equal(true);
    });

    it('should call invokeLocalPython when python3.14 runtime is set', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'python3.14';
      await awsInvokeLocal.invokeLocal();
      // NOTE: this is important so that tests on Windows won't fail
      const runtime = process.platform === 'win32' ? 'python.exe' : 'python3.14';
      expect(invokeLocalPythonStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalPythonStub.calledWithExactly(runtime, 'handler', 'hello', {}, undefined)
      ).to.be.equal(true);
    });

    [
      'java8.al2',
      'java8.al2023',
      'java11',
      'java11.al2023',
      'java17',
      'java17.al2023',
      'java21',
      'java25',
    ].forEach((runtime) => {
      it(`should call invokeLocalJava when ${runtime} runtime is set`, async () => {
        awsInvokeLocal.options.functionObj.runtime = runtime;
        await awsInvokeLocal.invokeLocal();
        expect(invokeLocalJavaStub.calledOnce).to.be.equal(true);
        expect(
          invokeLocalJavaStub.calledWithExactly(
            'java',
            'handler.hello',
            'handleRequest',
            undefined,
            {},
            undefined
          )
        ).to.be.equal(true);
      });
    });

    it('should call invokeLocalJava with an explicit handler method', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'java21';
      awsInvokeLocal.options.functionObj.handler = 'com.example.Handler::customMethod';
      await awsInvokeLocal.invokeLocal();
      expect(invokeLocalJavaStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalJavaStub.calledWithExactly(
          'java',
          'com.example.Handler',
          'customMethod',
          undefined,
          {},
          undefined
        )
      ).to.be.equal(true);
    });

    it('rejects invalid Java handlers', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'java21';
      awsInvokeLocal.options.functionObj.handler = 'com.example.Handler;id::customMethod';

      await expect(awsInvokeLocal.invokeLocal()).to.be.rejected.then((error) => {
        expect(error).to.have.property('code', 'INVALID_JAVA_HANDLER');
      });
      expect(invokeLocalJavaStub).to.not.have.been.called;
    });

    it('should call invokeLocalRuby when ruby3.3 runtime is set', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'ruby3.3';
      await awsInvokeLocal.invokeLocal();
      // NOTE: this is important so that tests on Windows won't fail
      const runtime = process.platform === 'win32' ? 'ruby.exe' : 'ruby';
      expect(invokeLocalRubyStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalRubyStub.calledWithExactly(runtime, 'handler', 'hello', {}, undefined)
      ).to.be.equal(true);
    });

    it('should call invokeLocalRuby when ruby3.4 runtime is set', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'ruby3.4';
      await awsInvokeLocal.invokeLocal();
      // NOTE: this is important so that tests on Windows won't fail
      const runtime = process.platform === 'win32' ? 'ruby.exe' : 'ruby';
      expect(invokeLocalRubyStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalRubyStub.calledWithExactly(runtime, 'handler', 'hello', {}, undefined)
      ).to.be.equal(true);
    });

    it('should call invokeLocalRuby when ruby4.0 runtime is set', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'ruby4.0';
      await awsInvokeLocal.invokeLocal();
      // NOTE: this is important so that tests on Windows won't fail
      const runtime = process.platform === 'win32' ? 'ruby.exe' : 'ruby';
      expect(invokeLocalRubyStub.calledOnce).to.be.equal(true);
      expect(
        invokeLocalRubyStub.calledWithExactly(runtime, 'handler', 'hello', {}, undefined)
      ).to.be.equal(true);
    });

    it('preserves Ruby class and module handler names', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'ruby3.4';
      awsInvokeLocal.options.functionObj.handler = 'handler.MyModule::MyClass.my_class_method';

      await awsInvokeLocal.invokeLocal();

      const runtime = process.platform === 'win32' ? 'ruby.exe' : 'ruby';
      expect(invokeLocalRubyStub).to.have.been.calledOnceWithExactly(
        runtime,
        'handler',
        'MyModule::MyClass.my_class_method',
        {},
        undefined
      );
    });

    it('rejects invalid Ruby handlers', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'ruby3.4';
      awsInvokeLocal.options.functionObj.handler = 'handler.bad-name';

      await expect(awsInvokeLocal.invokeLocal()).to.be.rejected.then((error) => {
        expect(error).to.have.property('code', 'INVALID_RUBY_HANDLER');
      });
      expect(invokeLocalRubyStub).to.not.have.been.called;
    });

    it('should call invokeLocalDocker if using runtime provided.al2023', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'provided.al2023';
      awsInvokeLocal.options.functionObj.handler = 'handler.foobar';
      await awsInvokeLocal.invokeLocal();
      expect(invokeLocalDockerStub.calledOnce).to.be.equal(true);
      expect(invokeLocalDockerStub.calledWithExactly()).to.be.equal(true);
    });

    it('should call invokeLocalDocker if using --docker option with nodejs20.x', async () => {
      awsInvokeLocal.options.functionObj.runtime = 'nodejs20.x';
      awsInvokeLocal.options.functionObj.handler = 'handler.foobar';
      awsInvokeLocal.options.docker = true;
      await awsInvokeLocal.invokeLocal();
      expect(invokeLocalDockerStub.calledOnce).to.be.equal(true);
      expect(invokeLocalDockerStub.calledWithExactly()).to.be.equal(true);
    });
  });

  describe('#callJavaBridge()', () => {
    let invokeLocalSpawnStubbed;
    beforeEach(() => {
      AwsInvokeLocal = proxyquire('../../../../../../lib/plugins/aws/invoke-local/index', {
        '../../../utils/get-stdin': stdinStub,
        '../../../utils/spawn': spawnExtStub,
      });
      invokeLocalSpawnStubbed = new AwsInvokeLocal(serverless, {
        stage: 'dev',
        function: 'first',
        functionObj: {
          handler: 'handler.hello',
          name: 'hello',
          timeout: 4,
        },
        data: {},
      });
    });

    it('spawns java process with correct arguments and sanitized environment', async () => {
      const artifactPath = path.join(tmpServicePath, 'artifact path;$(id).jar');
      const className = 'com.example.Handler; $(id)';
      const handlerName = 'handle "Request" && id';

      await overrideEnv(
        {
          variables: {
            JAVA_TOOL_OPTIONS: '-javaagent:/tmp/agent.jar',
            _JAVA_OPTIONS: '-Xmx64m',
            JDK_JAVA_OPTIONS: '--add-opens=java.base/java.lang=ALL-UNNAMED',
            KEEP_ME: 'yes',
          },
        },
        async () => {
          await invokeLocalSpawnStubbed.callJavaBridge(artifactPath, className, handlerName, '{}');
        }
      );

      const wrapperPath = await invokeLocalSpawnStubbed.resolveRuntimeWrapperPath(
        'java/target/invoke-bridge-1.0.1.jar'
      );
      const [command, args, spawnOptions] = spawnExtStub.firstCall.args;

      expect(command).to.equal('java');
      expect(args).to.deep.equal([
        `-DartifactPath=${artifactPath}`,
        `-DclassName=${className}`,
        `-DhandlerName=${handlerName}`,
        '-jar',
        wrapperPath,
      ]);
      expect(spawnOptions).to.include({ input: '{}' });
      expect(spawnOptions).to.not.have.property('shell');
      expect(spawnOptions.env).to.include({ KEEP_ME: 'yes' });
      expect(spawnOptions.env).to.not.have.property('JAVA_TOOL_OPTIONS');
      expect(spawnOptions.env).to.not.have.property('_JAVA_OPTIONS');
      expect(spawnOptions.env).to.not.have.property('JDK_JAVA_OPTIONS');
    });

    it('preserves java runtime environment when requested', async () => {
      invokeLocalSpawnStubbed.options['preserve-runtime-env'] = true;

      await overrideEnv(
        { variables: { JAVA_TOOL_OPTIONS: '-javaagent:/tmp/agent.jar' } },
        async () => {
          await invokeLocalSpawnStubbed.callJavaBridge(
            'artifact.jar',
            'com.example.Handler',
            'handleRequest',
            '{}'
          );
        }
      );

      expect(spawnExtStub.firstCall.args[2].env).to.include({
        JAVA_TOOL_OPTIONS: '-javaagent:/tmp/agent.jar',
      });
    });
  });

  describe('#invokeLocalRuby()', () => {
    let invokeLocalSpawnStubbed;

    beforeEach(() => {
      AwsInvokeLocal = proxyquire('../../../../../../lib/plugins/aws/invoke-local/index', {
        '../../../utils/get-stdin': stdinStub,
        '../../../utils/spawn': spawnExtStub,
      });
      invokeLocalSpawnStubbed = new AwsInvokeLocal(serverless, {
        stage: 'dev',
        function: 'first',
        data: {},
      });
      invokeLocalSpawnStubbed.options.functionObj = {
        handler: 'handler.hello',
        name: 'hello',
        timeout: 4,
      };
    });

    it('spawns ruby process with correct arguments and sanitized environment', async () => {
      const handlerPath = 'handler path;$(id)';
      const handlerName = 'hello "quoted" && id';

      await overrideEnv(
        {
          variables: {
            RUBYOPT: '-e system("id")',
            RUBYLIB: '/tmp/lib',
            BUNDLE_GEMFILE: '/tmp/Gemfile',
            BUNDLE_PATH: '/tmp/bundle',
            KEEP_ME: 'yes',
          },
        },
        async () => {
          await invokeLocalSpawnStubbed.invokeLocalRuby(
            'ruby',
            handlerPath,
            handlerName,
            {},
            undefined
          );
        }
      );

      const wrapperPath = await invokeLocalSpawnStubbed.resolveRuntimeWrapperPath('invoke.rb');
      const [command, args, options] = spawnExtStub.firstCall.args;

      expect(command).to.equal('ruby');
      expect(args).to.deep.equal([wrapperPath, handlerPath, handlerName]);
      expect(JSON.parse(options.input).event).to.deep.equal({});
      expect(options.env).to.include({ KEEP_ME: 'yes' });
      expect(options.env).to.not.have.property('RUBYOPT');
      expect(options.env).to.not.have.property('RUBYLIB');
      expect(options.env).to.not.have.property('BUNDLE_GEMFILE');
      expect(options.env).to.not.have.property('BUNDLE_PATH');
      expect(options).to.not.have.property('shell');
    });

    it('preserves ruby runtime environment when requested', async () => {
      invokeLocalSpawnStubbed.options['preserve-runtime-env'] = true;

      await overrideEnv({ variables: { RUBYOPT: '-e system("id")' } }, async () => {
        await invokeLocalSpawnStubbed.invokeLocalRuby('ruby', 'handler', 'hello', {}, undefined);
      });

      expect(spawnExtStub.firstCall.args[2].env).to.include({ RUBYOPT: '-e system("id")' });
    });
  });

  describe('#invokeLocalJava()', () => {
    let callJavaBridgeStub;
    let bridgePath;

    beforeEach(async () => {
      const wrapperPath = await awsInvokeLocal.resolveRuntimeWrapperPath('java/target');

      bridgePath = wrapperPath;
      fs.mkdirSync(bridgePath, { recursive: true });
      callJavaBridgeStub = sinon.stub(awsInvokeLocal, 'callJavaBridge').resolves();
      awsInvokeLocal.provider.options.stage = 'dev';
      awsInvokeLocal.options = {
        function: 'first',
        functionObj: {
          handler: 'handler.hello',
          name: 'hello',
          timeout: 4,
        },
        data: {},
      };
    });

    afterEach(() => {
      awsInvokeLocal.callJavaBridge.restore();
      fs.rmSync(bridgePath, { recursive: true, force: true });
    });

    it('should invoke callJavaBridge when bridge is built', async () => {
      await awsInvokeLocal.invokeLocalJava(
        'java',
        'com.serverless.Handler',
        'handleRequest',
        tmpServicePath,
        {}
      );

      expect(callJavaBridgeStub.calledOnce).to.be.equal(true);
      expect(
        callJavaBridgeStub.calledWithExactly(
          tmpServicePath,
          'com.serverless.Handler',
          'handleRequest',
          JSON.stringify({
            event: {},
            context: {
              name: 'hello',
              version: 'LATEST',
              logGroupName: '/aws/lambda/hello',
              timeout: 4,
            },
          })
        )
      ).to.be.equal(true);
    });

    describe('when attempting to build the Java bridge', () => {
      it("if it's not present yet", async () => {
        fs.rmSync(bridgePath, { recursive: true, force: true });
        spawnExtStub.resetHistory();

        await awsInvokeLocal.invokeLocalJava(
          'java',
          'com.serverless.Handler',
          'handleRequest',
          tmpServicePath,
          {}
        );

        expect(callJavaBridgeStub.calledOnce).to.be.equal(true);
        expect(
          callJavaBridgeStub.calledWithExactly(
            tmpServicePath,
            'com.serverless.Handler',
            'handleRequest',
            JSON.stringify({
              event: {},
              context: {
                name: 'hello',
                version: 'LATEST',
                logGroupName: '/aws/lambda/hello',
                timeout: 4,
              },
            })
          )
        ).to.be.equal(true);
        expect(spawnExtStub.calledOnce).to.be.equal(true);
        expect(spawnExtStub.firstCall.args).to.deep.equal([
          'mvn',
          ['package', '-f', path.join(path.dirname(bridgePath), 'pom.xml')],
          { shouldCloseStdin: true },
        ]);
      });

      it('rejects if the Java bridge build fails', async () => {
        fs.rmSync(bridgePath, { recursive: true, force: true });
        spawnExtStub.rejects(
          Object.assign(new Error('mvn failed'), {
            code: 1,
            signal: null,
            stdoutBuffer: Buffer.from('build failed'),
          })
        );

        await expect(
          awsInvokeLocal.invokeLocalJava(
            'java',
            'com.serverless.Handler',
            'handleRequest',
            tmpServicePath,
            {}
          )
        ).to.be.eventually.rejected.and.have.property('code', 'JAVA_BRIDGE_BUILD_FAILED');

        expect(callJavaBridgeStub).to.not.have.been.called;
        expect(spawnExtStub.calledOnce).to.be.equal(true);
        expect(spawnExtStub.firstCall.args).to.deep.equal([
          'mvn',
          ['package', '-f', path.join(path.dirname(bridgePath), 'pom.xml')],
          { shouldCloseStdin: true },
        ]);
      });
    });
  });

  describe('#invokeLocalDocker()', () => {
    let pluginMangerSpawnStub;
    let pluginMangerSpawnPackageStub;
    let getAwsSdkV3CredentialsProviderStub;
    beforeEach(() => {
      awsInvokeLocal.provider.options.stage = 'dev';
      awsInvokeLocal.options = {
        'stage': 'dev',
        'function': 'first',
        'functionObj': {
          handler: 'handler.hello',
          name: 'hello',
          timeout: 4,
          runtime: 'nodejs20.x',
          environment: {
            functionVar: 'functionValue',
          },
        },
        'data': {},
        'env': 'commandLineEnvVar=commandLineEnvVarValue',
        'docker-arg': '-p 9292:9292',
      };
      serverless.service.provider.environment = {
        providerVar: 'providerValue',
      };
      pluginMangerSpawnStub = sinon.stub(serverless.pluginManager, 'spawn');
      pluginMangerSpawnPackageStub = pluginMangerSpawnStub.withArgs('package').resolves();
      getAwsSdkV3CredentialsProviderStub = sinon
        .stub(provider, 'getAwsSdkV3CredentialsProvider')
        .returns(
          sinon.stub().resolves({
            accessKeyId: 'foo',
            secretAccessKey: 'bar',
          })
        );
    });

    afterEach(() => {
      getAwsSdkV3CredentialsProviderStub.restore();
      serverless.pluginManager.spawn.restore();
      fs.rmSync('.serverless', { recursive: true, force: true });
    });

    it('calls docker with packaged artifact', async () => {
      await awsInvokeLocal.invokeLocalDocker();

      expect(pluginMangerSpawnPackageStub.calledOnce).to.equal(true);
      expect(spawnExtStub.getCall(0).args).to.deep.equal(['docker', ['version']]);
      expect(spawnExtStub.getCall(1).args).to.deep.equal([
        'docker',
        ['images', '-q', 'lambci/lambda:nodejs20.x'],
      ]);
      expect(spawnExtStub.getCall(3).args).to.deep.equal([
        'docker',
        [
          'run',
          '--rm',
          '-v',
          'servicePath:/var/task:ro,delegated',
          '--env',
          'AWS_REGION=us-east-1',
          '--env',
          'AWS_DEFAULT_REGION=us-east-1',
          '--env',
          'AWS_LAMBDA_LOG_GROUP_NAME=/aws/lambda/hello',
          '--env',
          'AWS_LAMBDA_FUNCTION_NAME=hello',
          '--env',
          'AWS_LAMBDA_FUNCTION_MEMORY_SIZE=1024',
          '--env',
          'AWS_ACCESS_KEY_ID=foo',
          '--env',
          'AWS_SECRET_ACCESS_KEY=bar',
          '--env',
          'providerVar=providerValue',
          '--env',
          'functionVar=functionValue',
          '--env',
          'commandLineEnvVar=commandLineEnvVarValue',
          '-p',
          '9292:9292',
          'sls-docker-nodejs20.x',
          'handler.hello',
          '{}',
        ],
      ]);
    });
  });

  describe('#getLayerPaths()', () => {
    it('rejects local layer paths with control characters', async () => {
      serverless.service.layers = {
        myLayer: { path: 'layer\nRUN whoami' },
      };
      awsInvokeLocal.options.functionObj = { layers: [] };

      await expect(awsInvokeLocal.getLayerPaths()).to.be.rejected.then((error) => {
        expect(error).to.have.property('code', 'INVALID_LAYER_PATH');
        expect(error.message).to.include('layers.myLayer.path');
        expect(error.message).to.not.include('RUN whoami');
      });
    });

    it('does not reject unused malformed layer entries without paths', async () => {
      serverless.service.layers = {
        myLayer: null,
      };
      awsInvokeLocal.options.functionObj = { layers: [] };

      await expect(awsInvokeLocal.getLayerPaths()).to.eventually.deep.equal([]);
    });

    const createRemoteLayerTestContext = ({
      awsSdkV3Stub,
      cacheDirPath,
      copyStub,
      dirExistsStub,
      downloadStub,
      ensureDirStub,
    }) => {
      const ProxyquiredAwsInvokeLocal = proxyquire
        .noCallThru()
        .load('../../../../../../lib/plugins/aws/invoke-local/index', {
          ...awsSdkV3Stub.modulesCacheStub,
          '../../../utils/get-stdin': sinon.stub().resolves(''),
          '../../../utils/spawn': sinon.stub().resolves({ stdoutBuffer: Buffer.from('Mocked') }),
          'fs': {
            promises: {
              mkdir: ensureDirStub,
            },
          },
          '../../../utils/fs/copy': copyStub,
          '../../../utils/resolve-cache-dir': sinon.stub().returns(cacheDirPath),
          '../../../utils/fs/dir-exists': dirExistsStub,
          '../../../utils/serverless-utils/download': downloadStub,
        });
      const localOptions = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
      };
      const localServerless = new Serverless({ commands: [], options: {} });
      localServerless.serviceDir = 'servicePath';
      localServerless.cli = new CLI(localServerless);
      localServerless.processedInput = { commands: ['invoke'] };
      localServerless.service.layers = {};

      const localProvider = new AwsProvider(localServerless, localOptions);
      localServerless.setProvider('aws', localProvider);
      const invokeLocal = new ProxyquiredAwsInvokeLocal(localServerless, localOptions);
      invokeLocal.provider = localProvider;

      return { invokeLocal, localServerless };
    };

    it('downloads remote layers from the provider content location', async () => {
      const cacheDirPath = path.join(os.tmpdir(), 'serverless-cache');
      const downloadStub = sinon.stub().resolves();
      const dirExistsStub = sinon.stub().resolves(false);
      const ensureDirStub = sinon.stub().resolves();
      const copyStub = sinon.stub().resolves();
      const spawnExtLocalStub = sinon.stub().resolves({
        stdoutBuffer: Buffer.from('Mocked output'),
      });
      const awsSdkV3Stub = configureAwsSdkV3Stub({
        Lambda: {
          getLayerVersion: {
            Content: {
              Location: 'https://layers.example.test/download?Signature=opaque',
            },
          },
        },
      });

      const ProxyquiredAwsInvokeLocal = proxyquire
        .noCallThru()
        .load('../../../../../../lib/plugins/aws/invoke-local/index', {
          ...awsSdkV3Stub.modulesCacheStub,
          '../../../utils/get-stdin': sinon.stub().resolves(''),
          '../../../utils/spawn': spawnExtLocalStub,
          'fs': {
            promises: {
              mkdir: ensureDirStub,
            },
          },
          '../../../utils/fs/copy': copyStub,
          '../../../utils/resolve-cache-dir': sinon.stub().returns(cacheDirPath),
          '../../../utils/fs/dir-exists': dirExistsStub,
          '../../../utils/serverless-utils/download': downloadStub,
        });

      const localOptions = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
      };
      const localServerless = new Serverless({ commands: [], options: {} });
      localServerless.serviceDir = 'servicePath';
      localServerless.cli = new CLI(localServerless);
      localServerless.processedInput = { commands: ['invoke'] };
      localServerless.service.layers = {};

      const localProvider = new AwsProvider(localServerless, localOptions);
      localServerless.setProvider('aws', localProvider);

      const invokeLocal = new ProxyquiredAwsInvokeLocal(localServerless, localOptions);
      invokeLocal.provider = localProvider;
      invokeLocal.options.functionObj = {
        layers: ['arn:aws:lambda:us-east-1:123456789012:layer:my-layer:3'],
      };

      const expectedLayerPath = path.join('.serverless', 'layers', 'my-layer', '3');
      const expectedCachePath = path.join(cacheDirPath, 'invokeLocal', 'layers', 'my-layer', '3');
      const expectedCredentials = localProvider.getAwsSdkV3CredentialsProvider();

      const result = await invokeLocal.getLayerPaths();

      expect(dirExistsStub.firstCall.args[0]).to.equal(expectedLayerPath);
      expect(dirExistsStub.secondCall.args[0]).to.equal(expectedCachePath);
      expect(ensureDirStub.calledOnceWithExactly(expectedCachePath, { recursive: true })).to.equal(
        true
      );
      expect(awsSdkV3Stub.sends).to.have.length(1);
      expect(awsSdkV3Stub.sends[0]).to.include({
        service: 'Lambda',
        method: 'getLayerVersion',
        commandName: 'GetLayerVersionCommand',
      });
      expect(awsSdkV3Stub.sends[0].input).to.deep.equal({
        LayerName: 'arn:aws:lambda:us-east-1:123456789012:layer:my-layer',
        VersionNumber: 3,
      });
      expect(awsSdkV3Stub.sends[0].clientConfig.region).to.equal('us-east-1');
      expect(awsSdkV3Stub.sends[0].clientConfig.credentials).to.equal(expectedCredentials);
      expect(
        downloadStub.calledOnceWithExactly(
          'https://layers.example.test/download?Signature=opaque',
          expectedCachePath,
          { extract: true }
        )
      ).to.equal(true);
      expect(copyStub.calledOnceWithExactly(expectedCachePath, expectedLayerPath)).to.equal(true);
      expect(result).to.deep.equal([expectedLayerPath]);
    });

    it('uses provider-level remote layers when function layers are not configured', async () => {
      const cacheDirPath = path.join(os.tmpdir(), 'serverless-cache');
      const downloadStub = sinon.stub().resolves();
      const dirExistsStub = sinon.stub().resolves(false);
      const ensureDirStub = sinon.stub().resolves();
      const copyStub = sinon.stub().resolves();
      const awsSdkV3Stub = configureAwsSdkV3Stub({
        Lambda: {
          getLayerVersion: {
            Content: {
              Location: 'https://layers.example.test/provider-layer.zip',
            },
          },
        },
      });
      const { invokeLocal, localServerless } = createRemoteLayerTestContext({
        awsSdkV3Stub,
        cacheDirPath,
        copyStub,
        dirExistsStub,
        downloadStub,
        ensureDirStub,
      });
      localServerless.service.provider.layers = [
        'arn:aws:lambda:us-east-1:123456789012:layer:provider-layer:7',
      ];
      invokeLocal.options.functionObj = {};

      const expectedLayerPath = path.join('.serverless', 'layers', 'provider-layer', '7');
      const expectedCachePath = path.join(
        cacheDirPath,
        'invokeLocal',
        'layers',
        'provider-layer',
        '7'
      );
      const result = await invokeLocal.getLayerPaths();

      expect(awsSdkV3Stub.sends).to.have.length(1);
      expect(awsSdkV3Stub.sends[0].input).to.deep.equal({
        LayerName: 'arn:aws:lambda:us-east-1:123456789012:layer:provider-layer',
        VersionNumber: 7,
      });
      expect(
        downloadStub.calledOnceWithExactly(
          'https://layers.example.test/provider-layer.zip',
          expectedCachePath,
          { extract: true }
        )
      ).to.equal(true);
      expect(copyStub.calledOnceWithExactly(expectedCachePath, expectedLayerPath)).to.equal(true);
      expect(result).to.deep.equal([expectedLayerPath]);
    });

    it('uses existing local remote layer contents without SDK lookup, download, or copy', async () => {
      const cacheDirPath = path.join(os.tmpdir(), 'serverless-cache');
      const downloadStub = sinon.stub().resolves();
      const dirExistsStub = sinon.stub().resolves(true);
      const ensureDirStub = sinon.stub().resolves();
      const copyStub = sinon.stub().resolves();
      const awsSdkV3Stub = configureAwsSdkV3Stub({
        Lambda: {
          getLayerVersion: {
            Content: { Location: 'https://layers.example.test/unused.zip' },
          },
        },
      });
      const { invokeLocal } = createRemoteLayerTestContext({
        awsSdkV3Stub,
        cacheDirPath,
        copyStub,
        dirExistsStub,
        downloadStub,
        ensureDirStub,
      });
      invokeLocal.options.functionObj = {
        layers: ['arn:aws:lambda:us-east-1:123456789012:layer:my-layer:3'],
      };

      const expectedLayerPath = path.join('.serverless', 'layers', 'my-layer', '3');
      const result = await invokeLocal.getLayerPaths();

      expect(dirExistsStub.calledOnceWithExactly(expectedLayerPath)).to.equal(true);
      expect(awsSdkV3Stub.sends).to.have.length(0);
      expect(ensureDirStub).to.not.have.been.called;
      expect(downloadStub).to.not.have.been.called;
      expect(copyStub).to.not.have.been.called;
      expect(result).to.deep.equal([expectedLayerPath]);
    });

    it('uses cached remote layer contents without SDK lookup or download', async () => {
      const cacheDirPath = path.join(os.tmpdir(), 'serverless-cache');
      const downloadStub = sinon.stub().resolves();
      const dirExistsStub = sinon.stub();
      dirExistsStub.onFirstCall().resolves(false).onSecondCall().resolves(true);
      const ensureDirStub = sinon.stub().resolves();
      const copyStub = sinon.stub().resolves();
      const awsSdkV3Stub = configureAwsSdkV3Stub({
        Lambda: {
          getLayerVersion: {
            Content: { Location: 'https://layers.example.test/unused.zip' },
          },
        },
      });
      const { invokeLocal } = createRemoteLayerTestContext({
        awsSdkV3Stub,
        cacheDirPath,
        copyStub,
        dirExistsStub,
        downloadStub,
        ensureDirStub,
      });
      invokeLocal.options.functionObj = {
        layers: ['arn:aws:lambda:us-east-1:123456789012:layer:my-layer:3'],
      };

      const expectedLayerPath = path.join('.serverless', 'layers', 'my-layer', '3');
      const expectedCachePath = path.join(cacheDirPath, 'invokeLocal', 'layers', 'my-layer', '3');
      const result = await invokeLocal.getLayerPaths();

      expect(dirExistsStub.firstCall.args[0]).to.equal(expectedLayerPath);
      expect(dirExistsStub.secondCall.args[0]).to.equal(expectedCachePath);
      expect(awsSdkV3Stub.sends).to.have.length(0);
      expect(ensureDirStub).to.not.have.been.called;
      expect(downloadStub).to.not.have.been.called;
      expect(copyStub.calledOnceWithExactly(expectedCachePath, expectedLayerPath)).to.equal(true);
      expect(result).to.deep.equal([expectedLayerPath]);
    });

    it('downloads, extracts, caches, and copies a remote layer from an opaque content location', async () => {
      const originalCwd = process.cwd();
      const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'invoke-local-layer-'));
      const zip = new AdmZip();
      zip.addFile('nodejs/node_modules/test-dep/index.js', Buffer.from('module.exports = 123;'));
      const zipBuffer = zip.toBuffer();

      const server = http.createServer((req, res) => {
        if (req.url === '/layer-download?Signature=opaque') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/zip');
          res.end(zipBuffer);
          return;
        }

        res.statusCode = 404;
        res.end();
      });

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${server.address().port}`;

      const ProxyquiredAwsInvokeLocal = proxyquire
        .noCallThru()
        .load('../../../../../../lib/plugins/aws/invoke-local/index', {
          ...configureAwsSdkV3Stub({
            Lambda: {
              getLayerVersion: {
                Content: {
                  Location: `${baseUrl}/layer-download?Signature=opaque`,
                },
              },
            },
          }).modulesCacheStub,
          '../../../utils/get-stdin': sinon.stub().resolves(''),
          '../../../utils/spawn': sinon.stub().resolves({
            stdoutBuffer: Buffer.from('Mocked output'),
          }),
          '../../../utils/resolve-cache-dir': sinon
            .stub()
            .returns(path.join(tempRoot, 'cache-root')),
        });

      try {
        process.chdir(tempRoot);

        const localOptions = {
          stage: 'dev',
          region: 'us-east-1',
          function: 'first',
        };
        const localServerless = new Serverless({ commands: [], options: {} });
        localServerless.serviceDir = tempRoot;
        localServerless.cli = new CLI(localServerless);
        localServerless.processedInput = { commands: ['invoke'] };
        localServerless.service.layers = {};

        const localProvider = new AwsProvider(localServerless, localOptions);
        localServerless.setProvider('aws', localProvider);

        const invokeLocal = new ProxyquiredAwsInvokeLocal(localServerless, localOptions);
        invokeLocal.provider = localProvider;
        invokeLocal.options.functionObj = {
          layers: ['arn:aws:lambda:us-east-1:123456789012:layer:my-layer:3'],
        };

        const result = await invokeLocal.getLayerPaths();
        const expectedLayerPath = path.join('.serverless', 'layers', 'my-layer', '3');
        const copiedFilePath = path.join(
          tempRoot,
          expectedLayerPath,
          'nodejs',
          'node_modules',
          'test-dep',
          'index.js'
        );
        const cachedFilePath = path.join(
          tempRoot,
          'cache-root',
          'invokeLocal',
          'layers',
          'my-layer',
          '3',
          'nodejs',
          'node_modules',
          'test-dep',
          'index.js'
        );

        expect(result).to.deep.equal([expectedLayerPath]);
        expect(await fsp.readFile(copiedFilePath, 'utf8')).to.equal('module.exports = 123;');
        expect(await fsp.readFile(cachedFilePath, 'utf8')).to.equal('module.exports = 123;');
      } finally {
        process.chdir(originalCwd);
        await new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
        await fsp.rm(tempRoot, { recursive: true, force: true });
      }
    });

    it('limits concurrent remote layer lookups to 6', async () => {
      const cacheDirPath = path.join(os.tmpdir(), 'serverless-cache');
      const pendingResolvers = [];
      let activeRequests = 0;
      let observedMaxActiveRequests = 0;
      const awsSdkV3Stub = configureAwsSdkV3Stub({
        Lambda: {
          getLayerVersion: async (input) => {
            activeRequests += 1;
            observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
            expect(activeRequests).to.be.at.most(6);
            await new Promise((resolve) => pendingResolvers.push(resolve));
            activeRequests -= 1;
            return {
              Content: {
                Location: `https://layers.example.test/${input.VersionNumber}.zip`,
              },
            };
          },
        },
      });
      const ProxyquiredAwsInvokeLocal = proxyquire
        .noCallThru()
        .load('../../../../../../lib/plugins/aws/invoke-local/index', {
          ...awsSdkV3Stub.modulesCacheStub,
          '../../../utils/get-stdin': sinon.stub().resolves(''),
          '../../../utils/spawn': sinon.stub().resolves({ stdoutBuffer: Buffer.from('Mocked') }),
          'fs': {
            promises: {
              mkdir: sinon.stub().resolves(),
            },
          },
          '../../../utils/fs/copy': sinon.stub().resolves(),
          '../../../utils/resolve-cache-dir': sinon.stub().returns(cacheDirPath),
          '../../../utils/fs/dir-exists': sinon.stub().resolves(false),
          '../../../utils/serverless-utils/download': sinon.stub().resolves(),
        });
      const localOptions = {
        stage: 'dev',
        region: 'us-east-1',
        function: 'first',
      };
      const localServerless = new Serverless({ commands: [], options: {} });
      localServerless.serviceDir = 'servicePath';
      localServerless.cli = new CLI(localServerless);
      localServerless.processedInput = { commands: ['invoke'] };
      localServerless.service.layers = {};
      const localProvider = new AwsProvider(localServerless, localOptions);
      localServerless.setProvider('aws', localProvider);
      const invokeLocal = new ProxyquiredAwsInvokeLocal(localServerless, localOptions);
      invokeLocal.provider = localProvider;
      invokeLocal.options.functionObj = {
        layers: Array.from(
          { length: 10 },
          (ignored, index) =>
            `arn:aws:lambda:us-east-1:123456789012:layer:layer-${index}:${index + 1}`
        ),
      };

      const promise = invokeLocal.getLayerPaths();

      for (let index = 0; index < 20 && pendingResolvers.length < 6; index += 1) {
        await Promise.resolve();
      }
      expect(observedMaxActiveRequests).to.equal(6);
      await releasePendingRequestsUntilSettled(pendingResolvers, promise);
      expect(observedMaxActiveRequests).to.equal(6);
      expect(awsSdkV3Stub.sends).to.have.length(10);
      expect(awsSdkV3Stub.clients.filter(({ service }) => service === 'Lambda')).to.have.length(1);
      const expectedCredentials = localProvider.getAwsSdkV3CredentialsProvider();
      expect(
        awsSdkV3Stub.sends.every(
          ({ clientConfig }) =>
            clientConfig.region === 'us-east-1' && clientConfig.credentials === expectedCredentials
        )
      ).to.equal(true);
    });
  });

  describe('#getEnvVarsFromOptions', () => {
    it('returns empty object when env option is not set', () => {
      delete awsInvokeLocal.options.env;

      const envVarsFromOptions = awsInvokeLocal.getEnvVarsFromOptions();

      expect(envVarsFromOptions).to.be.eql({});
    });

    it('returns empty object when env option empty', () => {
      awsInvokeLocal.options.env = '';

      const envVarsFromOptions = awsInvokeLocal.getEnvVarsFromOptions();

      expect(envVarsFromOptions).to.be.eql({});
    });

    it('returns key value for option separated by =', () => {
      awsInvokeLocal.options.env = 'SOME_ENV_VAR=some-value';

      const envVarsFromOptions = awsInvokeLocal.getEnvVarsFromOptions();

      expect(envVarsFromOptions).to.be.eql({ SOME_ENV_VAR: 'some-value' });
    });

    it('returns key with empty value for option without =', () => {
      awsInvokeLocal.options.env = 'SOME_ENV_VAR';

      const envVarsFromOptions = awsInvokeLocal.getEnvVarsFromOptions();

      expect(envVarsFromOptions).to.be.eql({ SOME_ENV_VAR: '' });
    });

    it('returns key with single value for option multiple =s', () => {
      awsInvokeLocal.options.env = 'SOME_ENV_VAR=value1=value2';

      const envVarsFromOptions = awsInvokeLocal.getEnvVarsFromOptions();

      expect(envVarsFromOptions).to.be.eql({ SOME_ENV_VAR: 'value1=value2' });
    });

    it('accepts --env __proto__=value without polluting Object.prototype', () => {
      awsInvokeLocal.options.env = '__proto__=adversarial';

      const result = awsInvokeLocal.getEnvVarsFromOptions();

      expect(Reflect.get(result, '__proto__')).to.equal('adversarial');
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).to.equal(true);
      expect({}.adversarial).to.equal(undefined);
      expect({}.polluted).to.equal(undefined);
    });

    it('accepts --env constructor=value without changing Object.prototype.constructor', () => {
      awsInvokeLocal.options.env = 'constructor=fake';
      const originalConstructor = Object.prototype.constructor;

      const result = awsInvokeLocal.getEnvVarsFromOptions();

      expect(result.constructor).to.equal('fake');
      expect(Object.prototype.constructor).to.equal(originalConstructor);
    });

    it('accepts multiple unsafe-named --env flags together', () => {
      awsInvokeLocal.options.env = [
        '__proto__=one',
        'constructor=two',
        'prototype=three',
        'SAFE=four',
      ];

      const result = awsInvokeLocal.getEnvVarsFromOptions();

      expect(Object.keys(result).sort()).to.deep.equal(
        ['__proto__', 'SAFE', 'constructor', 'prototype'].sort()
      );
      expect(Reflect.get(result, '__proto__')).to.equal('one');
      expect(result.constructor).to.equal('two');
      expect(result.prototype).to.equal('three');
      expect(result.SAFE).to.equal('four');
      expect({}.polluted).to.equal(undefined);
    });
  });

  describe('#getDockerArgsFromOptions', () => {
    it('returns empty list when docker-arg option is absent', () => {
      delete awsInvokeLocal.options['docker-arg'];

      const dockerArgsFromOptions = awsInvokeLocal.getDockerArgsFromOptions();

      expect(dockerArgsFromOptions).to.eql([]);
    });

    it('returns arg split by space when single docker-arg option is present', () => {
      awsInvokeLocal.options['docker-arg'] = '-p 9229:9229';

      const dockerArgsFromOptions = awsInvokeLocal.getDockerArgsFromOptions();

      expect(dockerArgsFromOptions).to.eql(['-p', '9229:9229']);
    });

    it('returns args split by space when multiple docker-arg options are present', () => {
      awsInvokeLocal.options['docker-arg'] = ['-p 9229:9229', '-v /var/logs:/host-var-logs'];

      const dockerArgsFromOptions = awsInvokeLocal.getDockerArgsFromOptions();

      expect(dockerArgsFromOptions).to.eql(['-p', '9229:9229', '-v', '/var/logs:/host-var-logs']);
    });

    it('returns arg split only by first space when docker-arg option has multiple space', () => {
      awsInvokeLocal.options['docker-arg'] = '-v /My Docs:/docs';

      const dockerArgsFromOptions = awsInvokeLocal.getDockerArgsFromOptions();

      expect(dockerArgsFromOptions).to.eql(['-v', '/My Docs:/docs']);
    });
  });
});

describe('test/unit/lib/plugins/aws/invokeLocal/index.test.js', () => {
  const testRuntime = (
    functionName,
    { cliOptions = {}, shouldTestInputResolution = false, shouldAssertNodeEnv = false } = {}
  ) => {
    if (shouldTestInputResolution) {
      describe('Input resolution', () => {
        const parsedJsonData = { inputKey: 'inputValue' };
        const parsedContext = { clientContext: { custom: { customKey: 'customValue' } } };
        const expectedPayloadData = { dataInputKey: 'dataInputValue' };

        it('should accept no data', async () => {
          const { responseBody } = await runInvokeLocal({ functionName, options: cliOptions });

          expect(responseBody.event).to.equal('');
        });

        it('should support plain string data', async () => {
          const { responseBody } = await runInvokeLocal({
            functionName,
            options: { ...cliOptions, data: 'inputData' },
          });

          expect(responseBody.event).to.equal('inputData');
        });

        describe('Automated JSON parsing', () => {
          it('should support JSON string data', async () => {
            const { responseBody } = await runInvokeLocal({
              functionName,
              options: { ...cliOptions, data: JSON.stringify(parsedJsonData) },
            });

            expect(responseBody.event).to.deep.equal(parsedJsonData);
          });

          it('should support JSON string client context', async () => {
            const { responseBody } = await runInvokeLocal({
              functionName,
              options: { ...cliOptions, context: JSON.stringify(parsedContext) },
            });

            expect(responseBody.clientContext).to.deep.equal(parsedContext.clientContext);
          });
        });

        describe('"--raw" option', () => {
          it('should not attempt to parse data with raw option', async () => {
            const rawData = JSON.stringify(parsedJsonData);
            const { responseBody } = await runInvokeLocal({
              functionName,
              options: { ...cliOptions, data: rawData, raw: true },
            });

            expect(responseBody.event).to.equal(rawData);
          });

          it('should not attempt to parse client context with raw option', async () => {
            const rawContext = JSON.stringify(parsedContext);
            const { servicePath, updateConfig, writeFile } =
              await setupProgrammaticFixture('invocation');
            await writeFile(
              'raw-context.js',
              [
                "'use strict';",
                '',
                'module.exports.handler = (event, context) => ({',
                '  statusCode: 200,',
                '  body: JSON.stringify({ context }),',
                '});',
              ].join('\n')
            );
            await updateConfig({
              functions: {
                rawContext: {
                  handler: 'raw-context.handler',
                },
              },
            });

            const { responseBody } = await runInvokeLocal({
              cwd: servicePath,
              functionName: 'rawContext',
              options: { ...cliOptions, context: rawContext, raw: true },
            });

            expect(responseBody.context).to.equal(rawContext);
          });
        });

        describe('File input', () => {
          it('should support JSON file path as data', async () => {
            const { responseBody } = await runInvokeLocal({
              functionName,
              options: { ...cliOptions, path: 'payload.json' },
            });

            expect(responseBody.event).to.deep.equal(expectedPayloadData);
          });

          it('should support JSON file path as client context', async () => {
            const { servicePath, writeFile } = await setupProgrammaticFixture('invocation');
            await writeFile('context-with-client-context.json', JSON.stringify(parsedContext));

            const { responseBody } = await runInvokeLocal({
              cwd: servicePath,
              functionName,
              options: { ...cliOptions, contextPath: 'context-with-client-context.json' },
            });

            expect(responseBody.clientContext).to.deep.equal(parsedContext.clientContext);
          });

          it('should support YAML file path as data', async () => {
            const { responseBody } = await runInvokeLocal({
              functionName,
              options: { ...cliOptions, path: 'payload.yaml' },
            });

            expect(responseBody.event).to.deep.equal(expectedPayloadData);
          });

          it('should support JS file path for data', async () => {
            const { responseBody } = await runInvokeLocal({
              functionName,
              options: { ...cliOptions, path: 'payload.js' },
            });

            expect(responseBody.event).to.deep.equal(expectedPayloadData);
          });

          it('should support absolute file path as data', async () => {
            const { servicePath } = await setupProgrammaticFixture('invocation');
            const { responseBody } = await runInvokeLocal({
              cwd: servicePath,
              functionName,
              options: { ...cliOptions, path: path.join(servicePath, 'payload.json') },
            });

            expect(responseBody.event).to.deep.equal(expectedPayloadData);
          });
        });

        it('should throw error if data file path does not exist', async () => {
          await expect(
            runInvokeLocal({
              functionName,
              options: { ...cliOptions, path: 'not-existing.yaml' },
            })
          ).to.eventually.be.rejected.and.have.property('code', 'INVOKE_LOCAL_MISSING_FILE');
        });

        it('should throw error if function does not exist', async () => {
          await expect(
            runInvokeLocal({
              functionName: 'notExisting',
              options: cliOptions,
            })
          ).to.eventually.be.rejected.and.have.property('code', 'FUNCTION_MISSING_IN_SERVICE');
        });
      });
    }

    describe('Environment variables', () => {
      let responseBody;
      let expectedFunctionName;

      before(async () => {
        const result = await runInvokeLocal({
          functionName,
          options: { ...cliOptions, env: 'PARAM_ENV_VAR=-Dblart=snort' },
          env: {
            AWS_ACCESS_KEY_ID: 'AAKIXXX',
            AWS_SECRET_ACCESS_KEY: 'ASAKXXX',
            AWS_SESSION_TOKEN: 'TOKENXXX',
          },
          configExt: {
            provider: {
              environment: {
                PROVIDER_LEVEL_VAR: 'PROVIDER_LEVEL_VAR_VALUE',
                NULL_VAR: null,
              },
              region: 'us-east-2',
            },
            functions: {
              [functionName]: {
                environment: {
                  FUNCTION_LEVEL_VAR: 'FUNCTION_LEVEL_VAR_VALUE',
                },
              },
            },
          },
        });
        responseBody = result.responseBody;
        expectedFunctionName = `${result.fixtureData.serviceConfig.service}-dev-${functionName}`;
      });

      it('should expose eventual AWS credentials in environment variables', () => {
        expect(responseBody.env.AWS_ACCESS_KEY_ID).to.equal('AAKIXXX');
        expect(responseBody.env.AWS_SECRET_ACCESS_KEY).to.equal('ASAKXXX');
        expect(responseBody.env.AWS_SESSION_TOKEN).to.equal('TOKENXXX');
      });

      it('should expose `provider.env` in environment variables', () => {
        expect(responseBody.env.PROVIDER_LEVEL_VAR).to.equal('PROVIDER_LEVEL_VAR_VALUE');
      });

      it('should expose `functions[].env` in environment variables', () => {
        expect(responseBody.env.FUNCTION_LEVEL_VAR).to.equal('FUNCTION_LEVEL_VAR_VALUE');
      });

      it('should expose `--env` vars in environment variables', () =>
        expect(responseBody.env.PARAM_ENV_VAR).to.equal('-Dblart=snort'));

      if (shouldAssertNodeEnv) {
        it('should expose default lambda environment variables', () => {
          expect(responseBody.env.LANG).to.equal('en_US.UTF-8');
          expect(responseBody.env.LD_LIBRARY_PATH).to.equal(
            '/var/lang/lib:/lib64:/usr/lib64:/var/runtime:/var/runtime/lib:/var/task:/var/task/lib'
          );
          expect(responseBody.env.LAMBDA_TASK_ROOT).to.equal('/var/task');
          expect(responseBody.env.LAMBDA_RUNTIME_DIR).to.equal('/var/runtime');
          expect(responseBody.env.AWS_LAMBDA_LOG_GROUP_NAME).to.equal(
            `/aws/lambda/${expectedFunctionName}`
          );
          expect(responseBody.env.AWS_LAMBDA_LOG_STREAM_NAME).to.equal(
            '2016/12/02/[$LATEST]f77ff5e4026c45bda9a9ebcec6bc9cad'
          );
          expect(responseBody.env.AWS_LAMBDA_FUNCTION_NAME).to.equal(expectedFunctionName);
          expect(responseBody.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE).to.equal('1024');
          expect(responseBody.env.AWS_LAMBDA_FUNCTION_VERSION).to.equal('$LATEST');
          expect(responseBody.env.NODE_PATH).to.equal(
            '/var/runtime:/var/task:/var/runtime/node_modules'
          );
        });
      }

      it('should resolve region from `service.provider` if not provided via option', () => {
        expect(responseBody.env.AWS_REGION).to.equal('us-east-2');
        expect(responseBody.env.AWS_DEFAULT_REGION).to.equal('us-east-2');
      });

      it('should not expose null environment variables', () =>
        expect(responseBody.env).to.not.have.property('NULL_VAR'));
    });
  };

  describe('Node.js', () => {
    testRuntime('callback', { shouldTestInputResolution: true, shouldAssertNodeEnv: true });

    it('should support success resolution via async function', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'async' },
      });

      expect(output).to.include('Invoked');
    });

    it('should support success resolution via context.done', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'contextDone' },
      });

      expect(output).to.include('Invoked');
    });

    it('should support success resolution via context.succeed', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'contextSucceed' },
      });

      expect(output).to.include('Invoked');
    });

    it('should support immediate failure at initialization', async () => {
      await expect(
        runServerless({
          fixture: 'invocation',
          command: 'invoke local',
          options: { function: 'initFail' },
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'INVOKE_LOCAL_LAMBDA_INITIALIZATION_FAILED'
      );
    });

    it('should support immediate failure at invocation', async () => {
      await expect(
        runServerless({
          fixture: 'invocation',
          command: 'invoke local',
          options: { function: 'invocationFail' },
        })
      ).to.eventually.be.rejectedWith('Invocation fail');
    });

    it('should support failure resolution via async function', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'async', data: '{"shouldFail":true}' },
      });

      expect(output).to.include('Failed on request');
    });

    it('should support failure resolution via callback', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'callback', data: '{"shouldFail":true}' },
      });

      expect(output).to.include('Failed on request');
    });

    it('should support failure resolution via context.done', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'contextDone', data: '{"shouldFail":true}' },
      });

      expect(output).to.include('Failed on request');
    });

    it('should support failure resolution via context.fail', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'contextSucceed', data: '{"shouldFail":true}' },
      });

      expect(output).to.include('Failed on request');
    });

    it('should recognize first resolution', async () => {
      const { output: firstRunOutput } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'doubledResolutionCallbackFirst' },
      });
      const { output: secondRunOutput } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'doubledResolutionPromiseFirst' },
      });

      expect(firstRunOutput).to.include('callback');
      expect(secondRunOutput).to.include('promise');
    });

    it('should support context.remainingTimeInMillis()', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'remainingTime' },
      });

      const body = parseJsonOutput(output).body;
      const [firstRemainingMs, secondRemainingMs, thirdRemainingMs] = JSON.parse(body).data;
      expect(firstRemainingMs).to.be.lte(3000);
      expect(secondRemainingMs).to.be.lte(2910);
      expect(thirdRemainingMs).to.be.lte(secondRemainingMs);
    });

    it('should support handlers with `.cjs` extension', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'asyncCjs' },
      });

      expect(output).to.include('Invoked');
    });
    it('should support handlers that are ES modules', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'asyncEsm' },
      });

      expect(output).to.include('Invoked');
    });
    it('should support ES module handlers whose path contains URL-significant characters', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'asyncEsmSpecialPath' },
      });

      expect(output).to.include('Invoked');
    });
  });

  describe('Python', function () {
    // First real child-process spawns of the suite; Windows runners show rare
    // multi-tens-of-seconds AV/disk stalls on first interpreter execution.
    this.timeout(180000);

    before(async function () {
      const executable = process.platform === 'win32' ? 'python.exe' : 'python';
      try {
        await spawnExt(executable, ['--version']);
        // Full interpreter boot and stdin round trip, so first-execution
        // scanning cost lands here instead of in a fixture-running hook.
        await spawnExt(executable, ['-c', 'import json,sys; json.load(sys.stdin)'], {
          input: '{}',
        });
      } catch {
        skipWithNotice(this, 'Python runtime is not installed');
      }
    });

    testRuntime('python');
    describe('context.remainingTimeInMillis', () => {
      it('should support context.get_remaining_time_in_millis()', async () => {
        const { output } = await runServerless({
          fixture: 'invocation',
          command: 'invoke local',
          options: { function: 'pythonRemainingTime' },
        });

        const { start, stop } = parseJsonOutput(output);
        expect(start).to.lte(3000);
        expect(stop).to.lte(2910);
      });
    });
  });

  describe('Ruby', function () {
    // First real child-process spawns of the suite; Windows runners show rare
    // multi-tens-of-seconds AV/disk stalls on first interpreter execution.
    this.timeout(180000);

    before(async function () {
      const executable = process.platform === 'win32' ? 'ruby.exe' : 'ruby';
      try {
        await spawnExt(executable, ['--version']);
        // Full interpreter boot and stdin round trip, so first-execution
        // scanning cost lands here instead of in a fixture-running hook.
        await spawnExt(executable, ['-e', 'require "json"; JSON.parse(STDIN.read)'], {
          input: '{}',
        });
      } catch {
        skipWithNotice(this, 'Ruby runtime is not installed');
      }
    });

    testRuntime('ruby');

    it('should support class/module address in handler for "ruby*" runtime', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'rubyClass' },
      });

      expect(output).to.include('rubyclass');
    });
    it('should support context.get_remaining_time_in_millis()', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'rubyRemainingTime' },
      });

      const { start, stop } = parseJsonOutput(output);
      expect(start).to.lte(6000);
      expect(stop).to.lte(5910);
    });
    it('should support context.deadline_ms', async () => {
      const { output } = await runServerless({
        fixture: 'invocation',
        command: 'invoke local',
        options: { function: 'rubyDeadline' },
      });

      const { deadlineMs } = parseJsonOutput(output);
      expect(deadlineMs).to.be.gt(Date.now());
    });
  });

  describe.skip('Java', () => {
    // If Java runtime is not installed, skip below tests by:
    // - Invoke skip with notice as here;
    // https://github.com/serverless/serverless/blob/2d6824cde531ba56758f441b39b5ab018702e866/lib/plugins/aws/invokeLocal/index.test.js#L1043-L1045
    // - Ensure all other tests are skipped
    testRuntime('java'); // TODO: Configure java handler
  });

  describe.skip('Docker', () => {
    // If Docker is not installed, skip below tests by:
    // - Invoke skip with notice as here;
    // https://github.com/serverless/serverless/blob/2d6824cde531ba56758f441b39b5ab018702e866/lib/plugins/aws/invokeLocal/index.test.js#L1043-L1045
    // - Ensure all other tests are skipped

    testRuntime('callback', { cliOptions: { docker: true } });
    it('TODO: should support custom runtimes in docker invocation', () => {});
  });
});
