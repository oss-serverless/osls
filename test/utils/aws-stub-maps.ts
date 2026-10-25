import isPlainObject from 'type/plain-object/is.js';
import { isUnsafePropertyKey } from '../../lib/utils/object-path.ts';

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isPlainObject(value)) return value;
  return mergeObjects({}, value);
}

function mergeObjects(target, ...sources) {
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (isUnsafePropertyKey(key) || value === undefined) continue;
      if (isPlainObject(value) && isPlainObject(target[key])) {
        mergeObjects(target[key], value);
        continue;
      }
      target[key] = cloneValue(value);
    }
  }
  return target;
}

const getCallerIdentity = (overrides = {}) =>
  mergeObjects(
    {
      ResponseMetadata: { RequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
      UserId: 'XXXXXXXXXXXXXXXXXXXXX',
      Account: '999999999999',
      Arn: 'arn:aws:iam::999999999999:user/test',
    },
    overrides
  );

const createDeployAwsStubMap = (overrides = {}) =>
  mergeObjects(
    {
      STS: { getCallerIdentity: getCallerIdentity() },
      CloudFormation: {
        describeStacks: { Stacks: [{}] },
        describeStackResource: {
          StackResourceDetail: { PhysicalResourceId: 'deployment-bucket' },
        },
      },
      S3: {
        headBucket: {},
        listObjectsV2: { Contents: [] },
        upload: {},
      },
    },
    overrides
  );

export { getCallerIdentity, createDeployAwsStubMap };
export default { getCallerIdentity, createDeployAwsStubMap };
