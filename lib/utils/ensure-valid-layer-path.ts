import ServerlessError from '../serverless-error.ts';

const FORBIDDEN_LAYER_PATH_CHARS = /[\0\r\n]/;

export default (layerName, layerPath) => {
  if (typeof layerPath !== 'string') return;
  if (!FORBIDDEN_LAYER_PATH_CHARS.test(layerPath)) return;

  throw new ServerlessError(
    `Invalid "layers.${layerName}.path": must not contain newline, carriage return, or NUL characters`,
    'INVALID_LAYER_PATH'
  );
};
