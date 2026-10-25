'use strict';

const resolveRegion = ({ configuration, options }) => {
  return (
    options.region ||
    (configuration && configuration.provider && configuration.provider.region) ||
    'us-east-1'
  );
};

module.exports = resolveRegion;
