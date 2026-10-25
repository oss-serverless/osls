'use strict';

module.exports = (cfTemplate, token) =>
  Object.fromEntries(
    Object.entries(cfTemplate.Resources).filter(([resourceKey, resource]) => {
      if (resourceKey === token) return true;
      if (
        resource &&
        resource.Properties &&
        resource.Properties.ApiId &&
        resource.Properties.ApiId.Ref === token
      ) {
        return true;
      }
      if (
        resource &&
        resource.DependsOn &&
        Array.isArray(resource.DependsOn) &&
        resource.DependsOn.includes(token)
      ) {
        return true;
      }
      return false;
    })
  );
