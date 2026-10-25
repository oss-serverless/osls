import { promises as fsp } from 'node:fs';
import path from 'node:path';

export default async (filePath) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const fileHandle = await fsp.open(filePath, 'a');
  try {
    // Opening with 'a' creates the file without truncating existing content.
  } finally {
    await fileHandle.close();
  }
};
