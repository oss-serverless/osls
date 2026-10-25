import jc from 'json-cycle';
import * as yaml from 'js-yaml';
import cloudformationSchema from '../serverless-utils/cloudformation-schema.ts';

function parse(filePath, contents) {
  // Auto-parse JSON
  if (filePath.endsWith('.json') || filePath.endsWith('.tfstate')) {
    return jc.parse(contents);
  } else if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
    return yaml.load(contents.toString(), { filename: filePath, schema: cloudformationSchema });
  }
  return contents.toString().trim();
}

export default parse;
