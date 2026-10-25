import { promises as fsp } from 'node:fs';
import path from 'node:path';
import jc from 'json-cycle';
import * as yaml from 'js-yaml';

async function writeFile(filePath, conts, cycles) {
  let contents = conts || '';

  return fsp.mkdir(path.dirname(filePath), { recursive: true }).then(() => {
    if (filePath.indexOf('.json') !== -1 && typeof contents !== 'string') {
      if (cycles) {
        contents = jc.stringify(contents, null, 2);
      } else {
        contents = JSON.stringify(contents, null, 2);
      }
    }

    const yamlFileExists = filePath.indexOf('.yaml') !== -1;
    const ymlFileExists = filePath.indexOf('.yml') !== -1;

    if ((yamlFileExists || ymlFileExists) && typeof contents !== 'string') {
      contents = yaml.dump(contents);
    }

    return fsp.writeFile(filePath, contents);
  });
}

export default writeFile;
