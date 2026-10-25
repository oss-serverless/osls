'use strict';

const os = require('os');
const path = require('path');

module.exports = (id) => {
  switch (os.platform()) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Caches', id);
    case 'win32':
      return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        id,
        'Cache'
      );
    default:
      return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), id);
  }
};
