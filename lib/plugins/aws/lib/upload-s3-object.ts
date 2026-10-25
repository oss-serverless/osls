import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createS3UploadError } from '../../../aws/aws-sdk-v3-error.ts';
import retry from '../../../aws/retry.ts';
const { retryOnThrottlingError } = retry;

const uploadQueueSize = 6;
const uploadPartSize = 5 * 1024 * 1024;
const uploadClientPromisesByProvider = new WeakMap();

function getUploadClientPromises(provider) {
  let uploadClientPromises = uploadClientPromisesByProvider.get(provider);

  if (!uploadClientPromises) {
    uploadClientPromises = new Map();
    uploadClientPromisesByProvider.set(provider, uploadClientPromises);
  }

  return uploadClientPromises;
}

async function getS3UploadClient(provider) {
  const useAccelerateEndpoint = provider.isS3TransferAccelerationEnabled();
  const uploadClientPromises = getUploadClientPromises(provider);
  const cacheKey = JSON.stringify({ useAccelerateEndpoint });

  if (!uploadClientPromises.has(cacheKey)) {
    uploadClientPromises.set(
      cacheKey,
      provider.getAwsSdkV3Config({ useAccelerateEndpoint }).then((config) => new S3Client(config))
    );
  }

  return uploadClientPromises.get(cacheKey);
}

export default async (provider, params) => {
  const s3 = await getS3UploadClient(provider);

  const upload = async () => {
    try {
      return await new Upload({
        client: s3,
        params,
        queueSize: uploadQueueSize,
        partSize: uploadPartSize,
        leavePartsOnError: false,
      }).done();
    } catch (error) {
      throw createS3UploadError(error);
    }
  };

  // Stream bodies cannot be replayed once consumed, so only re-runnable bodies get the
  // outer throttling retry; the SDK still retries individual requests either way
  const isReplayableBody = typeof params.Body === 'string' || params.Body instanceof Uint8Array;
  if (!isReplayableBody) return upload();

  return retryOnThrottlingError(upload, { name: `S3 upload of ${params.Key}` });
};
