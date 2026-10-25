'use strict';

const { addPermission, removePermission, getStatementId } = require('./lib/permissions');
const { updateConfiguration, removeConfiguration } = require('./lib/bucket');
const { getEnvironment, getLambdaArn, handlerWrapper } = require('../utils');

async function handler(event, context) {
  if (event.RequestType === 'Create') {
    return create(event, context);
  } else if (event.RequestType === 'Update') {
    return update(event, context);
  } else if (event.RequestType === 'Delete') {
    return remove(event, context);
  }
  throw new Error(`Unhandled RequestType ${event.RequestType}`);
}

async function create(event, context) {
  const environment = getEnvironment(context);
  const { Partition, Region, AccountId } = environment;
  const target = resolveTarget(event.ResourceProperties, environment);

  await ensurePermission({
    functionName: target.functionName,
    functionQualifier: target.functionQualifier,
    bucketName: target.bucketName,
    partition: Partition,
    region: Region,
    accountId: AccountId,
  });

  return updateConfiguration({
    lambdaArn: target.lambdaArn,
    region: Region,
    functionName: target.functionName,
    bucketName: target.bucketName,
    bucketConfigs: target.bucketConfigs,
  });
}

async function update(event, context) {
  const environment = getEnvironment(context);
  const { Partition, Region, AccountId } = environment;
  const target = resolveTarget(event.ResourceProperties, environment);
  const oldTarget =
    event.OldResourceProperties && resolveTarget(event.OldResourceProperties, environment);

  const sameTarget = isSameTarget(target, oldTarget);

  if (!sameTarget) {
    await ensurePermission({
      functionName: target.functionName,
      functionQualifier: target.functionQualifier,
      bucketName: target.bucketName,
      partition: Partition,
      region: Region,
      accountId: AccountId,
    });
  }

  await updateConfiguration({
    lambdaArn: target.lambdaArn,
    region: Region,
    functionName: target.functionName,
    previousFunctionName:
      oldTarget && oldTarget.functionName !== target.functionName
        ? oldTarget.functionName
        : undefined,
    bucketName: target.bucketName,
    bucketConfigs: target.bucketConfigs,
  });

  if (oldTarget && oldTarget.bucketName !== target.bucketName) {
    await removeConfiguration({
      region: Region,
      functionName: oldTarget.functionName,
      bucketName: oldTarget.bucketName,
    })
      .catch(ignoreMissingBucket)
      .catch(ignoreDeniedNotificationCleanup);
  }

  if (oldTarget && !sameTarget && !sharesPermissionStatement(target, oldTarget)) {
    await removePermission({
      functionName: oldTarget.functionName,
      functionQualifier: oldTarget.functionQualifier,
      bucketName: oldTarget.bucketName,
      region: Region,
    }).catch(ignoreMissingPermission);
  }
}

async function ensurePermission(config) {
  try {
    await addPermission(config);
  } catch (error) {
    if (!error || ![error.name, error.Code, error.code].includes('ResourceConflictException')) {
      throw error;
    }

    await removePermission(config).catch(ignoreMissingPermission);
    await addPermission(config);
  }
}

async function remove(event, context) {
  const environment = getEnvironment(context);
  const { Region } = environment;
  const target = resolveTarget(event.ResourceProperties, environment);

  return removePermission({
    functionName: target.functionName,
    functionQualifier: target.functionQualifier,
    bucketName: target.bucketName,
    region: Region,
  })
    .catch(ignoreMissingPermission)
    .then(() =>
      removeConfiguration({
        region: Region,
        functionName: target.functionName,
        bucketName: target.bucketName,
      })
        .catch(ignoreMissingBucket)
        .catch(ignoreDeniedNotificationCleanup)
    );
}

function resolveTarget(properties, environment) {
  const { FunctionName, FunctionQualifier, BucketName, BucketConfigs } = properties;

  return {
    functionName: FunctionName,
    functionQualifier: FunctionQualifier,
    bucketName: BucketName,
    bucketConfigs: BucketConfigs,
    lambdaArn: getLambdaArn(
      environment.Partition,
      environment.Region,
      environment.AccountId,
      FunctionName,
      FunctionQualifier
    ),
  };
}

function isSameTarget(target, oldTarget) {
  return (
    oldTarget &&
    target.functionName === oldTarget.functionName &&
    target.functionQualifier === oldTarget.functionQualifier &&
    target.bucketName === oldTarget.bucketName
  );
}

function sharesPermissionStatement(target, oldTarget) {
  return (
    oldTarget &&
    oldTarget.functionName === target.functionName &&
    oldTarget.functionQualifier === target.functionQualifier &&
    getStatementId(oldTarget.functionName, oldTarget.bucketName) ===
      getStatementId(target.functionName, target.bucketName)
  );
}

function ignoreMissingPermission(error) {
  if (error && [error.name, error.Code, error.code].includes('ResourceNotFoundException')) {
    return;
  }
  throw error;
}

function ignoreMissingBucket(error) {
  if (error && [error.name, error.Code, error.code].includes('NoSuchBucket')) {
    return;
  }
  throw error;
}

function ignoreDeniedNotificationCleanup(error) {
  if (error && [error.name, error.Code, error.code].includes('AccessDenied')) {
    // The old bucket may no longer be authorized after the role is recompiled
    // from the current template. Let stack cleanup proceed; this can leave
    // stale notification configuration on that external bucket.
    console.log(
      'Skipping S3 notification cleanup after AccessDenied; stale configuration may remain on the old bucket.'
    );
    return;
  }
  throw error;
}

module.exports = {
  handler: handlerWrapper(handler, 'CustomResourceExistingS3'),
};
