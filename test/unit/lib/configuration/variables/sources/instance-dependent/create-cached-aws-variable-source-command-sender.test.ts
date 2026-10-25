'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const createCachedAwsVariableSourceCommandSender = require('../../../../../../../lib/configuration/variables/sources/instance-dependent/create-cached-aws-variable-source-command-sender');

describe('test/unit/lib/configuration/variables/sources/instance-dependent/create-cached-aws-variable-source-command-sender.test.js', () => {
  class TestCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class OtherCommand {
    constructor(input) {
      this.input = input;
    }
  }

  function createDeferred() {
    const deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    });
    return deferred;
  }

  function nextTick() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  function createClient({ send }) {
    const instances = [];

    class TestClient {
      constructor(config) {
        this.config = config;
        this.send = send;
        instances.push(this);
      }
    }

    TestClient.instances = instances;
    return TestClient;
  }

  function createProvider(config = { region: 'us-east-1' }, region = 'us-east-1') {
    return {
      getRegion: sinon.stub().returns(region),
      getAwsSdkV3Config: sinon.stub().resolves(config),
    };
  }

  it('does not resolve the provider until a command is sent', () => {
    const getProvider = sinon.stub().returns(createProvider());
    const TestClient = createClient({ send: sinon.stub() });

    createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    expect(getProvider).to.not.have.been.called;
    expect(TestClient.instances).to.have.length(0);
  });

  it('builds a client from provider SDK v3 config and sends commands', async () => {
    const credentials = sinon.stub();
    const config = { region: 'eu-west-1', credentials };
    const provider = createProvider(config);
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await expect(
      sender.send(TestCommand, { Name: 'parameter' }, { region: 'eu-west-1' })
    ).to.eventually.deep.equal({ ok: true });

    expect(getProvider).to.have.been.calledOnce;
    expect(provider.getAwsSdkV3Config).to.have.been.calledOnceWithExactly({
      region: 'eu-west-1',
    });
    expect(TestClient.instances).to.have.length(1);
    expect(TestClient.instances[0].config).to.equal(config);
    expect(TestClient.instances[0].config.credentials).to.equal(credentials);
    expect(send).to.have.been.calledOnce;
    expect(send.firstCall.args[0]).to.be.instanceOf(TestCommand);
    expect(send.firstCall.args[0].input).to.deep.equal({ Name: 'parameter' });
  });

  it('reuses clients for the same effective region', async () => {
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await sender.send(TestCommand, { Name: 'first' }, { region: 'eu-west-1' });
    await sender.send(TestCommand, { Name: 'second' }, { region: 'eu-west-1' });

    expect(getProvider).to.have.been.calledOnce;
    expect(TestClient.instances).to.have.length(1);
    expect(provider.getAwsSdkV3Config).to.have.been.calledOnce;
    expect(send).to.have.been.calledTwice;
  });

  it('uses different clients for different effective regions', async () => {
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await sender.send(TestCommand, { Name: 'parameter' }, { region: 'eu-west-1' });
    await sender.send(TestCommand, { Name: 'parameter' }, { region: 'us-east-1' });

    expect(TestClient.instances).to.have.length(2);
    expect(provider.getAwsSdkV3Config).to.have.been.calledTwice;
  });

  it('shares cache entries between omitted region and explicit provider region', async () => {
    const provider = createProvider({ region: 'us-east-1' }, 'us-east-1');
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await sender.send(TestCommand, { Name: 'parameter' });
    await sender.send(TestCommand, { Name: 'parameter' }, { region: 'us-east-1' });

    expect(provider.getAwsSdkV3Config).to.have.been.calledOnceWithExactly({
      region: 'us-east-1',
    });
    expect(TestClient.instances).to.have.length(1);
    expect(send).to.have.been.calledOnce;
  });

  it('passes explicit null region without provider region fallback', async () => {
    const provider = createProvider({ region: null }, 'us-east-1');
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await sender.send(TestCommand, { Name: 'parameter' }, { region: null });

    expect(provider.getRegion).to.not.have.been.called;
    expect(provider.getAwsSdkV3Config).to.have.been.calledOnceWithExactly({
      region: null,
    });
    expect(TestClient.instances).to.have.length(1);
  });

  it('passes explicit empty string region without provider region fallback', async () => {
    const provider = createProvider({ region: '' }, 'us-east-1');
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await sender.send(TestCommand, { Name: 'parameter' }, { region: '' });

    expect(provider.getRegion).to.not.have.been.called;
    expect(provider.getAwsSdkV3Config).to.have.been.calledOnceWithExactly({
      region: '',
    });
    expect(TestClient.instances).to.have.length(1);
  });

  it('separates explicit null and empty string regions from provider region cache entries', async () => {
    const provider = createProvider({ region: 'us-east-1' }, 'us-east-1');
    provider.getAwsSdkV3Config.callsFake(async ({ region }) => ({ region }));
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await sender.send(TestCommand, { Name: 'parameter' });
    await sender.send(TestCommand, { Name: 'parameter' }, { region: 'us-east-1' });
    await sender.send(TestCommand, { Name: 'parameter' }, { region: null });
    await sender.send(TestCommand, { Name: 'parameter' }, { region: '' });

    expect(provider.getAwsSdkV3Config.getCalls().map((call) => call.firstArg)).to.deep.equal([
      { region: 'us-east-1' },
      { region: null },
      { region: '' },
    ]);
    expect(TestClient.instances).to.have.length(3);
    expect(send).to.have.been.calledThrice;
  });

  it('caches identical transformed command results by default', async () => {
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const transformResult = sinon.stub().returns({ transformed: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
      transformResult,
    });

    await expect(sender.send(TestCommand, { Name: 'parameter' })).to.eventually.deep.equal({
      transformed: true,
    });
    await expect(sender.send(TestCommand, { Name: 'parameter' })).to.eventually.deep.equal({
      transformed: true,
    });

    expect(send).to.have.been.calledOnce;
    expect(transformResult).to.have.been.calledOnce;
  });

  it('passes command context to transformResult', async () => {
    const rawResult = { Body: 'raw' };
    const input = { Name: 'parameter' };
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves(rawResult);
    const transformResult = sinon.stub().returns('mapped');
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
      transformResult,
    });

    await expect(sender.send(TestCommand, input, { region: 'eu-west-1' })).to.eventually.equal(
      'mapped'
    );

    expect(transformResult).to.have.been.calledOnceWithExactly({
      result: rawResult,
      commandName: 'TestCommand',
      input,
      region: 'eu-west-1',
      effectiveRegion: 'eu-west-1',
    });
  });

  it('uses stable cache keys for deep-sorted command input', async () => {
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await sender.send(TestCommand, {
      Tags: [{ Value: 'one', Key: 'first' }],
      Nested: { b: 2, a: 1 },
    });
    await sender.send(TestCommand, {
      Nested: { a: 1, b: 2 },
      Tags: [{ Key: 'first', Value: 'one' }],
    });

    expect(send).to.have.been.calledOnce;
  });

  it('separates cached commands by command name, effective region, and input', async () => {
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await sender.send(TestCommand, { Name: 'parameter' }, { region: 'eu-west-1' });
    await sender.send(TestCommand, { Name: 'parameter' }, { region: 'us-east-1' });
    await sender.send(TestCommand, { Name: 'other' }, { region: 'eu-west-1' });
    await sender.send(OtherCommand, { Name: 'parameter' }, { region: 'eu-west-1' });

    expect(send).to.have.callCount(4);
  });

  it('evicts rejected cached command promises', async () => {
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const send = sinon
      .stub()
      .onFirstCall()
      .rejects(new Error('temporary'))
      .onSecondCall()
      .resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await expect(sender.send(TestCommand, { Name: 'parameter' })).to.be.rejectedWith('temporary');
    await expect(sender.send(TestCommand, { Name: 'parameter' })).to.eventually.deep.equal({
      ok: true,
    });

    expect(send).to.have.been.calledTwice;
  });

  it('evicts rejected transformResult promises', async () => {
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const transformResult = sinon
      .stub()
      .onFirstCall()
      .rejects(new Error('transform failed'))
      .onSecondCall()
      .resolves({ transformed: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
      transformResult,
    });

    await expect(sender.send(TestCommand, { Name: 'parameter' })).to.be.rejectedWith(
      'transform failed'
    );
    await expect(sender.send(TestCommand, { Name: 'parameter' })).to.eventually.deep.equal({
      transformed: true,
    });

    expect(send).to.have.been.calledTwice;
    expect(transformResult).to.have.been.calledTwice;
  });

  it('evicts failed client construction promises', async () => {
    const provider = {
      getRegion: sinon.stub().returns('us-east-1'),
      getAwsSdkV3Config: sinon
        .stub()
        .onFirstCall()
        .rejects(new Error('config failed'))
        .onSecondCall()
        .resolves({ region: 'us-east-1' }),
    };
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    await expect(sender.send(TestCommand, { Name: 'first' })).to.be.rejectedWith('config failed');
    await expect(sender.send(TestCommand, { Name: 'second' })).to.eventually.deep.equal({
      ok: true,
    });

    expect(provider.getAwsSdkV3Config).to.have.been.calledTwice;
    expect(TestClient.instances).to.have.length(1);
  });

  it('limits command and transform concurrency per sender to 2', async () => {
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const send = sinon.stub().resolves({ ok: true });
    const transformResults = [];
    const transformResult = sinon.stub().callsFake(() => {
      const deferred = createDeferred();
      transformResults.push(deferred);
      return deferred.promise;
    });
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
      transformResult,
    });

    const first = sender.send(TestCommand, { Name: 'first' });
    const second = sender.send(TestCommand, { Name: 'second' });
    const third = sender.send(TestCommand, { Name: 'third' });
    await nextTick();

    expect(send).to.have.been.calledTwice;
    expect(transformResult).to.have.been.calledTwice;

    transformResults[0].resolve('first');
    await nextTick();

    expect(send).to.have.callCount(3);
    expect(transformResult).to.have.callCount(3);

    transformResults[1].resolve('second');
    transformResults[2].resolve('third');

    await expect(Promise.all([first, second, third])).to.eventually.deep.equal([
      'first',
      'second',
      'third',
    ]);
  });

  it('does not duplicate identical queued commands', async () => {
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const deferred = createDeferred();
    const send = sinon.stub().returns(deferred.promise);
    const TestClient = createClient({ send });
    const sender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: TestClient,
    });

    const first = sender.send(TestCommand, { Name: 'parameter' });
    const second = sender.send(TestCommand, { Name: 'parameter' });
    const third = sender.send(TestCommand, { Name: 'parameter' });
    await nextTick();

    expect(send).to.have.been.calledOnce;

    deferred.resolve({ ok: true });
    await expect(Promise.all([first, second, third])).to.eventually.deep.equal([
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
  });

  it('scopes concurrency limits per sender instance', async () => {
    const provider = createProvider();
    const getProvider = sinon.stub().returns(provider);
    const transformResults = [];
    const transformResult = sinon.stub().callsFake(() => {
      const deferred = createDeferred();
      transformResults.push(deferred);
      return deferred.promise;
    });
    const send = sinon.stub().resolves({ ok: true });
    const FirstClient = createClient({ send });
    const SecondClient = createClient({ send });
    const firstSender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: FirstClient,
      transformResult,
    });
    const secondSender = createCachedAwsVariableSourceCommandSender({
      getProvider,
      Client: SecondClient,
      transformResult,
    });

    const promises = [
      firstSender.send(TestCommand, { Name: 'first' }),
      firstSender.send(TestCommand, { Name: 'second' }),
      firstSender.send(TestCommand, { Name: 'third' }),
      secondSender.send(TestCommand, { Name: 'fourth' }),
      secondSender.send(TestCommand, { Name: 'fifth' }),
      secondSender.send(TestCommand, { Name: 'sixth' }),
    ];
    await nextTick();

    expect(send).to.have.callCount(4);
    expect(transformResult).to.have.callCount(4);

    for (let index = 0; index < transformResults.length; index += 1) {
      transformResults[index].resolve(index);
    }

    await nextTick();
    for (let index = 4; index < transformResults.length; index += 1) {
      transformResults[index].resolve(index);
    }

    await expect(Promise.all(promises)).to.eventually.deep.equal([0, 1, 4, 2, 3, 5]);
  });
});
