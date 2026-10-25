import path from 'node:path';
import { assertFileRefAllowed } from './file-ref-policy.ts';
import { readHttpRef } from './http-ref-reader.ts';

let refParserModulePromise;

const getRefParserModule = () => {
  if (!refParserModulePromise) {
    refParserModulePromise = import('@apidevtools/json-schema-ref-parser');
  }

  return refParserModulePromise;
};

const getFileExtension = (documentUrl) => {
  try {
    return path.extname(new URL(documentUrl).pathname).toLowerCase();
  } catch {
    return path.extname(documentUrl).toLowerCase();
  }
};

const getFileInfo = (documentUrl) => ({
  url: documentUrl,
  extension: getFileExtension(documentUrl),
  hash: '',
});

const readExternalDocument = async (documentUrl, externalRefs) => {
  const { FileResolver, HTTPResolver } = await getRefParserModule();
  const fileInfo = getFileInfo(documentUrl);

  if (FileResolver.canRead(fileInfo)) {
    await assertFileRefAllowed(documentUrl, externalRefs.file);
    return FileResolver.read(fileInfo);
  }

  const httpResolver = { ...HTTPResolver, safeUrlResolver: false };

  if (httpResolver.canRead(fileInfo)) {
    return readHttpRef(documentUrl, fileInfo, HTTPResolver, externalRefs.http);
  }

  throw new Error(`Unsupported $ref protocol: ${documentUrl}`);
};

export { readExternalDocument };

export default {
  readExternalDocument,
};
