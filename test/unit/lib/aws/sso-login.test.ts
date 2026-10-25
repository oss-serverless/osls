'use strict';

const chai = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');

const { expect } = chai;

describe('test/unit/lib/aws/sso-login.test.js', () => {
  let originalEnv;
  let originalStdinIsTTY;
  let originalStdoutIsTTY;

  class RegisterClientCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class StartDeviceAuthorizationCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class CreateTokenCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class FakeSSOOIDCClient {
    constructor(config) {
      this.config = config;
      this.send = FakeSSOOIDCClient.send;
      FakeSSOOIDCClient.instances.push(this);
    }
  }
  FakeSSOOIDCClient.instances = [];
  FakeSSOOIDCClient.send = sinon.stub();

  // writable keeps the property assignable for other test files sharing this
  // process (e.g. run-compose tests assign process.stdout.isTTY directly)
  function setStdinIsTTY(value) {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, writable: true, value });
  }

  function setStdoutIsTTY(value) {
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, writable: true, value });
  }

  function createCredentialsProviderError(message = 'SSO token missing') {
    return Object.assign(new Error(message), { name: 'CredentialsProviderError' });
  }

  // Attaches the rejection handler synchronously so a rejection settling
  // during a fake-timer tick is not reported as unhandled
  function captureRejection(promise) {
    return promise.then(
      () => null,
      (error) => error
    );
  }

  function stubOidcFlow({ register, authorization, createToken } = {}) {
    FakeSSOOIDCClient.send.callsFake(async (command) => {
      if (command instanceof RegisterClientCommand) {
        if (register) return register();
        return {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          clientSecretExpiresAt: 1783284000,
        };
      }
      if (command instanceof StartDeviceAuthorizationCommand) {
        return {
          deviceCode: 'device-code',
          expiresIn: 600,
          interval: 0,
          userCode: 'ABCD-EFGH',
          verificationUriComplete: 'https://device.sso.aws/confirm',
          ...authorization,
        };
      }
      if (createToken) return createToken();
      return {
        accessToken: 'access-token',
        expiresIn: 3600,
        refreshToken: 'refresh-token',
      };
    });
  }

  function loadWrappedSsoProvider(provider, { requestHandler = {}, ...loadOptions } = {}) {
    const loaded = loadSsoLogin({
      profiles: {
        dev: {
          sso_start_url: 'https://example.awsapps.com/start',
          sso_account_id: '123456789012',
          sso_region: 'eu-west-1',
          sso_role_name: 'Admin',
        },
      },
      ...loadOptions,
    });
    const wrappedProvider = loaded.ssoLogin.withInteractiveSsoLogin({
      profile: 'dev',
      provider,
      filepath: '/aws/credentials',
      configFilepath: '/aws/config',
      requestHandler,
    });
    return { wrappedProvider, ...loaded };
  }

  function loadSsoLogin({
    profiles = {},
    sessions = {},
    parseKnownFiles,
    loadSsoSessionData,
    getSSOTokenFilepath,
    mkdir,
    writeFileAtomic,
    writeText,
  } = {}) {
    const getTokenPath =
      getSSOTokenFilepath ||
      ((cacheKey) => {
        return `/home/test/.aws/sso/cache/${cacheKey}.json`;
      });
    const mkdirStub = mkdir || sinon.stub().resolves();
    const writeFileAtomicStub = writeFileAtomic || sinon.stub().resolves();
    const writeTextStub = writeText || sinon.stub();

    const ssoLogin = proxyquire('../../../../lib/aws/sso-login', {
      '@aws-sdk/client-sso-oidc': {
        CreateTokenCommand,
        RegisterClientCommand,
        SSOOIDCClient: FakeSSOOIDCClient,
        StartDeviceAuthorizationCommand,
      },
      '@smithy/core/config': {
        getSSOTokenFilepath: getTokenPath,
        loadSsoSessionData: loadSsoSessionData || sinon.stub().resolves(sessions),
        parseKnownFiles: parseKnownFiles || sinon.stub().resolves(profiles),
      },
      '../utils/serverless-utils/log': { writeText: writeTextStub },
      'fs': {
        promises: {
          mkdir: mkdirStub,
        },
      },
      'write-file-atomic': writeFileAtomicStub,
    });

    return {
      mkdir: mkdirStub,
      ssoLogin,
      writeFileAtomic: writeFileAtomicStub,
      writeText: writeTextStub,
    };
  }

  beforeEach(() => {
    originalEnv = {
      CI: process.env.CI,
    };
    delete process.env.CI;
    originalStdinIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;
    setStdinIsTTY(true);
    setStdoutIsTTY(true);
    FakeSSOOIDCClient.instances = [];
    FakeSSOOIDCClient.send = sinon.stub();
  });

  afterEach(() => {
    if (originalEnv.CI === undefined) delete process.env.CI;
    else process.env.CI = originalEnv.CI;
    setStdinIsTTY(originalStdinIsTTY);
    setStdoutIsTTY(originalStdoutIsTTY);
    sinon.restore();
  });

  it('resolves modern SSO profile config with SDK-compatible session parsing', async () => {
    const { ssoLogin } = loadSsoLogin({
      profiles: {
        dev: {
          sso_session: 'my-sso',
          sso_account_id: '123456789012',
          sso_role_name: 'Admin',
        },
      },
      sessions: {
        'my-sso': {
          sso_region: 'eu-west-1',
          sso_start_url: 'https://example.awsapps.com/start',
          sso_registration_scopes: 'sso:account:access custom:scope',
        },
      },
    });

    await expect(
      ssoLogin.resolveSsoProfileConfig({
        profile: 'dev',
        filepath: '/aws/credentials',
        configFilepath: '/aws/config',
      })
    ).to.eventually.deep.equal({
      accountId: '123456789012',
      cacheKey: 'my-sso',
      profile: 'dev',
      region: 'eu-west-1',
      roleName: 'Admin',
      scopes: ['sso:account:access', 'custom:scope'],
      sessionName: 'my-sso',
      startUrl: 'https://example.awsapps.com/start',
    });
  });

  it('uses the legacy start URL as the cache key and default scopes', async () => {
    const { ssoLogin } = loadSsoLogin({
      profiles: {
        legacy: {
          sso_start_url: 'https://legacy.awsapps.com/start',
          sso_account_id: '123456789012',
          sso_region: 'us-east-1',
          sso_role_name: 'Admin',
        },
      },
    });

    await expect(
      ssoLogin.resolveSsoProfileConfig({
        profile: 'legacy',
        filepath: '/aws/credentials',
        configFilepath: '/aws/config',
      })
    ).to.eventually.include({
      cacheKey: 'https://legacy.awsapps.com/start',
      startUrl: 'https://legacy.awsapps.com/start',
    });
  });

  it('follows role-chaining source profiles to the SSO configuration', async () => {
    const { ssoLogin } = loadSsoLogin({
      profiles: {
        'dev': {
          role_arn: 'arn:aws:iam::123456789012:role/Deploy',
          source_profile: 'sso-base',
        },
        'sso-base': {
          sso_session: 'my-sso',
          sso_account_id: '123456789012',
          sso_role_name: 'Admin',
        },
      },
      sessions: {
        'my-sso': {
          sso_region: 'eu-west-1',
          sso_start_url: 'https://example.awsapps.com/start',
        },
      },
    });

    await expect(
      ssoLogin.resolveSsoProfileConfig({
        profile: 'dev',
        filepath: '/aws/credentials',
        configFilepath: '/aws/config',
      })
    ).to.eventually.include({ cacheKey: 'my-sso', profile: 'dev' });
  });

  it('resolves no SSO config when a source profile uses credential_source', async () => {
    // During role chaining, fromIni routes a source profile carrying
    // credential_source (without role_arn) to IMDS/ECS/environment credentials,
    // ignoring its sso_* keys
    const { ssoLogin } = loadSsoLogin({
      profiles: {
        dev: {
          role_arn: 'arn:aws:iam::123456789012:role/Deploy',
          source_profile: 'imds',
        },
        imds: {
          credential_source: 'Ec2InstanceMetadata',
          sso_start_url: 'https://example.awsapps.com/start',
          sso_account_id: '123456789012',
          sso_region: 'eu-west-1',
          sso_role_name: 'Admin',
        },
      },
    });

    await expect(
      ssoLogin.resolveSsoProfileConfig({
        profile: 'dev',
        filepath: '/aws/credentials',
        configFilepath: '/aws/config',
      })
    ).to.eventually.equal(null);
  });

  it('resolves no SSO config when the profile resolves through a non-SSO source', async () => {
    // fromIni prioritizes credential_process over the sso_* keys, so a login
    // could not fix the failure
    const { ssoLogin } = loadSsoLogin({
      profiles: {
        dev: {
          credential_process: '/usr/local/bin/aws-creds',
          sso_start_url: 'https://example.awsapps.com/start',
          sso_account_id: '123456789012',
          sso_region: 'eu-west-1',
          sso_role_name: 'Admin',
        },
      },
    });

    await expect(
      ssoLogin.resolveSsoProfileConfig({
        profile: 'dev',
        filepath: '/aws/credentials',
        configFilepath: '/aws/config',
      })
    ).to.eventually.equal(null);
  });

  it('resolves no SSO config when the profile is a web identity profile', async () => {
    const { ssoLogin } = loadSsoLogin({
      profiles: {
        dev: {
          web_identity_token_file: '/var/run/token',
          role_arn: 'arn:aws:iam::123456789012:role/WebIdentity',
          sso_start_url: 'https://example.awsapps.com/start',
          sso_account_id: '123456789012',
          sso_region: 'eu-west-1',
          sso_role_name: 'Admin',
        },
      },
    });

    await expect(
      ssoLogin.resolveSsoProfileConfig({
        profile: 'dev',
        filepath: '/aws/credentials',
        configFilepath: '/aws/config',
      })
    ).to.eventually.equal(null);
  });

  it('resolves SSO config when a web identity token file lacks role_arn', async () => {
    // fromIni only routes to web identity when role_arn is present; a stale
    // web_identity_token_file alone must not suppress SSO recovery
    const { ssoLogin } = loadSsoLogin({
      profiles: {
        dev: {
          web_identity_token_file: '/var/run/token',
          sso_start_url: 'https://example.awsapps.com/start',
          sso_account_id: '123456789012',
          sso_region: 'eu-west-1',
          sso_role_name: 'Admin',
        },
      },
    });

    await expect(
      ssoLogin.resolveSsoProfileConfig({
        profile: 'dev',
        filepath: '/aws/credentials',
        configFilepath: '/aws/config',
      })
    ).to.eventually.include({ cacheKey: 'https://example.awsapps.com/start' });
  });

  it('rethrows non-credential errors without attempting login', async () => {
    const originalError = new Error('unrelated failure');
    const { wrappedProvider } = loadWrappedSsoProvider(sinon.stub().rejects(originalError));

    const error = await captureRejection(wrappedProvider());

    expect(error).to.equal(originalError);
    expect(FakeSSOOIDCClient.instances).to.have.length(0);
  });

  it('preserves non-SSO credential errors', async () => {
    const originalError = createCredentialsProviderError('static credential failure');
    const { wrappedProvider } = loadWrappedSsoProvider(sinon.stub().rejects(originalError), {
      profiles: {
        dev: {
          aws_access_key_id: 'key',
        },
      },
    });

    await expect(wrappedProvider()).to.be.rejectedWith('static credential failure');
    expect(FakeSSOOIDCClient.instances).to.have.length(0);
  });

  it('runs device login, writes cache, and retries the normal provider once', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    const credentials = {
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    };
    const provider = sinon.stub();
    provider.onFirstCall().rejects(createCredentialsProviderError());
    provider.onSecondCall().resolves(credentials);
    stubOidcFlow({
      register: () => ({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        clientSecretExpiresAt: 1783276800,
      }),
    });
    const { wrappedProvider, writeFileAtomic, writeText } = loadWrappedSsoProvider(provider, {
      requestHandler: { handler: true },
      profiles: {
        dev: {
          sso_session: 'my-sso',
          sso_account_id: '123456789012',
          sso_role_name: 'Admin',
        },
      },
      sessions: {
        'my-sso': {
          sso_region: 'eu-west-1',
          sso_start_url: 'https://example.awsapps.com/start',
          sso_registration_scopes: 'sso:account:access',
        },
      },
    });

    const resultPromise = wrappedProvider({ callerClientConfig: { region: 'eu-west-1' } });
    await clock.tickAsync(1000);

    await expect(resultPromise).to.eventually.deep.equal(credentials);
    expect(provider).to.have.been.calledTwice;
    expect(provider).to.always.have.been.calledWithExactly({
      callerClientConfig: { region: 'eu-west-1' },
    });
    expect(FakeSSOOIDCClient.instances[0].config).to.deep.equal({
      region: 'eu-west-1',
      requestHandler: { handler: true },
    });
    expect(FakeSSOOIDCClient.send.firstCall.args[0].input).to.include({
      clientName: 'osls',
      clientType: 'public',
    });
    expect(FakeSSOOIDCClient.send.firstCall.args[0].input.scopes).to.deep.equal([
      'sso:account:access',
    ]);
    const loginInstructions = writeText.firstCall.args.join('\n');
    expect(loginInstructions).to.include('https://device.sso.aws/confirm');
    expect(loginInstructions).to.include('ABCD-EFGH');
    expect(loginInstructions).to.not.include('client-secret');
    expect(loginInstructions).to.not.include('refresh-token');
    const writtenToken = JSON.parse(writeFileAtomic.firstCall.args[1]);
    expect(writeFileAtomic.firstCall.args[0]).to.equal('/home/test/.aws/sso/cache/my-sso.json');
    expect(writeFileAtomic.firstCall.args[2]).to.deep.equal({ mode: 0o600 });
    expect(writtenToken).to.deep.equal({
      startUrl: 'https://example.awsapps.com/start',
      region: 'eu-west-1',
      accessToken: 'access-token',
      expiresAt: '2026-07-05T13:00:01.000Z',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      registrationExpiresAt: '2026-07-05T18:40:00.000Z',
      refreshToken: 'refresh-token',
    });
  });

  it('falls back to the plain verification URI when the complete URI is absent', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    const provider = sinon.stub();
    provider.onFirstCall().rejects(createCredentialsProviderError());
    provider.onSecondCall().resolves({ accessKeyId: 'key', secretAccessKey: 'secret' });
    stubOidcFlow({
      authorization: {
        verificationUriComplete: undefined,
        verificationUri: 'https://device.sso.aws/verify',
      },
    });
    const { wrappedProvider, writeText } = loadWrappedSsoProvider(provider);

    const resultPromise = wrappedProvider();
    await clock.tickAsync(1000);

    await expect(resultPromise).to.eventually.include({ accessKeyId: 'key' });
    const loginInstructions = writeText.firstCall.args.join('\n');
    expect(loginInstructions).to.include('https://device.sso.aws/verify');
    expect(loginInstructions).to.include('ABCD-EFGH');
  });

  it('backs off on slow_down while polling for the device token', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    const provider = sinon.stub();
    provider.onFirstCall().rejects(createCredentialsProviderError());
    provider.onSecondCall().resolves({
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
    let createTokenAttempts = 0;
    stubOidcFlow({
      createToken: () => {
        createTokenAttempts += 1;
        if (createTokenAttempts === 1) {
          throw Object.assign(new Error('slow down'), { name: 'SlowDownException' });
        }
        return {
          accessToken: 'access-token',
          expiresIn: 3600,
          refreshToken: 'refresh-token',
        };
      },
    });
    const { wrappedProvider } = loadWrappedSsoProvider(provider);

    const resultPromise = wrappedProvider();
    await clock.tickAsync(1000);
    await clock.tickAsync(6000);

    await expect(resultPromise).to.eventually.include({ accessKeyId: 'key' });
    expect(FakeSSOOIDCClient.send).to.have.been.calledWith(
      sinon.match.instanceOf(CreateTokenCommand)
    );
    expect(FakeSSOOIDCClient.send).to.have.callCount(4);
  });

  it('single-flights concurrent logins for the same SSO cache key', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    const provider = sinon.stub();
    provider.onCall(0).rejects(createCredentialsProviderError());
    provider.onCall(1).rejects(createCredentialsProviderError());
    provider.onCall(2).resolves({ accessKeyId: 'first', secretAccessKey: 'secret' });
    provider.onCall(3).resolves({ accessKeyId: 'second', secretAccessKey: 'secret' });
    let resolveRegistration;
    const registrationPromise = new Promise((resolve) => {
      resolveRegistration = resolve;
    });
    stubOidcFlow({ register: () => registrationPromise });
    const { wrappedProvider } = loadWrappedSsoProvider(provider);

    const firstResult = wrappedProvider();
    const secondResult = wrappedProvider();
    await clock.tickAsync(0);
    resolveRegistration({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      clientSecretExpiresAt: 1783284000,
    });
    await clock.tickAsync(1000);

    await expect(firstResult).to.eventually.include({ accessKeyId: 'first' });
    await expect(secondResult).to.eventually.include({ accessKeyId: 'second' });
    const registerCalls = FakeSSOOIDCClient.send
      .getCalls()
      .filter((call) => call.args[0] instanceof RegisterClientCommand);
    expect(registerCalls).to.have.length(1);
  });

  it('allows a fresh login attempt after a failed one', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    const credentials = { accessKeyId: 'key', secretAccessKey: 'secret' };
    const provider = sinon.stub();
    provider.onCall(0).rejects(createCredentialsProviderError());
    provider.onCall(1).rejects(createCredentialsProviderError());
    provider.onCall(2).resolves(credentials);
    let createTokenAttempts = 0;
    stubOidcFlow({
      createToken: () => {
        createTokenAttempts += 1;
        if (createTokenAttempts === 1) {
          throw Object.assign(new Error('device code expired'), { name: 'ExpiredTokenException' });
        }
        return {
          accessToken: 'access-token',
          expiresIn: 3600,
          refreshToken: 'refresh-token',
        };
      },
    });
    const { wrappedProvider } = loadWrappedSsoProvider(provider);

    const firstError = captureRejection(wrappedProvider());
    await clock.tickAsync(1000);
    expect((await firstError).code).to.equal('AWS_SSO_LOGIN_EXPIRED');

    const secondResult = wrappedProvider();
    await clock.tickAsync(1000);
    await expect(secondResult).to.eventually.deep.equal(credentials);

    const registerCalls = FakeSSOOIDCClient.send
      .getCalls()
      .filter((call) => call.args[0] instanceof RegisterClientCommand);
    expect(registerCalls).to.have.length(2);
  });

  it('allows a new login after the previously written token expires', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    const provider = sinon.stub();
    provider.onCall(0).rejects(createCredentialsProviderError());
    provider.onCall(1).resolves({ accessKeyId: 'first', secretAccessKey: 'secret' });
    provider.onCall(2).rejects(createCredentialsProviderError());
    provider.onCall(3).resolves({ accessKeyId: 'second', secretAccessKey: 'secret' });
    stubOidcFlow();
    const { wrappedProvider } = loadWrappedSsoProvider(provider);

    const firstResult = wrappedProvider();
    await clock.tickAsync(1000);
    await expect(firstResult).to.eventually.include({ accessKeyId: 'first' });

    // The token written by the first login (expiresIn: 3600) has now expired
    await clock.tickAsync(3600 * 1000);
    const secondResult = wrappedProvider();
    await clock.tickAsync(1000);
    await expect(secondResult).to.eventually.include({ accessKeyId: 'second' });

    const registerCalls = FakeSSOOIDCClient.send
      .getCalls()
      .filter((call) => call.args[0] instanceof RegisterClientCommand);
    expect(registerCalls).to.have.length(2);
  });

  it('rethrows the original provider error when SSO detection itself fails', async () => {
    const originalError = createCredentialsProviderError('original provider failure');
    const { wrappedProvider } = loadWrappedSsoProvider(sinon.stub().rejects(originalError), {
      parseKnownFiles: sinon.stub().rejects(new Error('config file unreadable')),
    });

    const error = await captureRejection(wrappedProvider());

    expect(error).to.equal(originalError);
    expect(FakeSSOOIDCClient.instances).to.have.length(0);
  });

  it('maps a denied device authorization to AWS_SSO_LOGIN_DENIED', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    const deniedError = Object.assign(new Error('denied by user'), {
      name: 'AccessDeniedException',
    });
    stubOidcFlow({
      createToken: () => {
        throw deniedError;
      },
    });
    const { wrappedProvider } = loadWrappedSsoProvider(
      sinon.stub().rejects(createCredentialsProviderError())
    );

    const resultError = captureRejection(wrappedProvider());
    await clock.tickAsync(1000);
    const error = await resultError;

    expect(error.code).to.equal('AWS_SSO_LOGIN_DENIED');
    expect(error.cause).to.equal(deniedError);
  });

  it('maps an expired device code to AWS_SSO_LOGIN_EXPIRED', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    stubOidcFlow({
      createToken: () => {
        throw Object.assign(new Error('device code expired'), { name: 'ExpiredTokenException' });
      },
    });
    const { wrappedProvider } = loadWrappedSsoProvider(
      sinon.stub().rejects(createCredentialsProviderError())
    );

    const resultError = captureRejection(wrappedProvider());
    await clock.tickAsync(1000);

    expect((await resultError).code).to.equal('AWS_SSO_LOGIN_EXPIRED');
  });

  it('maps an authorization wall-clock timeout to AWS_SSO_LOGIN_EXPIRED', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    stubOidcFlow({ authorization: { expiresIn: 0 } });
    const { wrappedProvider } = loadWrappedSsoProvider(
      sinon.stub().rejects(createCredentialsProviderError())
    );

    const resultError = captureRejection(wrappedProvider());
    await clock.tickAsync(0);

    expect((await resultError).code).to.equal('AWS_SSO_LOGIN_EXPIRED');
    expect(FakeSSOOIDCClient.send).to.not.have.been.calledWith(
      sinon.match.instanceOf(CreateTokenCommand)
    );
  });

  it('maps an incomplete OIDC response to AWS_SSO_LOGIN_INVALID_RESPONSE', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    stubOidcFlow({ createToken: () => ({ expiresIn: 3600 }) });
    const { wrappedProvider } = loadWrappedSsoProvider(
      sinon.stub().rejects(createCredentialsProviderError())
    );

    const resultError = captureRejection(wrappedProvider());
    await clock.tickAsync(1000);

    expect((await resultError).code).to.equal('AWS_SSO_LOGIN_INVALID_RESPONSE');
  });

  it('propagates unknown OIDC errors while polling unchanged', async () => {
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    const unknownError = Object.assign(new Error('internal failure'), {
      name: 'InternalServerException',
    });
    stubOidcFlow({
      createToken: () => {
        throw unknownError;
      },
    });
    const { wrappedProvider } = loadWrappedSsoProvider(
      sinon.stub().rejects(createCredentialsProviderError())
    );

    const resultError = captureRejection(wrappedProvider());
    await clock.tickAsync(1000);

    expect(await resultError).to.equal(unknownError);
  });

  it('does not prompt again when credentials still fail after a completed login', async () => {
    // A failure that persists after a fresh login (e.g. the user has no access
    // to the account or role) cannot be fixed by another login
    const clock = sinon.useFakeTimers(new Date('2026-07-05T12:00:00.000Z'));
    const providerError = createCredentialsProviderError('user is not assigned to the role');
    stubOidcFlow();
    const { wrappedProvider } = loadWrappedSsoProvider(sinon.stub().rejects(providerError));

    const firstError = captureRejection(wrappedProvider());
    await clock.tickAsync(1000);
    expect((await firstError).message).to.equal('user is not assigned to the role');

    const secondError = captureRejection(wrappedProvider());
    await clock.tickAsync(0);
    expect((await secondError).message).to.equal('user is not assigned to the role');

    const registerCalls = FakeSSOOIDCClient.send
      .getCalls()
      .filter((call) => call.args[0] instanceof RegisterClientCommand);
    expect(registerCalls).to.have.length(1);
  });

  it('fails before OIDC calls in CI, preserving the original error details', async () => {
    process.env.CI = '1';
    const originalError = createCredentialsProviderError('the SSO session has expired');
    const { wrappedProvider } = loadWrappedSsoProvider(sinon.stub().rejects(originalError));

    const error = await captureRejection(wrappedProvider());

    expect(error.code).to.equal('AWS_SSO_LOGIN_UNAVAILABLE');
    expect(error.message).to.include('requires an interactive terminal');
    expect(error.message).to.include('the SSO session has expired');
    expect(error.cause).to.equal(originalError);
    expect(FakeSSOOIDCClient.instances).to.have.length(0);
  });

  it('treats CI=false as an interactive environment', async () => {
    process.env.CI = 'false';
    FakeSSOOIDCClient.send.rejects(
      Object.assign(new Error('registration failed'), { name: 'InternalServerException' })
    );
    const { wrappedProvider } = loadWrappedSsoProvider(
      sinon.stub().rejects(createCredentialsProviderError())
    );

    // The interactive flow was entered (and failed on the stubbed OIDC call)
    // instead of being rejected as non-interactive
    await expect(wrappedProvider()).to.be.rejectedWith('registration failed');
    expect(FakeSSOOIDCClient.instances).to.have.length(1);
  });

  it('allows login when stdin is piped but stdout is a TTY', async () => {
    // The device flow only displays a URL, so a piped stdin (git hooks,
    // wrapper scripts) must not block it
    setStdinIsTTY(false);
    FakeSSOOIDCClient.send.rejects(
      Object.assign(new Error('registration failed'), { name: 'InternalServerException' })
    );
    const { wrappedProvider } = loadWrappedSsoProvider(
      sinon.stub().rejects(createCredentialsProviderError())
    );

    await expect(wrappedProvider()).to.be.rejectedWith('registration failed');
    expect(FakeSSOOIDCClient.instances).to.have.length(1);
  });
});
