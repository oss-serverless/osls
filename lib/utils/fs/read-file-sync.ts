import fs from 'node:fs';
import parse from './parse.ts';

function readFileSync(filePath) {
  const contents = fs.readFileSync(filePath);
  return parse(filePath, contents);
}

export default readFileSync;
