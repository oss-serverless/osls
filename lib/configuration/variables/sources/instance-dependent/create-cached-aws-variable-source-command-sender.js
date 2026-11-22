'use strict';

const promiseLimit = require('ext/promise/limit').bind(Promise);
const { fromTemporaryCredentials } = require('@aws-sdk/credential-providers');
const deepSortObjectByKey = require('../../../../utils/deep-sort-object-by-key');

const maxConcurrentVariableSourceCommands = 2;

function normalizeRegion(region) {
  return region === undefined ? null : region;
}

function normalizeRoleArn(roleArn) {
  return roleArn || null;
}

function getCommandName(Command) {
  return Command.name || 'Command';
}

function createCacheKey({ commandName, region, roleArn, input }) {
  return JSON.stringify({
    command: commandName,
    region: normalizeRegion(region),
    roleArn: normalizeRoleArn(roleArn),
    input: input === undefined ? null : deepSortObjectByKey(input),
  });
}

function createCachedAwsVariableSourceCommandSender({
  getProvider,
  Client,
  clientOptions,
  transformResult = ({ result }) => result,
}) {
  const clients = new Map();
  const requests = new Map();
  const sendQueue = promiseLimit(maxConcurrentVariableSourceCommands, async (task) => task());
  let provider;

  function resolveProvider() {
    if (!provider) provider = getProvider();
    return provider;
  }

  function getEffectiveRegion(region) {
    return region === undefined ? resolveProvider().getRegion() : region;
  }

  async function getClient(region, roleArn) {
    const cacheKey = JSON.stringify({
      region: normalizeRegion(region),
      roleArn: normalizeRoleArn(roleArn),
    });

    if (!clients.has(cacheKey)) {
      const clientPromise = (async () => {
        const config = await resolveProvider().getAwsSdkV3Config({ region, ...clientOptions });
        if (!roleArn) return new Client(config);

        return new Client({
          ...config,
          credentials: fromTemporaryCredentials({
            masterCredentials: config.credentials,
            params: { RoleArn: roleArn },
          }),
        });
      })();

      clients.set(
        cacheKey,
        clientPromise.catch((error) => {
          clients.delete(cacheKey);
          throw error;
        })
      );
    }

    return clients.get(cacheKey);
  }

  async function send(Command, input, options = {}) {
    const { region, roleArn } = options;
    const effectiveRegion = getEffectiveRegion(region);
    const commandName = getCommandName(Command);
    const cacheKey = createCacheKey({
      commandName,
      region: effectiveRegion,
      roleArn,
      input,
    });

    if (!requests.has(cacheKey)) {
      const requestPromise = (async () => {
        const client = await getClient(effectiveRegion, roleArn);

        return sendQueue(async () => {
          const result = await client.send(new Command(input));
          return transformResult({
            result,
            commandName,
            input,
            region,
            effectiveRegion,
          });
        });
      })();

      requests.set(
        cacheKey,
        requestPromise.catch((error) => {
          requests.delete(cacheKey);
          throw error;
        })
      );
    }

    return requests.get(cacheKey);
  }

  return { send };
}

module.exports = createCachedAwsVariableSourceCommandSender;
