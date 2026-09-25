'use strict';

const chai = require('chai');
const path = require('path');
const fs = require('fs');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { overrideEnv } = require('../../../../utils/process');

const AwsProvider = require('../../../../../lib/plugins/aws/provider');
const awsCredentialsDocsUrl = require('../../../../../lib/aws/credentials-help-url');
const Serverless = require('../../../../../lib/serverless');
const ServerlessError = require('../../../../../lib/serverless-error');
const runServerless = require('../../../../utils/run-serverless');
const {
  CloudFormationClient,
  DescribeStackResourceCommand,
  ListStackResourcesCommand,
} = require('@aws-sdk/client-cloudformation');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

const expect = chai.expect;
const spawnModulePath = path.resolve(__dirname, '../../../../../lib/utils/spawn.js');

const createProviderStub = ({ provider = {}, config = {}, providerOptions = {} } = {}) => {
  const providerStub = Object.create(AwsProvider.prototype);
  providerStub.options = { ...providerOptions };
  providerStub.serverless = {
    config,
    service: { provider },
  };
  return providerStub;
};

describe('AwsProvider', () => {
  let awsProvider;
  let serverless;
  let restoreEnv;
  const options = {
    stage: 'dev',
    region: 'us-east-1',
  };

  const createServerless = (serverlessOptions = {}) => {
    const serverlessInstance = new Serverless({
      ...options,
      commands: [],
      options: {},
      ...serverlessOptions,
    });
    serverlessInstance.cli = new serverlessInstance.classes.CLI();
    return serverlessInstance;
  };

  const createAwsProvider = ({ serverlessOptions, providerOptions = options } = {}) => {
    const serverlessInstance = createServerless(serverlessOptions);
    return {
      serverless: serverlessInstance,
      awsProvider: new AwsProvider(serverlessInstance, providerOptions),
    };
  };

  beforeEach(() => {
    ({ restoreEnv } = overrideEnv());
    awsProvider = createProviderStub({ providerOptions: options });
    serverless = awsProvider.serverless;
  });
  afterEach(() => {
    if (CloudFormationClient.prototype.send.restore) {
      CloudFormationClient.prototype.send.restore();
    }
    restoreEnv();
  });

  describe('removed AWS SDK v2 surface', () => {
    it('throws a guided error from provider.request()', () => {
      expect(() => awsProvider.request('S3', 'getObject', {}))
        .to.throw(ServerlessError, /provider\.getAwsSdkV3Config\(\)/)
        .with.property('code', 'AWS_SDK_V2_SURFACE_REMOVED');
    });

    it('throws a guided error from provider.getCredentials()', () => {
      expect(() => awsProvider.getCredentials())
        .to.throw(ServerlessError)
        .with.property('code', 'AWS_SDK_V2_SURFACE_REMOVED');
    });

    it('throws a guided error when accessing provider.sdk', () => {
      expect(() => awsProvider.sdk)
        .to.throw(ServerlessError)
        .with.property('code', 'AWS_SDK_V2_SURFACE_REMOVED');
    });
  });

  describe('#getRuntime()', () => {
    it('should default to "nodejs24.x" when no runtime is configured', () => {
      expect(awsProvider.getRuntime()).to.equal('nodejs24.x');
    });

    it('should use provider.runtime when no explicit runtime is passed', () => {
      serverless.service.provider.runtime = 'nodejs22.x';

      expect(awsProvider.getRuntime()).to.equal('nodejs22.x');
    });

    it('should prefer an explicit runtime argument over provider.runtime', () => {
      serverless.service.provider.runtime = 'nodejs22.x';

      expect(awsProvider.getRuntime('python3.13')).to.equal('python3.13');
    });
  });

  describe('#resolveFunctionRuntimeManagement()', () => {
    it('should default runtime management to auto', () => {
      expect(awsProvider.resolveFunctionRuntimeManagement()).to.deep.equal({
        mode: 'auto',
      });
    });

    it('should merge provider and function runtime management with function precedence', () => {
      serverless.service.provider.runtimeManagement = 'manual';

      expect(awsProvider.resolveFunctionRuntimeManagement({ mode: 'auto' })).to.deep.equal({
        mode: 'auto',
      });
    });
  });

  describe('#getCustomDeploymentRole()', () => {
    it('should prefer provider.iam.deploymentRole over cfnRole', () => {
      serverless.service.provider.cfnRole = 'arn:aws:iam::123:role/cfn';
      serverless.service.provider.iam = {
        deploymentRole: 'arn:aws:iam::123:role/deploy',
      };

      expect(awsProvider.getCustomDeploymentRole()).to.equal('arn:aws:iam::123:role/deploy');
    });

    it('should fall back to cfnRole when iam.deploymentRole is undefined', () => {
      serverless.service.provider.cfnRole = 'arn:aws:iam::123:role/cfn';
      serverless.service.provider.iam = {};

      expect(awsProvider.getCustomDeploymentRole()).to.equal('arn:aws:iam::123:role/cfn');
    });

    it('should preserve an explicit null deployment role', () => {
      serverless.service.provider.cfnRole = 'arn:aws:iam::123:role/cfn';
      serverless.service.provider.iam = {
        deploymentRole: null,
      };

      expect(awsProvider.getCustomDeploymentRole()).to.equal(null);
    });
  });

  describe('#getCustomExecutionRole()', () => {
    it('ignores inherited function roles', () => {
      serverless.service.provider.role = 'OwnProviderRole';
      const functionObj = Object.create({ role: 'InheritedFunctionRole' });

      expect(awsProvider.getCustomExecutionRole(functionObj)).to.equal('OwnProviderRole');
    });

    it('ignores inherited provider iam roles', () => {
      serverless.service.provider.iam = Object.create({ role: 'InheritedIamRole' });
      serverless.service.provider.role = 'OwnProviderRole';

      expect(awsProvider.getCustomExecutionRole({})).to.equal('OwnProviderRole');
    });
  });

  describe('#resolveFunctionIamRoleResourceName()', () => {
    it('ignores inherited Fn::GetAtt role references', () => {
      const functionObj = {
        role: Object.create({ 'Fn::GetAtt': ['InjectedRole', 'Arn'] }),
      };

      expect(awsProvider.resolveFunctionIamRoleResourceName(functionObj)).to.equal(
        'IamRoleLambdaExecution'
      );
    });

    it('ignores inherited Ref role references', () => {
      const functionObj = {
        role: Object.create({ Ref: 'ImportedRole' }),
      };

      expect(awsProvider.resolveFunctionIamRoleResourceName(functionObj)).to.equal(
        'IamRoleLambdaExecution'
      );
    });
  });

  describe('runtime schema parity', () => {
    it('should keep `awsLambdaRuntime` in sync with `AwsLambdaRuntime`', () => {
      const localServerless = createServerless();
      const runtimeTypePath = path.resolve(__dirname, '../../../../../types/index.d.ts');
      const runtimeTypeSource = fs.readFileSync(runtimeTypePath, 'utf8');

      localServerless.service.provider.name = 'aws';
      const localAwsProvider = new AwsProvider(localServerless, options);
      expect(localAwsProvider.serverless).to.equal(localServerless);

      const runtimeTypeMatch = runtimeTypeSource.match(
        /export type AwsLambdaRuntime\s*=\s*([\s\S]*?);/
      );

      if (!runtimeTypeMatch) {
        throw new Error('Could not find AwsLambdaRuntime type declaration');
      }

      const providerRuntimes = [
        ...localServerless.configSchemaHandler.schema.definitions.awsLambdaRuntime.enum,
      ].sort();
      const typeRuntimes = [...runtimeTypeMatch[1].matchAll(/'([^']+)'/g)]
        .map((match) => match[1])
        .sort();
      const missingInTypes = providerRuntimes.filter((runtime) => !typeRuntimes.includes(runtime));
      const missingInProvider = typeRuntimes.filter(
        (runtime) => !providerRuntimes.includes(runtime)
      );

      expect(
        providerRuntimes,
        `awsLambdaRuntime mismatch:\nmissing in types: ${
          missingInTypes.join(', ') || 'none'
        }\nmissing in provider: ${missingInProvider.join(', ') || 'none'}`
      ).to.deep.equal(typeRuntimes);
    });
  });

  describe('#constructor()', () => {
    beforeEach(() => {
      ({ serverless, awsProvider } = createAwsProvider());
    });

    it('should set Serverless instance', () => {
      expect(typeof awsProvider.serverless).to.not.equal('undefined');
    });

    it('should set the provider property', () => {
      expect(awsProvider.provider).to.equal(awsProvider);
    });

    describe('stage name validation', () => {
      const stages = ['myStage', 'my-stage', 'my_stage', "${opt:stage, 'prod'}"];
      stages.forEach((stage) => {
        it(`should not throw an error before variable population
            even if http event is present and stage is ${stage}`, () => {
          const config = {
            stage,
            commands: [],
            options: {},
          };
          serverless = new Serverless(config);

          const serverlessYml = {
            service: 'new-service',
            provider: {
              name: 'aws',
              stage,
            },
            functions: {
              first: {
                events: [
                  {
                    http: {
                      path: 'foo',
                      method: 'GET',
                    },
                  },
                ],
              },
            },
          };
          serverless.service = new serverless.classes.Service(serverless, serverlessYml);
          expect(() => new AwsProvider(serverless, config)).to.not.throw(Error);
        });
      });
    });

    describe('deletionProtection validation', () => {
      for (const [description, deletionProtection] of [
        ['boolean form', true],
        ['stage list form', { stages: ['prod'] }],
      ]) {
        it(`accepts ${description}`, async () => {
          await runServerless({
            fixture: 'function',
            command: 'print',
            configExt: {
              provider: {
                deletionProtection,
              },
            },
          });
        });
      }

      for (const [description, deletionProtection, message] of [
        ['empty stages', { stages: [] }, 'must NOT have fewer than 1 items'],
        ['enabled property', { enabled: true }, 'unrecognized property'],
      ]) {
        it(`rejects ${description}`, async () => {
          await expect(
            runServerless({
              fixture: 'function',
              command: 'print',
              configExt: {
                provider: {
                  deletionProtection,
                },
              },
            })
          ).to.eventually.be.rejectedWith(message);
        });
      }

      for (const [description, deletionProtection] of [
        ['stage array', ['prod']],
        ['stage string', 'prod'],
      ]) {
        it(`rejects ${description}`, async () => {
          await expect(
            runServerless({
              fixture: 'function',
              command: 'print',
              configExt: {
                provider: {
                  deletionProtection,
                },
              },
            })
          ).to.eventually.be.rejected.and.have.property(
            'code',
            'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
          );
        });
      }

      for (const [description, deletionProtection, expected] of [
        ['a string boolean', 'true', true],
        ['a single stage string', { stages: 'prod' }, { stages: ['prod'] }],
      ]) {
        it(`coerces ${description}`, async () => {
          const { serverless } = await runServerless({
            fixture: 'function',
            command: 'print',
            configExt: {
              provider: {
                deletionProtection,
              },
            },
          });
          expect(serverless.service.provider.deletionProtection).to.deep.equal(expected);
        });
      }
    });

    describe('deploymentMode validation', () => {
      it('rejects "EXPRESS"', async () => {
        await expect(
          runServerless({
            fixture: 'function',
            command: 'print',
            configExt: { provider: { deploymentMode: 'EXPRESS' } },
          })
        ).to.eventually.be.rejected.and.have.property(
          'code',
          'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
        );
      });
    });

    describe('deploymentBucket configuration', () => {
      it('should do nothing if not defined', () => {
        serverless.service.provider.deploymentBucket = undefined;

        const newAwsProvider = new AwsProvider(serverless, options);

        expect(newAwsProvider.serverless.service.provider.deploymentBucket).to.equal(undefined);
      });

      it('should do nothing if the value is a string', () => {
        serverless.service.provider.deploymentBucket = 'my.deployment.bucket';

        const newAwsProvider = new AwsProvider(serverless, options);

        expect(newAwsProvider.serverless.service.provider.deploymentBucket).to.equal(
          'my.deployment.bucket'
        );
      });
    });
  });

  describe('values', () => {
    const obj = {
      a: 'b',
      c: {
        d: 'e',
        f: {
          g: 'h',
        },
      },
    };
    const paths = [['a'], ['c', 'd'], ['c', 'f', 'g']];
    const getExpected = [
      { path: paths[0], value: obj.a },
      { path: paths[1], value: obj.c.d },
      { path: paths[2], value: obj.c.f.g },
    ];
    describe('#getValues', () => {
      it('should return an array of values given paths to them', () => {
        expect(awsProvider.getValues(obj, paths)).to.eql(getExpected);
      });
    });
    describe('#firstValue', () => {
      it("should ignore entries without a 'value' attribute", () => {
        const input = structuredClone(getExpected);
        delete input[0].value;
        delete input[2].value;
        expect(awsProvider.firstValue(input)).to.eql(getExpected[1]);
      });
      it("should ignore entries with an undefined 'value' attribute", () => {
        const input = structuredClone(getExpected);
        input[0].value = undefined;
        input[2].value = undefined;
        expect(awsProvider.firstValue(input)).to.eql(getExpected[1]);
      });
      it('should return the first value', () => {
        expect(awsProvider.firstValue(getExpected)).to.equal(getExpected[0]);
      });
      it('should return the middle value', () => {
        const input = structuredClone(getExpected);
        delete input[0].value;
        delete input[2].value;
        expect(awsProvider.firstValue(input)).to.equal(input[1]);
      });
      it('should return the last value', () => {
        const input = structuredClone(getExpected);
        delete input[0].value;
        delete input[1].value;
        expect(awsProvider.firstValue(input)).to.equal(input[2]);
      });
      it('should return the last object if none have valid values', () => {
        const input = structuredClone(getExpected);
        delete input[0].value;
        delete input[1].value;
        delete input[2].value;
        expect(awsProvider.firstValue(input)).to.equal(input[2]);
      });
    });
  });

  describe('#getAwsSdkV3Config()', () => {
    beforeEach(() => {
      ({ serverless, awsProvider } = createAwsProvider());
    });

    it('returns SDK v3 config with explicit region and env credentials', async () => {
      process.env.AWS_ACCESS_KEY_ID = 'accessKeyId';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretAccessKey';
      process.env.AWS_SESSION_TOKEN = 'sessionToken';

      const config = await awsProvider.getAwsSdkV3Config({ region: 'eu-west-1' });

      expect(config.region).to.equal('eu-west-1');
      expect(config.credentials).to.be.a('function');
      await expect(config.credentials()).to.eventually.deep.equal({
        accessKeyId: 'accessKeyId',
        secretAccessKey: 'secretAccessKey',
        sessionToken: 'sessionToken',
      });
    });

    it('prefers stage-specific env credentials over standard env credentials', async () => {
      process.env.AWS_ACCESS_KEY_ID = 'accessKeyId';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretAccessKey';
      process.env.AWS_DEV_ACCESS_KEY_ID = 'stageAccessKeyId';
      process.env.AWS_DEV_SECRET_ACCESS_KEY = 'stageSecretAccessKey';

      const config = await awsProvider.getAwsSdkV3Config();

      await expect(config.credentials()).to.eventually.deep.equal({
        accessKeyId: 'stageAccessKeyId',
        secretAccessKey: 'stageSecretAccessKey',
        sessionToken: undefined,
      });
    });

    it('includes SDK v3 request handler configuration', async () => {
      process.env.AWS_CLIENT_TIMEOUT = '1234';

      const config = await awsProvider.getAwsSdkV3Config();

      expect(config.requestHandler).to.exist;
    });

    it('falls back to provider region only when SDK v3 region is undefined', async () => {
      expect((await awsProvider.getAwsSdkV3Config({ region: undefined })).region).to.equal(
        'us-east-1'
      );
      expect((await awsProvider.getAwsSdkV3Config({ region: '' })).region).to.equal('');
      expect((await awsProvider.getAwsSdkV3Config({ region: null })).region).to.equal(null);
    });

    it('passes profile and custom options to the config helpers', async () => {
      const buildClientConfigStub = sinon.stub().returns({ config: true });
      const credentialsProvider = sinon
        .stub()
        .resolves({ accessKeyId: 'key', secretAccessKey: 'secret' });
      const getAwsSdkV3CredentialsProviderStub = sinon.stub().returns(credentialsProvider);
      const getAwsSdkV3CredentialsProviderCacheKeyStub = sinon.stub().returns('cache-key');
      const AwsProviderProxyquired = proxyquire
        .noCallThru()
        .load('../../../../../lib/plugins/aws/provider.js', {
          '../../aws/config': { buildClientConfig: buildClientConfigStub },
          '../../aws/credentials': {
            getAwsSdkV3CredentialsProviderCacheKey: getAwsSdkV3CredentialsProviderCacheKeyStub,
            getAwsSdkV3CredentialsProvider: getAwsSdkV3CredentialsProviderStub,
          },
        });
      const provider = new AwsProviderProxyquired(serverless, options);

      const config = await provider.getAwsSdkV3Config({
        profile: 'custom-profile',
        maxAttempts: 2,
        retryMode: 'adaptive',
      });

      expect(config).to.deep.equal({ config: true });
      expect(getAwsSdkV3CredentialsProviderStub).to.have.been.calledOnceWithExactly({
        provider,
        profile: 'custom-profile',
      });
      expect(buildClientConfigStub).to.have.been.calledOnce;
      const buildConfigInput = buildClientConfigStub.firstCall.args[0];
      expect(buildConfigInput).to.include({
        maxAttempts: 2,
        retryMode: 'adaptive',
        region: 'us-east-1',
      });
      // The raw provider is wrapped in process-wide memoization
      expect(buildConfigInput.credentials).to.be.a('function');
      expect(buildConfigInput.credentials.memoized).to.equal(true);
      await expect(buildConfigInput.credentials({ caller: 'test' })).to.eventually.deep.equal({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      });
      expect(credentialsProvider).to.have.been.calledOnceWithExactly({ caller: 'test' });
    });

    it('normalizes generic SDK v3 missing credentials errors', async () => {
      const missingCredentialsError = new Error('Could not load credentials from any providers');
      const credentialsProvider = sinon.stub().rejects(missingCredentialsError);
      const AwsProviderProxyquired = proxyquire
        .noCallThru()
        .load('../../../../../lib/plugins/aws/provider.js', {
          '../../aws/credentials': {
            getAwsSdkV3CredentialsProviderCacheKey: sinon.stub().returns('cache-key'),
            getAwsSdkV3CredentialsProvider: sinon.stub().returns(credentialsProvider),
          },
        });
      const provider = new AwsProviderProxyquired(serverless, options);

      const config = await provider.getAwsSdkV3Config();

      try {
        await config.credentials();
        throw new Error('Expected credentials provider to reject');
      } catch (error) {
        expect(error.code).to.equal('AWS_CREDENTIALS_NOT_FOUND');
        expect(error.message).to.include(awsCredentialsDocsUrl);
      }
    });

    it('normalizes unrecognized profile errors', async () => {
      const profileError = Object.assign(
        new Error(
          'Could not resolve credentials using profile: [missing-profile] in configuration/credentials file(s).'
        ),
        { name: 'CredentialsProviderError' }
      );
      const credentialsProvider = sinon.stub().rejects(profileError);
      const AwsProviderProxyquired = proxyquire
        .noCallThru()
        .load('../../../../../lib/plugins/aws/provider.js', {
          '../../aws/credentials': {
            getAwsSdkV3CredentialsProviderCacheKey: sinon.stub().returns('cache-key'),
            getAwsSdkV3CredentialsProvider: sinon.stub().returns(credentialsProvider),
          },
        });
      const provider = new AwsProviderProxyquired(serverless, options);

      const config = await provider.getAwsSdkV3Config();

      try {
        await config.credentials();
        throw new Error('Expected credentials provider to reject');
      } catch (error) {
        expect(error.code).to.equal('UNRECOGNIZED_AWS_PROFILE');
        expect(error.message).to.include('missing-profile');
      }
    });

    it('does not normalize inherited generic SDK v3 missing credentials messages', async () => {
      const inheritedMissingCredentialsError = Object.create({
        message: 'Could not load credentials from any providers',
      });
      const credentialsProvider = sinon.stub().rejects(inheritedMissingCredentialsError);
      const AwsProviderProxyquired = proxyquire
        .noCallThru()
        .load('../../../../../lib/plugins/aws/provider.js', {
          '../../aws/credentials': {
            getAwsSdkV3CredentialsProviderCacheKey: sinon.stub().returns('cache-key'),
            getAwsSdkV3CredentialsProvider: sinon.stub().returns(credentialsProvider),
          },
        });
      const provider = new AwsProviderProxyquired(serverless, options);

      const config = await provider.getAwsSdkV3Config();

      try {
        await config.credentials();
        throw new Error('Expected credentials provider to reject');
      } catch (error) {
        expect(error).to.equal(inheritedMissingCredentialsError);
        expect(error.code).to.equal(undefined);
      }
    });

    it('does not normalize specific SDK v3 credential provider errors', async () => {
      const ssoError = Object.assign(new Error('The SSO session has expired'), {
        name: 'CredentialsProviderError',
      });
      const credentialsProvider = sinon.stub().rejects(ssoError);
      const AwsProviderProxyquired = proxyquire
        .noCallThru()
        .load('../../../../../lib/plugins/aws/provider.js', {
          '../../aws/credentials': {
            getAwsSdkV3CredentialsProviderCacheKey: sinon.stub().returns('cache-key'),
            getAwsSdkV3CredentialsProvider: sinon.stub().returns(credentialsProvider),
          },
        });
      const provider = new AwsProviderProxyquired(serverless, options);

      const config = await provider.getAwsSdkV3Config();

      try {
        await config.credentials();
        throw new Error('Expected credentials provider to reject');
      } catch (error) {
        expect(error).to.equal(ssoError);
        expect(error.code).to.not.equal('AWS_CREDENTIALS_NOT_FOUND');
      }
    });

    it('does not mask credential provider errors with non-string messages', async () => {
      const nonStringMessageError = { message: { text: 'Could not load credentials' } };
      const credentialsProvider = sinon.stub().rejects(nonStringMessageError);
      const AwsProviderProxyquired = proxyquire
        .noCallThru()
        .load('../../../../../lib/plugins/aws/provider.js', {
          '../../aws/credentials': {
            getAwsSdkV3CredentialsProviderCacheKey: sinon.stub().returns('cache-key'),
            getAwsSdkV3CredentialsProvider: sinon.stub().returns(credentialsProvider),
          },
        });
      const provider = new AwsProviderProxyquired(serverless, options);

      const config = await provider.getAwsSdkV3Config();

      try {
        await config.credentials();
        throw new Error('Expected credentials provider to reject');
      } catch (error) {
        expect(error).to.equal(nonStringMessageError);
      }
    });

    it('memoizes credential resolution across clients sharing a provider', async () => {
      const resolvedCredentials = { accessKeyId: 'accessKeyId', secretAccessKey: 'secret' };
      const baseProvider = sinon.stub().resolves(resolvedCredentials);
      const AwsProviderProxyquired = proxyquire
        .noCallThru()
        .load('../../../../../lib/plugins/aws/provider.js', {
          '../../aws/credentials': {
            getAwsSdkV3CredentialsProviderCacheKey: sinon.stub().returns('cache-key'),
            getAwsSdkV3CredentialsProvider: sinon.stub().returns(baseProvider),
          },
        });
      const provider = new AwsProviderProxyquired(serverless, options);

      const credentialsProvider = provider.getAwsSdkV3CredentialsProvider();

      expect(credentialsProvider.memoized).to.equal(true);
      await expect(credentialsProvider()).to.eventually.deep.equal(resolvedCredentials);
      await expect(credentialsProvider()).to.eventually.deep.equal(resolvedCredentials);
      // A second client obtaining the provider must not trigger another resolution either
      await expect(provider.getAwsSdkV3CredentialsProvider()()).to.eventually.deep.equal(
        resolvedCredentials
      );
      expect(baseProvider).to.have.been.calledOnce;
    });

    it('reuses SDK v3 credential providers for the same credential source', async () => {
      const firstConfig = await awsProvider.getAwsSdkV3Config();
      const secondConfig = await awsProvider.getAwsSdkV3Config();

      expect(firstConfig.credentials).to.equal(secondConfig.credentials);
    });

    it('uses different SDK v3 credential providers for different explicit profiles', async () => {
      const firstConfig = await awsProvider.getAwsSdkV3Config({ profile: 'first' });
      const secondConfig = await awsProvider.getAwsSdkV3Config({ profile: 'second' });

      expect(firstConfig.credentials).to.not.equal(secondConfig.credentials);
    });

    it('passes SDK v3 client options through without leaking Serverless metadata options', async () => {
      const requestHandler = {};

      const config = await awsProvider.getAwsSdkV3Config({
        service: 'S3',
        profile: 'custom-profile',
        endpoint: 'http://localhost:4566',
        forcePathStyle: true,
        requestHandler,
      });

      expect(config).to.include({
        endpoint: 'http://localhost:4566',
        forcePathStyle: true,
        requestHandler,
      });
      expect(config).to.not.have.property('service');
      expect(config).to.not.have.property('profile');
    });

    it('does not implicitly enable S3 acceleration for SDK v3 S3 configs', async () => {
      awsProvider.options['aws-s3-accelerate'] = true;

      const config = await awsProvider.getAwsSdkV3Config({ service: 'S3' });

      expect(config).to.not.have.property('useAccelerateEndpoint');
    });

    it('preserves explicit SDK v3 S3 acceleration options', async () => {
      awsProvider.options['aws-s3-accelerate'] = true;

      const enabledConfig = await awsProvider.getAwsSdkV3Config({
        service: 'S3',
        useAccelerateEndpoint: true,
      });
      const disabledConfig = await awsProvider.getAwsSdkV3Config({
        service: 'S3',
        useAccelerateEndpoint: false,
      });

      expect(enabledConfig.useAccelerateEndpoint).to.equal(true);
      expect(disabledConfig.useAccelerateEndpoint).to.equal(false);
    });
  });

  describe('#getServerlessDeploymentBucketName()', () => {
    beforeEach(() => {
      ({ awsProvider } = createAwsProvider());
    });

    it('should return the name of the serverless deployment bucket', async () => {
      const describeStackResourcesStub = sinon
        .stub(CloudFormationClient.prototype, 'send')
        .resolves({
          StackResourceDetail: {
            PhysicalResourceId: 'serverlessDeploymentBucketName',
          },
        });

      try {
        const bucketName = await awsProvider.getServerlessDeploymentBucketName();

        expect(bucketName).to.equal('serverlessDeploymentBucketName');
        expect(describeStackResourcesStub.calledOnce).to.be.equal(true);
        expect(describeStackResourcesStub.firstCall.args[0]).to.be.instanceOf(
          DescribeStackResourceCommand
        );
        expect(describeStackResourcesStub.firstCall.args[0].input).to.deep.equal({
          StackName: awsProvider.naming.getStackName(),
          LogicalResourceId: awsProvider.naming.getDeploymentBucketLogicalId(),
        });
      } finally {
        CloudFormationClient.prototype.send.restore();
      }
    });

    it('should return the name of the custom deployment bucket', async () => {
      awsProvider.serverless.service.provider.deploymentBucket = 'custom-bucket';

      const describeStackResourcesStub = sinon
        .stub(CloudFormationClient.prototype, 'send')
        .resolves({
          StackResourceDetail: {
            PhysicalResourceId: 'serverlessDeploymentBucketName',
          },
        });

      try {
        const bucketName = await awsProvider.getServerlessDeploymentBucketName();

        expect(describeStackResourcesStub.called).to.be.equal(false);
        expect(bucketName).to.equal('custom-bucket');
      } finally {
        CloudFormationClient.prototype.send.restore();
      }
    });

    it('reuses one CloudFormation client across deployment bucket lookups', async () => {
      const getAwsSdkV3ConfigSpy = sinon.spy(awsProvider, 'getAwsSdkV3Config');
      const describeStackResourceStub = sinon
        .stub(CloudFormationClient.prototype, 'send')
        .onFirstCall()
        .resolves({
          StackResourceDetail: {
            PhysicalResourceId: 'first-bucket',
          },
        })
        .onSecondCall()
        .resolves({
          StackResourceDetail: {
            PhysicalResourceId: 'second-bucket',
          },
        });

      try {
        await expect(awsProvider.getServerlessDeploymentBucketName()).to.eventually.equal(
          'first-bucket'
        );
        await expect(awsProvider.getServerlessDeploymentBucketName()).to.eventually.equal(
          'second-bucket'
        );

        expect(getAwsSdkV3ConfigSpy).to.have.been.calledOnce;
        expect(describeStackResourceStub).to.have.been.calledTwice;
        expect(describeStackResourceStub.firstCall.thisValue).to.equal(
          describeStackResourceStub.secondCall.thisValue
        );
      } finally {
        CloudFormationClient.prototype.send.restore();
        awsProvider.getAwsSdkV3Config.restore();
      }
    });
  });

  describe('#getStackResources()', () => {
    beforeEach(() => {
      ({ awsProvider } = createAwsProvider());
    });

    it('paginates ListStackResources with one SDK v3 client', async () => {
      const getAwsSdkV3ConfigSpy = sinon.spy(awsProvider, 'getAwsSdkV3Config');
      const listStackResourcesStub = sinon
        .stub(CloudFormationClient.prototype, 'send')
        .onFirstCall()
        .resolves({
          StackResourceSummaries: [{ LogicalResourceId: 'First' }],
          NextToken: 'next-page',
        })
        .onSecondCall()
        .resolves({
          StackResourceSummaries: [{ LogicalResourceId: 'Second' }],
        });

      const resources = await awsProvider.getStackResources();

      expect(resources).to.deep.equal([
        { LogicalResourceId: 'First' },
        { LogicalResourceId: 'Second' },
      ]);
      expect(listStackResourcesStub).to.have.been.calledTwice;
      expect(listStackResourcesStub.firstCall.thisValue).to.equal(
        listStackResourcesStub.secondCall.thisValue
      );
      expect(getAwsSdkV3ConfigSpy).to.have.been.calledOnce;
      expect(listStackResourcesStub.firstCall.args[0]).to.be.instanceOf(ListStackResourcesCommand);
      expect(listStackResourcesStub.firstCall.args[0].input).to.deep.equal({
        StackName: awsProvider.naming.getStackName(),
      });
      expect(listStackResourcesStub.secondCall.args[0].input).to.deep.equal({
        StackName: awsProvider.naming.getStackName(),
        NextToken: 'next-page',
      });
    });

    it('preserves initial token and pre-seeded resources', async () => {
      const listStackResourcesStub = sinon.stub(CloudFormationClient.prototype, 'send').resolves({
        StackResourceSummaries: [{ LogicalResourceId: 'Second' }],
      });

      const resources = await awsProvider.getStackResources('next-page', [
        { LogicalResourceId: 'First' },
      ]);

      expect(resources).to.deep.equal([
        { LogicalResourceId: 'First' },
        { LogicalResourceId: 'Second' },
      ]);
      expect(listStackResourcesStub).to.have.been.calledOnce;
      expect(listStackResourcesStub.firstCall.args[0].input).to.deep.equal({
        StackName: awsProvider.naming.getStackName(),
        NextToken: 'next-page',
      });
    });

    it('uses an existing CloudFormation client promise when listing stack resources', async () => {
      const send = sinon.stub().resolves({
        StackResourceSummaries: [{ LogicalResourceId: 'ExistingClientResource' }],
      });
      const getAwsSdkV3ConfigStub = sinon
        .stub(awsProvider, 'getAwsSdkV3Config')
        .throws(new Error('Expected existing CloudFormation client to be reused'));
      awsProvider.cloudFormationClientPromise = Promise.resolve({ send });

      try {
        const resources = await awsProvider.getStackResources();

        expect(resources).to.deep.equal([{ LogicalResourceId: 'ExistingClientResource' }]);
        expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
        expect(send).to.have.been.calledOnce;
        expect(send.firstCall.args[0]).to.be.instanceOf(ListStackResourcesCommand);
        expect(send.firstCall.args[0].input).to.deep.equal({
          StackName: awsProvider.naming.getStackName(),
        });
      } finally {
        awsProvider.getAwsSdkV3Config.restore();
      }
    });

    it('treats missing StackResourceSummaries as an empty page', async () => {
      sinon.stub(CloudFormationClient.prototype, 'send').resolves({});

      const resources = await awsProvider.getStackResources();

      expect(resources).to.deep.equal([]);
    });
  });

  describe('#getAccountInfo()', () => {
    beforeEach(() => {
      ({ awsProvider } = createAwsProvider());
    });

    it('defines memoized provider methods as lazy non-enumerable descriptors', () => {
      const protoDescriptor = Object.getOwnPropertyDescriptor(
        AwsProvider.prototype,
        'getAccountInfo'
      );

      expect(protoDescriptor).to.include({ enumerable: false, configurable: true });
      expect(protoDescriptor.get).to.be.a('function');
      expect(Object.prototype.hasOwnProperty.call(awsProvider, 'getAccountInfo')).to.equal(false);

      const method = awsProvider.getAccountInfo;

      expect(awsProvider.getAccountInfo).to.equal(method);
      expect(Object.prototype.hasOwnProperty.call(awsProvider, 'getAccountInfo')).to.equal(true);

      const ownDescriptor = Object.getOwnPropertyDescriptor(awsProvider, 'getAccountInfo');

      expect(ownDescriptor).to.include({
        enumerable: false,
        configurable: true,
        writable: true,
      });
      expect(ownDescriptor.value).to.equal(method);
    });

    it('should return the AWS account id and partition', async () => {
      const accountId = '12345678';
      const partition = 'aws';

      const stsGetCallerIdentityStub = sinon.stub(STSClient.prototype, 'send').resolves({
        ResponseMetadata: { RequestId: '12345678-1234-1234-1234-123456789012' },
        UserId: 'ABCDEFGHIJKLMNOPQRSTU:VWXYZ',
        Account: accountId,
        Arn: 'arn:aws:sts::123456789012:assumed-role/ROLE-NAME/VWXYZ',
      });

      try {
        const result = await awsProvider.getAccountInfo();

        expect(stsGetCallerIdentityStub.calledOnce).to.equal(true);
        expect(stsGetCallerIdentityStub.firstCall.args[0]).to.be.instanceOf(
          GetCallerIdentityCommand
        );
        expect(stsGetCallerIdentityStub.firstCall.args[0].input).to.deep.equal({});
        expect(result.accountId).to.equal(accountId);
        expect(result.partition).to.equal(partition);
      } finally {
        STSClient.prototype.send.restore();
      }
    });

    it('memoizes successful promise results', async () => {
      const stsGetCallerIdentityStub = sinon.stub(STSClient.prototype, 'send').resolves({
        ResponseMetadata: { RequestId: '12345678-1234-1234-1234-123456789012' },
        UserId: 'ABCDEFGHIJKLMNOPQRSTU:VWXYZ',
        Account: '12345678',
        Arn: 'arn:aws:sts::123456789012:assumed-role/ROLE-NAME/VWXYZ',
      });

      try {
        const firstResult = await awsProvider.getAccountInfo();
        const secondResult = await awsProvider.getAccountInfo();

        expect(firstResult.accountId).to.equal('12345678');
        expect(secondResult).to.equal(firstResult);
        expect(stsGetCallerIdentityStub).to.have.been.calledOnce;
      } finally {
        STSClient.prototype.send.restore();
      }
    });
  });

  describe('#getAccountId()', () => {
    beforeEach(() => {
      ({ awsProvider } = createAwsProvider());
    });

    it('should return the AWS account id', async () => {
      const accountId = '12345678';

      const stsGetCallerIdentityStub = sinon.stub(STSClient.prototype, 'send').resolves({
        ResponseMetadata: { RequestId: '12345678-1234-1234-1234-123456789012' },
        UserId: 'ABCDEFGHIJKLMNOPQRSTU:VWXYZ',
        Account: accountId,
        Arn: 'arn:aws:sts::123456789012:assumed-role/ROLE-NAME/VWXYZ',
      });

      try {
        const result = await awsProvider.getAccountId();

        expect(stsGetCallerIdentityStub.calledOnce).to.equal(true);
        expect(result).to.equal(accountId);
      } finally {
        STSClient.prototype.send.restore();
      }
    });
  });

  describe('#isS3TransferAccelerationEnabled()', () => {
    it('should return false by default', () => {
      awsProvider.options['aws-s3-accelerate'] = undefined;
      return expect(awsProvider.isS3TransferAccelerationEnabled()).to.equal(false);
    });
    it('should return true when CLI option is provided', () => {
      awsProvider.options['aws-s3-accelerate'] = true;
      return expect(awsProvider.isS3TransferAccelerationEnabled()).to.equal(true);
    });
  });

  describe('#disableTransferAccelerationForCurrentDeploy()', () => {
    it('should remove the corresponding option for the current deploy', () => {
      awsProvider.options['aws-s3-accelerate'] = true;
      awsProvider.disableTransferAccelerationForCurrentDeploy();
      return expect(awsProvider.options['aws-s3-accelerate']).to.be.undefined;
    });
  });
});

describe('test/unit/lib/plugins/aws/provider.test.js', () => {
  describe('#getProviderName', () => {
    it('`AwsProvider.getProviderName()` should resolve provider name', () => {
      expect(AwsProvider.getProviderName()).to.equal('aws');
    });
  });

  describe('#getRegion()', () => {
    it('should default to "us-east-1"', async () => {
      const { serverless } = await runServerless({
        fixture: 'aws',
        command: 'print',
      });
      expect(serverless.getProvider('aws').getRegion()).to.equal('us-east-1');
    });

    it('should allow to override via `provider.region`', async () => {
      const { serverless } = await runServerless({
        fixture: 'aws',
        command: 'print',
        configExt: {
          provider: {
            region: 'eu-central-1',
          },
        },
      });
      expect(serverless.getProvider('aws').getRegion()).to.equal('eu-central-1');
    });

    it('should allow to override via CLI `--region` param', async () => {
      const { serverless } = await runServerless({
        fixture: 'aws',
        command: 'print',
        options: { region: 'us-west-1' },
        configExt: {
          provider: {
            region: 'eu-central-1',
          },
        },
      });
      expect(serverless.getProvider('aws').getRegion()).to.equal('us-west-1');
    });
  });

  describe('#getProfile()', () => {
    it('should allow to set via `provider.profile`', async () => {
      const { serverless } = await runServerless({
        fixture: 'aws',
        command: 'print',
        configExt: {
          provider: {
            profile: 'test-profile',
          },
        },
      });
      expect(serverless.getProvider('aws').getProfile()).to.equal('test-profile');
    });

    it('should allow to set via CLI `--profile` param', async () => {
      const { serverless } = await runServerless({
        fixture: 'aws',
        command: 'print',
        options: { profile: 'cli-override' },
        configExt: {
          provider: {
            profile: 'test-profile',
          },
        },
      });
      expect(serverless.getProvider('aws').getProfile()).to.equal('cli-override');
    });

    it('should allow to set via CLI `--aws-profile` param', async () => {
      // Test with `provider.profile` `--profile` and `--aws-pofile` CLI param set
      // Confirm that `--aws-profile` overrides
      const { serverless } = await runServerless({
        fixture: 'aws',
        command: 'print',
        options: {
          'profile': 'cli-override',
          'aws-profile': 'aws-override',
        },
        configExt: {
          provider: {
            profile: 'test-profile',
          },
        },
      });
      expect(serverless.getProvider('aws').getProfile()).to.equal('aws-override');
    });
  });

  describe('#getDeploymentPrefix()', () => {
    it('should put all artifacts in namespaced folder', async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        command: 'package',
      });
      const functions = Object.values(cfTemplate.Resources).filter(
        (r) => r.Type === 'AWS::Lambda::Function'
      );
      expect(functions.length).to.be.greaterThanOrEqual(1);
      for (const f of functions) {
        expect(f.Properties.Code.S3Key)
          .to.be.a('string')
          .and.satisfy((key) => key.startsWith('serverless/'));
      }
    });

    it('should support custom namespaced folder', async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          provider: {
            deploymentPrefix: 'test-prefix',
          },
        },
      });
      const functions = Object.values(cfTemplate.Resources).filter(
        (r) => r.Type === 'AWS::Lambda::Function'
      );
      expect(functions.length).to.be.greaterThanOrEqual(1);
      for (const f of functions) {
        expect(f.Properties.Code.S3Key)
          .to.be.a('string')
          .and.satisfy((key) => key.startsWith('test-prefix/'));
      }
    });
  });

  describe('#getAlbTargetGroupPrefix()', () => {
    it('should support `provider.alb.targetGroupPrefix`', async () => {
      const albId = '50dc6c495c0c9188';
      const validBaseEventConfig = {
        listenerArn: `arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/my-load-balancer/${albId}/f2f7dc8efc522ab2`,
        conditions: {
          path: '/',
        },
      };
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          provider: {
            alb: {
              targetGroupPrefix: 'a-prefix',
            },
          },
          functions: {
            fnTargetGroupName: {
              handler: 'index.handler',
              events: [
                {
                  alb: {
                    ...validBaseEventConfig,
                    priority: 1,
                  },
                },
              ],
            },
          },
        },
      });
      const targetGroups = Object.values(cfTemplate.Resources).filter(
        (r) => r.Type === 'AWS::ElasticLoadBalancingV2::TargetGroup'
      );
      expect(targetGroups.length).to.be.greaterThanOrEqual(1);
      for (const t of targetGroups) {
        expect(t.Properties.Name)
          .to.be.a('string')
          .and.satisfy((key) => key.startsWith('a-prefix'));
      }
    });
  });

  describe('#getStage()', () => {
    it('should default to "dev"', async () => {
      const { serverless } = await runServerless({
        fixture: 'aws',
        command: 'print',
      });
      expect(serverless.getProvider('aws').getStage()).to.equal('dev');
    });

    it('should allow to override via `provider.stage`', async () => {
      const { serverless } = await runServerless({
        fixture: 'aws',
        command: 'print',
        configExt: {
          provider: {
            stage: 'staging',
          },
        },
      });
      expect(serverless.getProvider('aws').getStage()).to.equal('staging');
    });

    it('should allow to override via CLI `--stage` param', async () => {
      const { serverless } = await runServerless({
        fixture: 'aws',
        command: 'print',
        options: { stage: 'production' },
        configExt: {
          provider: {
            stage: 'staging',
          },
        },
      });
      expect(serverless.getProvider('aws').getStage()).to.equal('production');
    });

    it('should reject invalid stage from provider options', () => {
      const provider = createProviderStub({ providerOptions: { stage: 'foo/bar' } });

      expect(() => provider.getStage())
        .to.throw(ServerlessError)
        .and.have.property('code', 'INVALID_STAGE');
    });

    it('should reject invalid stage from serverless config', () => {
      const provider = createProviderStub({
        config: { stage: 'feature.prod' },
        providerOptions: {},
      });

      expect(() => provider.getStage())
        .to.throw(ServerlessError)
        .and.have.property('code', 'INVALID_STAGE');
    });

    it('should reject invalid stage from service provider config', () => {
      const provider = createProviderStub({
        provider: { stage: 'my_stage' },
        providerOptions: {},
      });

      expect(() => provider.getStage())
        .to.throw(ServerlessError)
        .and.have.property('code', 'INVALID_STAGE');
    });

    it('should reject empty CLI stage instead of falling back to provider stage', () => {
      const provider = createProviderStub({
        provider: { stage: 'prod' },
        providerOptions: { stage: '' },
      });

      expect(() => provider.getStage())
        .to.throw(ServerlessError)
        .and.have.property('code', 'INVALID_STAGE');
    });
  });

  describe('when resolving images', () => {
    it('should fail if `functions[].image` references image with both buildOptions and uri', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              ecr: {
                images: {
                  invalidimage: {
                    buildOptions: ['--no-cache'],
                    uri: '000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38',
                  },
                },
              },
            },
            functions: {
              fnProviderInvalidImage: {
                image: 'invalidimage',
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'ECR_IMAGE_URI_AND_BUILDOPTIONS_DEFINED_ERROR'
      );
    });

    it('should fail if `functions[].image` references image with both path and uri', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              ecr: {
                images: {
                  invalidimage: {
                    path: './',
                    uri: '000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38',
                  },
                },
              },
            },
            functions: {
              fnProviderInvalidImage: {
                image: 'invalidimage',
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'ECR_IMAGE_BOTH_URI_AND_PATH_DEFINED_ERROR'
      );
    });

    it('should fail if `functions[].image` references image with both buildArgs and uri', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              ecr: {
                images: {
                  invalidimage: {
                    buildArgs: {
                      TESTKEY: 'TESTVAL',
                    },
                    uri: '000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38',
                  },
                },
              },
            },
            functions: {
              fnProviderInvalidImage: {
                image: 'invalidimage',
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'ECR_IMAGE_BOTH_URI_AND_BUILDARGS_DEFINED_ERROR'
      );
    });

    it('should fail if `functions[].image` references image with both cacheFrom and uri', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              ecr: {
                images: {
                  invalidimage: {
                    cacheFrom: ['my-image:latest'],
                    uri: '000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38',
                  },
                },
              },
            },
            functions: {
              fnProviderInvalidImage: {
                image: 'invalidimage',
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'ECR_IMAGE_BOTH_URI_AND_CACHEFROM_DEFINED_ERROR'
      );
    });

    it('should fail if `functions[].image` references image with both platform and uri', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              ecr: {
                images: {
                  invalidimage: {
                    platform: 'TESTVAL',
                    uri: '000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38',
                  },
                },
              },
            },
            functions: {
              fnProviderInvalidImage: {
                image: 'invalidimage',
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'ECR_IMAGE_BOTH_URI_AND_PLATFORM_DEFINED_ERROR'
      );
    });

    it('should fail if `functions[].image` references image without path and uri', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              ecr: {
                images: {
                  invalidimage: {},
                },
              },
            },
            functions: {
              fnProviderInvalidImage: {
                image: 'invalidimage',
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'ECR_IMAGE_NEITHER_URI_NOR_PATH_DEFINED_ERROR'
      );
    });

    it('should fail if `functions[].image` references image from `provider.ecr.images` that has invalid path', async () => {
      await expect(
        runServerless({
          fixture: 'ecr',
          command: 'package',
          shouldStubSpawn: true,
          configExt: {
            provider: {
              ecr: {
                images: {
                  baseimage: {
                    path: './invalid',
                  },
                },
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property('code', 'DOCKERFILE_NOT_AVAILABLE_ERROR');
    });

    it('should fail if `functions[].image` references image not defined in `provider.ecr.images`', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            functions: {
              fnInvalid: {
                image: 'undefinedimage',
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'REFERENCED_FUNCTION_IMAGE_NOT_DEFINED_IN_PROVIDER'
      );
    });

    it('should fail if both uri and name is provided for an image', async () => {
      await expect(
        runServerless({
          fixture: 'ecr',
          command: 'package',
          shouldStubSpawn: true,
          configExt: {
            functions: {
              foo: {
                image: {
                  name: 'baseimage',
                  uri: '000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38',
                },
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'FUNCTION_IMAGE_BOTH_URI_AND_NAME_DEFINED_ERROR'
      );
    });

    it('should fail if neither uri nor name is provided for an image', async () => {
      await expect(
        runServerless({
          fixture: 'ecr',
          command: 'package',
          shouldStubSpawn: true,
          configExt: {
            functions: {
              foo: {
                image: {},
              },
            },
          },
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'FUNCTION_IMAGE_NEITHER_URI_NOR_NAME_DEFINED_ERROR'
      );
    });

    const findVersionCfConfig = (cfResources, fnLogicalId) =>
      Object.values(cfResources).find(
        (resource) =>
          resource.Type === 'AWS::Lambda::Version' &&
          resource.Properties.FunctionName.Ref === fnLogicalId
      ).Properties;

    describe('with `functions[].image` referencing existing images', () => {
      let cfResources;
      let naming;
      let serviceConfig;
      const imageSha = '6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38';
      const imageWithSha = `000000000000.dkr.ecr.us-east-1.amazonaws.com/test-lambda-docker@sha256:${imageSha}`;
      const imageDigestFromECR =
        'sha256:2e6b10a4b1ca0f6d3563a8a1f034dde7c4d7c93b50aa91f24311765d0822186b';
      const describeImagesStub = sinon
        .stub()
        .resolves({ imageDetails: [{ imageDigest: imageDigestFromECR }] });
      const awsSdkV3StubMap = {
        ECR: {
          describeImages: describeImagesStub,
        },
      };

      before(async () => {
        const { awsNaming, cfTemplate, fixtureData } = await runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              ecr: {
                images: {
                  imagewithexplicituri: {
                    uri: imageWithSha,
                  },
                  imagewithimplicituri: imageWithSha,
                },
              },
            },
            functions: {
              fnImage: {
                image: imageWithSha,
              },
              fnImageWithTag: {
                image: '000000000000.dkr.ecr.us-east-1.amazonaws.com/test-lambda-docker:stable',
              },
              fnImageWithTagAndRepoWithSlashes: {
                image:
                  '000000000000.dkr.ecr.us-east-1.amazonaws.com/test-lambda/repo-docker:stable',
              },
              fnImageWithExplicitUri: {
                image: {
                  uri: imageWithSha,
                },
              },
              fnProviderImageWithExplicitUri: {
                image: 'imagewithexplicituri',
              },
              fnProviderImageWithImplicitUri: {
                image: 'imagewithimplicituri',
              },
            },
          },
          awsSdkV3StubMap,
        });
        cfResources = cfTemplate.Resources;
        naming = awsNaming;
        serviceConfig = fixtureData.serviceConfig;
      });

      it('should support `functions[].image` with implicit uri with sha', () => {
        const functionServiceConfig = serviceConfig.functions.fnImage;
        const functionCfLogicalId = naming.getLambdaLogicalId('fnImage');
        const functionCfConfig = cfResources[functionCfLogicalId].Properties;

        expect(functionCfConfig.Code).to.deep.equal({ ImageUri: functionServiceConfig.image });
        expect(functionCfConfig).to.not.have.property('Handler');
        expect(functionCfConfig).to.not.have.property('Runtime');

        const imageDigest = functionServiceConfig.image.slice(
          functionServiceConfig.image.lastIndexOf('@') + 1
        );
        expect(imageDigest).to.match(/^sha256:[a-f0-9]{64}$/);
        const imageDigestSha = imageDigest.slice('sha256:'.length);
        const versionCfConfig = findVersionCfConfig(cfResources, functionCfLogicalId);
        expect(versionCfConfig.CodeSha256).to.equal(imageDigestSha);
      });

      it('should support `functions[].image` with explicit uri with sha', () => {
        const functionServiceConfig = serviceConfig.functions.fnImageWithExplicitUri;
        const functionCfLogicalId = naming.getLambdaLogicalId('fnImageWithExplicitUri');
        const functionCfConfig = cfResources[functionCfLogicalId].Properties;

        expect(functionCfConfig.Code).to.deep.equal({ ImageUri: functionServiceConfig.image.uri });
        expect(functionCfConfig).to.not.have.property('Handler');
        expect(functionCfConfig).to.not.have.property('Runtime');

        const imageDigest = functionServiceConfig.image.uri.slice(
          functionServiceConfig.image.uri.lastIndexOf('@') + 1
        );
        expect(imageDigest).to.match(/^sha256:[a-f0-9]{64}$/);
        const imageDigestSha = imageDigest.slice('sha256:'.length);
        const versionCfConfig = findVersionCfConfig(cfResources, functionCfLogicalId);
        expect(versionCfConfig.CodeSha256).to.equal(imageDigestSha);
      });

      it('should support `functions[].image` with tag', () => {
        const functionServiceConfig = serviceConfig.functions.fnImageWithTag;
        const functionCfLogicalId = naming.getLambdaLogicalId('fnImageWithTag');
        const functionCfConfig = cfResources[functionCfLogicalId].Properties;

        expect(functionCfConfig.Code).to.deep.equal({
          ImageUri: `${functionServiceConfig.image.split(':')[0]}@${imageDigestFromECR}`,
        });
        expect(functionCfConfig).to.not.have.property('Handler');
        expect(functionCfConfig).to.not.have.property('Runtime');

        const versionCfConfig = findVersionCfConfig(cfResources, functionCfLogicalId);
        expect(versionCfConfig.CodeSha256).to.equal(imageDigestFromECR.slice('sha256:'.length));
        expect(describeImagesStub).to.be.calledWith({
          imageIds: [{ imageTag: 'stable' }],
          registryId: '000000000000',
          repositoryName: 'test-lambda-docker',
        });
      });

      it('should support `functions[].image` with tag and repository name with slash', () => {
        const functionServiceConfig = serviceConfig.functions.fnImageWithTagAndRepoWithSlashes;
        const functionCfLogicalId = naming.getLambdaLogicalId('fnImageWithTagAndRepoWithSlashes');
        const functionCfConfig = cfResources[functionCfLogicalId].Properties;

        expect(functionCfConfig.Code).to.deep.equal({
          ImageUri: `${functionServiceConfig.image.split(':')[0]}@${imageDigestFromECR}`,
        });
        expect(functionCfConfig).to.not.have.property('Handler');
        expect(functionCfConfig).to.not.have.property('Runtime');

        const versionCfConfig = findVersionCfConfig(cfResources, functionCfLogicalId);
        expect(versionCfConfig.CodeSha256).to.equal(imageDigestFromECR.slice('sha256:'.length));
        expect(describeImagesStub).to.be.calledWith({
          imageIds: [{ imageTag: 'stable' }],
          registryId: '000000000000',
          repositoryName: 'test-lambda/repo-docker',
        });
      });

      it('should support `functions[].image` that references provider.ecr.images defined with explicit uri', () => {
        const functionCfLogicalId = naming.getLambdaLogicalId('fnProviderImageWithExplicitUri');
        const functionCfConfig = cfResources[functionCfLogicalId].Properties;

        expect(functionCfConfig.Code).to.deep.equal({
          ImageUri: imageWithSha,
        });
        expect(functionCfConfig).to.not.have.property('Handler');
        expect(functionCfConfig).to.not.have.property('Runtime');

        const versionCfConfig = findVersionCfConfig(cfResources, functionCfLogicalId);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
      });

      it('should support `functions[].image` that references provider.ecr.images defined with implicit uri', () => {
        const functionCfLogicalId = naming.getLambdaLogicalId('fnProviderImageWithImplicitUri');
        const functionCfConfig = cfResources[functionCfLogicalId].Properties;

        expect(functionCfConfig.Code).to.deep.equal({
          ImageUri: imageWithSha,
        });
        expect(functionCfConfig).to.not.have.property('Handler');
        expect(functionCfConfig).to.not.have.property('Runtime');

        const versionCfConfig = findVersionCfConfig(cfResources, functionCfLogicalId);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
      });

      it('should fail when `functions[].image` when image uri region does not match the provider region', async () => {
        const imageRegion = 'sa-east-1';
        const imageWithoutSha = `000000000000.dkr.ecr.${imageRegion}.amazonaws.com/test-lambda-docker`;
        await expect(
          runServerless({
            fixture: 'function',
            command: 'package',
            configExt: {
              provider: {
                region: 'us-east-1',
              },
              functions: {
                fnImageWithExplicitUriInvalidRegion: {
                  image: imageWithoutSha,
                },
              },
            },
          })
        ).to.be.eventually.rejected.and.have.property('code', 'LAMBDA_ECR_REGION_MISMATCH_ERROR');
      });

      it('should surface native SDK v3 image lookup errors', async () => {
        const imageNotFoundError = Object.assign(new Error('Image not found'), {
          name: 'ImageNotFoundException',
        });

        try {
          await runServerless({
            fixture: 'function',
            command: 'package',
            configExt: {
              functions: {
                fnImageWithTag: {
                  image: '000000000000.dkr.ecr.us-east-1.amazonaws.com/test-lambda-docker:stable',
                },
              },
            },
            awsSdkV3StubMap: {
              ECR: {
                describeImages: () => {
                  throw imageNotFoundError;
                },
              },
            },
          });
        } catch (error) {
          expect(error).to.equal(imageNotFoundError);
          return;
        }

        throw new Error('Expected package to reject');
      });

      it('limits concurrent ECR image tag lookups to 6', async () => {
        const pendingResolvers = [];
        let activeRequests = 0;
        let observedMaxActiveRequests = 0;
        const imageLookupStub = sinon.stub().callsFake(async () => {
          activeRequests += 1;
          observedMaxActiveRequests = Math.max(observedMaxActiveRequests, activeRequests);
          expect(activeRequests).to.be.at.most(6);
          await new Promise((resolve) => pendingResolvers.push(resolve));
          activeRequests -= 1;
          return { imageDetails: [{ imageDigest: imageDigestFromECR }] };
        });
        const functions = Object.fromEntries(
          Array.from({ length: 10 }, (ignored, index) => [
            `fnImageWithTag${index}`,
            {
              image: `000000000000.dkr.ecr.us-east-1.amazonaws.com/test-lambda-docker:tag${index}`,
            },
          ])
        );

        const promise = runServerless({
          fixture: 'function',
          command: 'package',
          configExt: { functions },
          awsSdkV3StubMap: {
            ECR: {
              describeImages: imageLookupStub,
            },
          },
        });

        let isSettled = false;
        let result;
        let thrownError;
        promise
          .then(
            (value) => {
              result = value;
            },
            (error) => {
              thrownError = error;
            }
          )
          .finally(() => {
            isSettled = true;
          })
          .catch(() => {});
        for (let index = 0; index < 100 && pendingResolvers.length < 6 && !isSettled; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        expect(observedMaxActiveRequests).to.equal(6);
        while (!isSettled) {
          for (const resolve of pendingResolvers.splice(0)) resolve();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (thrownError) throw thrownError;
        const { awsSdkV3Stub, serverless } = result;
        const expectedCredentials = serverless.getProvider('aws').getAwsSdkV3CredentialsProvider();
        const imageLookupSends = awsSdkV3Stub.sends.filter(
          ({ service, method }) => service === 'ECR' && method === 'describeImages'
        );

        expect(observedMaxActiveRequests).to.equal(6);
        expect(imageLookupSends).to.have.length(10);
        expect(new Set(imageLookupSends.map(({ client }) => client)).size).to.equal(1);
        expect(imageLookupSends.map(({ input }) => input.imageIds[0].imageTag)).to.have.members(
          Array.from({ length: 10 }, (ignored, index) => `tag${index}`)
        );
        expect(
          imageLookupSends.every(
            ({ clientConfig }) => clientConfig.credentials === expectedCredentials
          )
        ).to.equal(true);
      });
    });

    describe('with `functions[].image` referencing images that require building', () => {
      const imageSha = '6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38';
      const repositoryUri = '999999999999.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker';
      const authorizationToken = 'YXdzOmRvY2tlcmF1dGh0b2tlbg==';
      const proxyEndpoint = `https://${repositoryUri}`;
      const describeRepositoriesStub = sinon.stub();
      const createRepositoryStub = sinon.stub();
      const createRepositoryStubScanOnPush = sinon.stub();
      const putLifecyclePolicyStub = sinon.stub();
      const baseAwsSdkV3StubMap = {
        STS: {
          getCallerIdentity: {
            ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
            UserId: 'XXXXXXXXXXXXXXXXXXXXX',
            Account: '999999999999',
            Arn: 'arn:aws:iam::999999999999:user/test',
          },
        },
        ECR: {
          describeRepositories: {
            repositories: [{ repositoryUri }],
          },
          getAuthorizationToken: {
            authorizationData: [
              {
                proxyEndpoint,
                authorizationToken,
              },
            ],
          },
        },
      };
      const spawnExtStub = sinon.stub().returns({
        stdBuffer: `digest: sha256:${imageSha} size: 1787`,
      });
      const modulesCacheStub = {
        [spawnModulePath]: spawnExtStub,
      };
      const getEcrSend = (awsSdkV3Stub, method) =>
        awsSdkV3Stub.sends.find((send) => send.service === 'ECR' && send.method === method);
      const expectEcrSendInput = (awsSdkV3Stub, method, input) => {
        const send = getEcrSend(awsSdkV3Stub, method);

        expect(send).to.exist;
        expect(send.input).to.deep.equal(input);
        return send;
      };

      beforeEach(() => {
        describeRepositoriesStub.reset();
        createRepositoryStub.reset();
        createRepositoryStubScanOnPush.reset();
        putLifecyclePolicyStub.reset();
        spawnExtStub.resetHistory();
      });

      it('should work correctly when repository exists beforehand', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.resolves({
              repositories: [{ repositoryUri }],
            }),
            createRepository: createRepositoryStub,
          },
        };
        const {
          awsNaming,
          awsSdkV3Stub,
          cfTemplate,
          serverless,
          fixtureData: { servicePath: serviceDir },
        } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = findVersionCfConfig(cfTemplate.Resources, functionCfLogicalId);

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(describeRepositoriesStub.firstCall.args[0]).to.deep.equal({
          repositoryNames: [awsNaming.getEcrRepositoryName()],
          registryId: '999999999999',
        });
        expect(createRepositoryStub.notCalled).to.be.true;
        expect(
          awsSdkV3Stub.clients
            .filter(({ service }) => service === 'ECR')
            .every(
              ({ config }) =>
                config.credentials ===
                serverless.getProvider('aws').getAwsSdkV3CredentialsProvider()
            )
        ).to.equal(true);
        expect(spawnExtStub).to.be.calledWith('docker', ['--version']);
        expect(
          spawnExtStub.getCalls().some((call) => (call.args[1] || [])[0] === 'login')
        ).to.equal(false);
        expect(spawnExtStub).to.be.calledWith('docker', [
          'build',
          '-t',
          `${awsNaming.getEcrRepositoryName()}:baseimage`,
          '-f',
          path.join(serviceDir, 'Dockerfile'),
          './',
        ]);
        expect(spawnExtStub).to.be.calledWith('docker', [
          'tag',
          `${awsNaming.getEcrRepositoryName()}:baseimage`,
          `${repositoryUri}:baseimage`,
        ]);
        expect(spawnExtStub).to.be.calledWith('docker', ['push', `${repositoryUri}:baseimage`]);
      });

      it('should work correctly when repository does not exist beforehand and scanOnPush is set', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.throws({
              providerError: { code: 'RepositoryNotFoundException' },
            }),
            createRepository: createRepositoryStubScanOnPush.resolves({
              repository: { repositoryUri },
            }),
          },
        };

        const { awsNaming, awsSdkV3Stub, cfTemplate, serverless } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
          configExt: {
            provider: {
              ecr: {
                scanOnPush: true,
                images: {
                  baseimage: {
                    path: './',
                    file: 'Dockerfile.dev',
                  },
                },
              },
            },
          },
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = findVersionCfConfig(cfTemplate.Resources, functionCfLogicalId);

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(createRepositoryStubScanOnPush).to.be.calledOnce;
        const createRepositorySend = expectEcrSendInput(awsSdkV3Stub, 'createRepository', {
          repositoryName: awsNaming.getEcrRepositoryName(),
          imageScanningConfiguration: { scanOnPush: true },
        });
        expect(createRepositorySend.clientConfig.credentials).to.equal(
          serverless.getProvider('aws').getAwsSdkV3CredentialsProvider()
        );
      });

      it('should work correctly when repository does not exist beforehand', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.throws({
              providerError: { code: 'RepositoryNotFoundException' },
            }),
            createRepository: createRepositoryStub.resolves({ repository: { repositoryUri } }),
          },
        };

        const { awsNaming, awsSdkV3Stub, cfTemplate, serverless } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = findVersionCfConfig(cfTemplate.Resources, functionCfLogicalId);

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(createRepositoryStub).to.be.calledOnce;
        const createRepositorySend = expectEcrSendInput(awsSdkV3Stub, 'createRepository', {
          repositoryName: awsNaming.getEcrRepositoryName(),
          imageScanningConfiguration: { scanOnPush: false },
        });
        expect(createRepositorySend.clientConfig.credentials).to.equal(
          serverless.getProvider('aws').getAwsSdkV3CredentialsProvider()
        );
        expect(putLifecyclePolicyStub).to.not.have.been.called;
      });

      it('should create repository for native SDK v3 repository not found errors', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.throws(
              Object.assign(new Error('Repository not found'), {
                name: 'RepositoryNotFoundException',
              })
            ),
            createRepository: createRepositoryStub.resolves({ repository: { repositoryUri } }),
          },
        };

        const { awsNaming, awsSdkV3Stub, cfTemplate, serverless } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = findVersionCfConfig(cfTemplate.Resources, functionCfLogicalId);

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(createRepositoryStub).to.be.calledOnce;
        const createRepositorySend = expectEcrSendInput(awsSdkV3Stub, 'createRepository', {
          repositoryName: awsNaming.getEcrRepositoryName(),
          imageScanningConfiguration: { scanOnPush: false },
        });
        expect(createRepositorySend.clientConfig.credentials).to.equal(
          serverless.getProvider('aws').getAwsSdkV3CredentialsProvider()
        );
      });

      it('should set ECR lifecycle policy correctly', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.throws({
              providerError: { code: 'RepositoryNotFoundException' },
            }),
            createRepository: createRepositoryStub.resolves({ repository: { repositoryUri } }),
            putLifecyclePolicy: putLifecyclePolicyStub.resolves(),
          },
        };

        const { awsNaming, awsSdkV3Stub, serverless } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
          configExt: {
            provider: {
              ecr: {
                maxImageCount: 10,
              },
            },
          },
        });

        const expectedLifecyclePolicy = {
          rules: [
            {
              rulePriority: 1,
              action: { type: 'expire' },
              selection: {
                tagStatus: 'any',
                countType: 'imageCountMoreThan',
                countNumber: 10,
              },
            },
          ],
        };

        expect(JSON.parse(putLifecyclePolicyStub.args[0][0].lifecyclePolicyText)).to.deep.equal(
          expectedLifecyclePolicy
        );
        const putLifecyclePolicySend = expectEcrSendInput(awsSdkV3Stub, 'putLifecyclePolicy', {
          repositoryName: awsNaming.getEcrRepositoryName(),
          lifecyclePolicyText: JSON.stringify(expectedLifecyclePolicy),
        });
        expect(putLifecyclePolicySend.clientConfig.credentials).to.equal(
          serverless.getProvider('aws').getAwsSdkV3CredentialsProvider()
        );
      });

      it('should login and retry when docker push fails with no basic auth credentials error', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.resolves({
              repositories: [{ repositoryUri }],
            }),
            createRepository: createRepositoryStub,
          },
        };
        const innerSpawnExtStub = sinon
          .stub()
          .returns({
            stdBuffer: `digest: sha256:${imageSha} size: 1787`,
          })
          .onCall(3)
          .throws({ stdBuffer: 'no basic auth credentials' });
        const {
          awsNaming,
          awsSdkV3Stub,
          cfTemplate,
          serverless,
          fixtureData: { servicePath: serviceDir },
        } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub: {
            ...modulesCacheStub,
            [spawnModulePath]: innerSpawnExtStub,
          },
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = findVersionCfConfig(cfTemplate.Resources, functionCfLogicalId);

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(createRepositoryStub.notCalled).to.be.true;
        expect(innerSpawnExtStub).to.be.calledWith('docker', ['--version']);
        expect(innerSpawnExtStub).to.be.calledWith('docker', [
          'build',
          '-t',
          `${awsNaming.getEcrRepositoryName()}:baseimage`,
          '-f',
          path.join(serviceDir, 'Dockerfile'),
          './',
        ]);
        expect(innerSpawnExtStub).to.be.calledWith('docker', [
          'tag',
          `${awsNaming.getEcrRepositoryName()}:baseimage`,
          `${repositoryUri}:baseimage`,
        ]);
        expect(innerSpawnExtStub).to.be.calledWith('docker', [
          'push',
          `${repositoryUri}:baseimage`,
        ]);
        expect(innerSpawnExtStub).to.be.calledWith(
          'docker',
          ['login', '--username', 'AWS', '--password-stdin', proxyEndpoint],
          { input: 'dockerauthtoken' }
        );
        const getAuthorizationTokenSend = expectEcrSendInput(
          awsSdkV3Stub,
          'getAuthorizationToken',
          { registryIds: ['999999999999'] }
        );
        expect(getAuthorizationTokenSend.clientConfig.credentials).to.equal(
          serverless.getProvider('aws').getAwsSdkV3CredentialsProvider()
        );
      });

      it('should login and retry when docker push fails with token has expired error', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.resolves({
              repositories: [{ repositoryUri }],
            }),
            createRepository: createRepositoryStub,
          },
        };
        const innerSpawnExtStub = sinon
          .stub()
          .returns({
            stdBuffer: `digest: sha256:${imageSha} size: 1787`,
          })
          .onCall(3)
          .throws({ stdBuffer: 'authorization token has expired' });
        const { awsSdkV3Stub, serverless } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub: {
            ...modulesCacheStub,
            [spawnModulePath]: innerSpawnExtStub,
          },
        });

        expect(innerSpawnExtStub).to.be.calledWith('docker', [
          'push',
          `${repositoryUri}:baseimage`,
        ]);
        expect(innerSpawnExtStub).to.be.calledWith(
          'docker',
          ['login', '--username', 'AWS', '--password-stdin', proxyEndpoint],
          { input: 'dockerauthtoken' }
        );
        const getAuthorizationTokenSend = expectEcrSendInput(
          awsSdkV3Stub,
          'getAuthorizationToken',
          { registryIds: ['999999999999'] }
        );
        expect(getAuthorizationTokenSend.clientConfig.credentials).to.equal(
          serverless.getProvider('aws').getAwsSdkV3CredentialsProvider()
        );
      });

      it('should work correctly when image is defined with implicit path in provider', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.resolves({
              repositories: [{ repositoryUri }],
            }),
            createRepository: createRepositoryStub,
          },
        };
        const { awsNaming, cfTemplate } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
          configExt: {
            provider: {
              ecr: {
                images: {
                  baseimage: './',
                },
              },
            },
          },
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = Object.values(cfTemplate.Resources).find(
          (resource) =>
            resource.Type === 'AWS::Lambda::Version' &&
            resource.Properties.FunctionName.Ref === functionCfLogicalId
        ).Properties;

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(createRepositoryStub.notCalled).to.be.true;
      });

      it('should work correctly when image is defined with `file` set', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.resolves({
              repositories: [{ repositoryUri }],
            }),
            createRepository: createRepositoryStub,
          },
        };
        const {
          awsNaming,
          cfTemplate,
          fixtureData: { servicePath: serviceDir },
        } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
          configExt: {
            provider: {
              ecr: {
                images: {
                  baseimage: {
                    path: './',
                    file: 'Dockerfile.dev',
                  },
                },
              },
            },
          },
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = Object.values(cfTemplate.Resources).find(
          (resource) =>
            resource.Type === 'AWS::Lambda::Version' &&
            resource.Properties.FunctionName.Ref === functionCfLogicalId
        ).Properties;

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(createRepositoryStub.notCalled).to.be.true;
        expect(spawnExtStub).to.be.calledWith('docker', [
          'build',
          '-t',
          `${awsNaming.getEcrRepositoryName()}:baseimage`,
          '-f',
          path.join(serviceDir, 'Dockerfile.dev'),
          './',
        ]);
      });

      it('should work correctly when image is defined with `cacheFrom` set', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.resolves({
              repositories: [{ repositoryUri }],
            }),
            createRepository: createRepositoryStub,
          },
        };
        const {
          awsNaming,
          cfTemplate,
          fixtureData: { servicePath: serviceDir },
        } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
          configExt: {
            provider: {
              ecr: {
                images: {
                  baseimage: {
                    path: './',
                    file: 'Dockerfile.dev',
                    cacheFrom: ['my-image:latest'],
                  },
                },
              },
            },
          },
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = Object.values(cfTemplate.Resources).find(
          (resource) =>
            resource.Type === 'AWS::Lambda::Version' &&
            resource.Properties.FunctionName.Ref === functionCfLogicalId
        ).Properties;

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(createRepositoryStub.notCalled).to.be.true;
        expect(spawnExtStub).to.be.calledWith('docker', [
          'build',
          '-t',
          `${awsNaming.getEcrRepositoryName()}:baseimage`,
          '-f',
          path.join(serviceDir, 'Dockerfile.dev'),
          '--cache-from',
          'my-image:latest',
          './',
        ]);
      });

      it('should work correctly when image is defined with `buildOptions` set', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.resolves({
              repositories: [{ repositoryUri }],
            }),
            createRepository: createRepositoryStub,
          },
        };
        const {
          awsNaming,
          cfTemplate,
          fixtureData: { servicePath: serviceDir },
        } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
          configExt: {
            provider: {
              ecr: {
                images: {
                  baseimage: {
                    path: './',
                    file: 'Dockerfile.dev',
                    buildOptions: ['--ssh', 'default=/path/to/file'],
                  },
                },
              },
            },
          },
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = Object.values(cfTemplate.Resources).find(
          (resource) =>
            resource.Type === 'AWS::Lambda::Version' &&
            resource.Properties.FunctionName.Ref === functionCfLogicalId
        ).Properties;

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(createRepositoryStub.notCalled).to.be.true;
        expect(spawnExtStub).to.be.calledWith('docker', [
          'build',
          '-t',
          `${awsNaming.getEcrRepositoryName()}:baseimage`,
          '-f',
          path.join(serviceDir, 'Dockerfile.dev'),
          '--ssh',
          'default=/path/to/file',
          './',
        ]);
      });

      it('should work correctly when image is defined with `buildArgs` set', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.resolves({
              repositories: [{ repositoryUri }],
            }),
            createRepository: createRepositoryStub,
          },
        };
        const {
          awsNaming,
          cfTemplate,
          fixtureData: { servicePath: serviceDir },
        } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
          configExt: {
            provider: {
              ecr: {
                images: {
                  baseimage: {
                    path: './',
                    file: 'Dockerfile.dev',
                    buildArgs: {
                      TESTKEY: 'TESTVAL',
                    },
                  },
                },
              },
            },
          },
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = Object.values(cfTemplate.Resources).find(
          (resource) =>
            resource.Type === 'AWS::Lambda::Version' &&
            resource.Properties.FunctionName.Ref === functionCfLogicalId
        ).Properties;

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(createRepositoryStub.notCalled).to.be.true;
        expect(spawnExtStub).to.be.calledWith('docker', [
          'build',
          '-t',
          `${awsNaming.getEcrRepositoryName()}:baseimage`,
          '-f',
          path.join(serviceDir, 'Dockerfile.dev'),
          '--build-arg',
          'TESTKEY=TESTVAL',
          './',
        ]);
      });

      it('should work correctly when image is defined with `platform` set', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.resolves({
              repositories: [{ repositoryUri }],
            }),
            createRepository: createRepositoryStub,
          },
        };
        const {
          awsNaming,
          cfTemplate,
          fixtureData: { servicePath: serviceDir },
        } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
          configExt: {
            provider: {
              ecr: {
                images: {
                  baseimage: {
                    path: './',
                    file: 'Dockerfile.dev',
                    platform: 'TESTVAL',
                  },
                },
              },
            },
          },
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = Object.values(cfTemplate.Resources).find(
          (resource) =>
            resource.Type === 'AWS::Lambda::Version' &&
            resource.Properties.FunctionName.Ref === functionCfLogicalId
        ).Properties;

        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
        expect(describeRepositoriesStub).to.be.calledOnce;
        expect(createRepositoryStub.notCalled).to.be.true;
        expect(spawnExtStub).to.be.calledWith('docker', [
          'build',
          '-t',
          `${awsNaming.getEcrRepositoryName()}:baseimage`,
          '-f',
          path.join(serviceDir, 'Dockerfile.dev'),
          './',
          '--platform=TESTVAL',
        ]);
      });

      it('should work correctly when `functions[].image` is defined with explicit name', async () => {
        const awsSdkV3StubMap = {
          ...baseAwsSdkV3StubMap,
          ECR: {
            ...baseAwsSdkV3StubMap.ECR,
            describeRepositories: describeRepositoriesStub.resolves({
              repositories: [{ repositoryUri }],
            }),
            createRepository: createRepositoryStub,
          },
        };
        const { awsNaming, cfTemplate } = await runServerless({
          fixture: 'ecr',
          command: 'package',
          awsSdkV3StubMap,
          modulesCacheStub,
          configExt: {
            provider: {
              ecr: {
                images: {
                  baseimage: './',
                },
              },
            },
            functions: {
              foo: {
                image: {
                  name: 'baseimage',
                },
              },
            },
          },
        });

        const functionCfLogicalId = awsNaming.getLambdaLogicalId('foo');
        const functionCfConfig = cfTemplate.Resources[functionCfLogicalId].Properties;
        const versionCfConfig = findVersionCfConfig(cfTemplate.Resources, functionCfLogicalId);
        expect(functionCfConfig.Code.ImageUri).to.deep.equal(`${repositoryUri}@sha256:${imageSha}`);
        expect(versionCfConfig.CodeSha256).to.equal(imageSha);
      });

      it('should fail when docker command is not available', async () => {
        await expect(
          runServerless({
            fixture: 'ecr',
            command: 'package',
            awsSdkV3StubMap: baseAwsSdkV3StubMap,
            modulesCacheStub: {
              [spawnModulePath]: sinon.stub().throws(),
            },
          })
        ).to.be.eventually.rejected.and.have.property('code', 'DOCKER_COMMAND_NOT_AVAILABLE');
      });

      it('should fail when docker build fails', async () => {
        await expect(
          runServerless({
            fixture: 'ecr',
            command: 'package',
            awsSdkV3StubMap: baseAwsSdkV3StubMap,
            modulesCacheStub: {
              ...modulesCacheStub,
              [spawnModulePath]: sinon.stub().returns({}).onSecondCall().throws(),
            },
          })
        ).to.be.eventually.rejected.and.have.property('code', 'DOCKER_BUILD_ERROR');
      });

      it('should fail when docker tag fails', async () => {
        await expect(
          runServerless({
            fixture: 'ecr',
            command: 'package',
            awsSdkV3StubMap: baseAwsSdkV3StubMap,
            modulesCacheStub: {
              ...modulesCacheStub,
              [spawnModulePath]: sinon.stub().returns({}).onCall(2).throws(),
            },
          })
        ).to.be.eventually.rejected.and.have.property('code', 'DOCKER_TAG_ERROR');
      });

      it('should fail when docker push fails', async () => {
        await expect(
          runServerless({
            fixture: 'ecr',
            command: 'package',
            awsSdkV3StubMap: baseAwsSdkV3StubMap,
            modulesCacheStub: {
              ...modulesCacheStub,
              [spawnModulePath]: sinon.stub().returns({}).onCall(3).throws(),
            },
          })
        ).to.be.eventually.rejected.and.have.property('code', 'DOCKER_PUSH_ERROR');
      });

      it('should fail when docker login fails without exposing the token', async () => {
        const error = await expect(
          runServerless({
            fixture: 'ecr',
            command: 'package',
            awsSdkV3StubMap: baseAwsSdkV3StubMap,
            modulesCacheStub: {
              ...modulesCacheStub,
              [spawnModulePath]: sinon
                .stub()
                .returns({})
                .onCall(3)
                .throws({ stdBuffer: 'no basic auth credentials' })
                .onCall(4)
                .throws(),
            },
          })
        ).to.be.eventually.rejected;
        expect(error.code).to.equal('DOCKER_LOGIN_ERROR');
        expect(error.message).to.include('--password-stdin');
        expect(error.message).to.not.include('dockerauthtoken');
      });

      it('should fail without invoking docker login when ECR authorization token is malformed', async () => {
        const innerSpawnExtStub = sinon
          .stub()
          .returns({})
          .onCall(3)
          .throws({ stdBuffer: 'no basic auth credentials' });
        const error = await expect(
          runServerless({
            fixture: 'ecr',
            command: 'package',
            awsSdkV3StubMap: {
              ...baseAwsSdkV3StubMap,
              ECR: {
                ...baseAwsSdkV3StubMap.ECR,
                getAuthorizationToken: {
                  authorizationData: [
                    {
                      proxyEndpoint,
                      authorizationToken: Buffer.from('malformedtoken').toString('base64'),
                    },
                  ],
                },
              },
            },
            modulesCacheStub: {
              ...modulesCacheStub,
              [spawnModulePath]: innerSpawnExtStub,
            },
          })
        ).to.be.eventually.rejected;
        expect(error.code).to.equal('DOCKER_LOGIN_ERROR');
        expect(error.message).to.not.include('malformedtoken');
        expect(
          innerSpawnExtStub.getCalls().some((call) => (call.args[1] || [])[0] === 'login')
        ).to.equal(false);
      });
    });
  });
});
