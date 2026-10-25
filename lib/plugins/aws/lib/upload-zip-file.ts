'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const log = require('../../../utils/serverless-utils/log').log.get('deploy:upload');
const setS3UploadEncryptionOptions = require('../../../aws/set-s3-upload-encryption-options');
const getHashForFilePath = require('../../../utils/get-hash-for-file-path');
const uploadS3Object = require('./upload-s3-object');

module.exports = {
  async uploadZipFile({ filename, s3KeyDirname, basename }) {
    if (!basename) basename = filename.split(path.sep).pop();

    const fileHash = await getHashForFilePath(filename);
    // The SDK otherwise sizes the stream with lstat, which for a symlink reports the link itself
    const stats = await fsp.stat(filename);

    const artifactStream = fs.createReadStream(filename);
    // As the upload may start consuming the stream asynchronously, an early stream error
    // may crash the process if it is not observed.
    // Below lines prevent that
    let streamError;
    artifactStream.on('error', (error) => (streamError = error));

    const key = `${s3KeyDirname}/${basename}`;
    log.debug('upload to %s/%s', this.bucketName, key);
    let params = {
      Bucket: this.bucketName,
      Key: key,
      Body: artifactStream,
      ContentLength: stats.size,
      ContentType: 'application/zip',
      Metadata: {
        filesha256: fileHash,
      },
    };

    const deploymentBucketObject = this.serverless.service.provider.deploymentBucketObject;
    if (deploymentBucketObject) {
      params = setS3UploadEncryptionOptions(params, deploymentBucketObject);
    }

    const response = await uploadS3Object(this.provider, params);
    // If the stream errors before lib-storage consumes it, the upload may not surface
    // that earlier stream error.
    // Below line ensures that eventual stream error is communicated
    if (streamError) throw streamError;
    return response;
  },
};
