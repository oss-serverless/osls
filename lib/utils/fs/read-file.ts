import { promises as fsp } from 'node:fs';
import parse from './parse.ts';

async function readFile(filePath) {
  return fsp.readFile(filePath, 'utf8').then((contents) => parse(filePath, contents));
}

export default readFile;
