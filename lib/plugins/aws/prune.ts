'use strict';

const {
  LambdaClient,
  DeleteFunctionCommand,
  DeleteLayerVersionCommand,
  ListAliasesCommand,
  ListLayerVersionsCommand,
  ListVersionsByFunctionCommand,
} = require('@aws-sdk/client-lambda');
const ServerlessError = require('../../serverless-error');
const { log } = require('../../utils/serverless-utils/log');
const {
  getAwsErrorMessage,
  getAwsErrorStatusCode,
  isLambdaResourceNotFoundError,
} = require('../../aws/aws-sdk-v3-error');
const { retryOnThrottlingError } = require('../../aws/retry');

const DEFAULT_PRUNE_VERSIONS = 10;

class AwsPrune {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'before:deploy:deploy': async () => this.validateConfiguration(),
      'after:deploy:deploy': async () => this.postDeploy(),
    };
  }

  resolvePruneConfig() {
    const setting = this.serverless.service.provider.pruneFunctionVersions;
    if (setting == null || setting === false) return null;
    if (setting === true) return { number: DEFAULT_PRUNE_VERSIONS };
    if (typeof setting === 'object' && setting.number != null) {
      const number = parseInt(setting.number, 10);
      if (!isNaN(number) && number >= 1) return { number };
    }
    throw new ServerlessError(
      'provider.pruneFunctionVersions must be true or an object with a positive number property',
      'INVALID_PRUNE_FUNCTION_VERSIONS_CONFIG'
    );
  }

  getNumber() {
    const config = this.resolvePruneConfig();
    return config ? config.number : undefined;
  }

  shouldVersionFunction(functionKey) {
    const functionObject = this.serverless.service.getFunction(functionKey);
    if (functionObject.durableConfig) return false;
    if (functionObject.versionFunction != null) {
      return functionObject.versionFunction;
    }
    return this.serverless.service.provider.versionFunctions !== false;
  }

  hasDurableFunctions() {
    return this.serverless.service.getAllFunctions().some((functionKey) => {
      return this.serverless.service.getFunction(functionKey).durableConfig;
    });
  }

  hasPrunableFunctions() {
    return this.serverless.service.getAllFunctions().some((functionKey) => {
      return this.shouldVersionFunction(functionKey);
    });
  }

  validateConfiguration() {
    const config = this.resolvePruneConfig();
    if (!config) return;

    if (
      this.serverless.service.provider.versionFunctions === false &&
      (!this.hasDurableFunctions() || this.hasPrunableFunctions())
    ) {
      throw new ServerlessError(
        'provider.pruneFunctionVersions cannot be used when provider.versionFunctions is false unless only durable functions force versioning',
        'PRUNE_INCOMPATIBLE_WITH_VERSION_FUNCTIONS'
      );
    }
  }

  async postDeploy() {
    const config = this.resolvePruneConfig();
    if (!config) return;

    this.validateConfiguration();

    await Promise.all([this.pruneFunctions(), this.pruneLayers()]);
  }

  async getLambdaClient() {
    this.lambdaClientPromise ||= this.provider
      .getAwsSdkV3Config()
      .then((lambdaConfig) => new LambdaClient(lambdaConfig));
    return this.lambdaClientPromise;
  }

  async pruneLayers() {
    const layerNames = this.serverless.service
      .getAllLayers()
      .map((key) => this.serverless.service.getLayer(key).name || key);

    let prunedCount = 0;
    for (const layerName of layerNames) {
      const versions = await this.listVersionsForLayer(layerName);
      if (!versions.length) continue;

      const deletionCandidates = this.selectPruneVersionsForLayer(versions);
      prunedCount += await this.deleteVersionsForLayer(layerName, deletionCandidates);
    }

    if (prunedCount > 0) {
      log.notice.success(`Pruned ${prunedCount} layer version${prunedCount === 1 ? '' : 's'}`);
    }
  }

  async pruneFunctions() {
    let prunedCount = 0;
    let skippedDurableCount = 0;

    for (const functionKey of this.serverless.service.getAllFunctions()) {
      if (!this.shouldVersionFunction(functionKey)) {
        if (this.serverless.service.getFunction(functionKey).durableConfig) {
          skippedDurableCount++;
        }
        continue;
      }

      const functionName = this.serverless.service.getFunction(functionKey).name;
      const [versions, aliases] = await Promise.all([
        this.listVersionsForFunction(functionName),
        this.listAliasesForFunction(functionName),
      ]);
      if (!versions.length) continue;

      const deletionCandidates = this.selectPruneVersionsForFunction(versions, aliases);
      prunedCount += await this.deleteVersionsForFunction(functionName, deletionCandidates);
    }

    if (skippedDurableCount > 0) {
      log.info(
        `Skipped pruning ${skippedDurableCount} durable function${
          skippedDurableCount === 1 ? '' : 's'
        }; retained versions may be needed for durable execution replay.`
      );
    }

    if (prunedCount > 0) {
      log.notice.success(`Pruned ${prunedCount} function version${prunedCount === 1 ? '' : 's'}`);
    }
  }

  async deleteVersionsForLayer(layerName, versions) {
    const lambda = await this.getLambdaClient();
    let deletedCount = 0;

    for (const version of versions) {
      log.info(`Deleting layer version ${layerName}:${version}.`);
      await retryOnThrottlingError(
        () =>
          lambda.send(
            new DeleteLayerVersionCommand({
              LayerName: layerName,
              VersionNumber: version,
            })
          ),
        { name: 'Lambda layer version deletion' }
      );
      deletedCount++;
    }

    return deletedCount;
  }

  async deleteVersionsForFunction(functionName, versions) {
    const lambda = await this.getLambdaClient();
    let deletedCount = 0;

    for (const version of versions) {
      log.info(`Deleting function version ${functionName}:${version}.`);
      try {
        await retryOnThrottlingError(
          () =>
            lambda.send(
              new DeleteFunctionCommand({
                FunctionName: functionName,
                Qualifier: version,
              })
            ),
          { name: 'Lambda function version deletion' }
        );
        deletedCount++;
      } catch (error) {
        const statusCode = getAwsErrorStatusCode(error);
        const message = getAwsErrorMessage(error) || '';
        if (
          statusCode === 400 &&
          message.startsWith('Lambda was unable to delete') &&
          message.includes('because it is a replicated function.')
        ) {
          log.warning(
            `Unable to delete replicated Lambda@Edge function version ${functionName}:${version}.`
          );
        } else {
          throw error;
        }
      }
    }

    return deletedCount;
  }

  async listAliasesForFunction(functionName) {
    try {
      return await this.paginateLambda(
        ListAliasesCommand,
        { FunctionName: functionName },
        'Aliases',
        'Lambda aliases listing'
      );
    } catch (error) {
      if (isLambdaResourceNotFoundError(error)) return [];
      throw error;
    }
  }

  async listVersionsForFunction(functionName) {
    try {
      return await this.paginateLambda(
        ListVersionsByFunctionCommand,
        { FunctionName: functionName },
        'Versions',
        'Lambda function versions listing'
      );
    } catch (error) {
      if (isLambdaResourceNotFoundError(error)) return [];
      throw error;
    }
  }

  async listVersionsForLayer(layerName) {
    try {
      return await this.paginateLambda(
        ListLayerVersionsCommand,
        { LayerName: layerName },
        'LayerVersions',
        'Lambda layer versions listing'
      );
    } catch (error) {
      if (isLambdaResourceNotFoundError(error)) return [];
      throw error;
    }
  }

  async paginateLambda(Command, params, resultKey, name) {
    const lambda = await this.getLambdaClient();
    const results = [];
    let input = params;

    do {
      const response = await retryOnThrottlingError(() => lambda.send(new Command(input)), {
        name,
      });
      results.push(...(response[resultKey] || []));
      input = response.NextMarker ? { ...params, Marker: response.NextMarker } : null;
    } while (input);

    return results;
  }

  selectPruneVersionsForFunction(versions, aliases) {
    const aliasedVersions = new Set(aliases.map((alias) => String(alias.FunctionVersion)));

    return versions
      .map((versionEntry) => versionEntry.Version)
      .filter((version) => version !== '$LATEST')
      .filter((version) => !aliasedVersions.has(String(version)))
      .sort((a, b) =>
        parseInt(a, 10) === parseInt(b, 10) ? 0 : parseInt(a, 10) > parseInt(b, 10) ? -1 : 1
      )
      .slice(this.getNumber());
  }

  selectPruneVersionsForLayer(versions) {
    return versions
      .map((versionEntry) => versionEntry.Version)
      .sort((a, b) =>
        parseInt(a, 10) === parseInt(b, 10) ? 0 : parseInt(a, 10) > parseInt(b, 10) ? -1 : 1
      )
      .slice(this.getNumber());
  }
}

module.exports = AwsPrune;
