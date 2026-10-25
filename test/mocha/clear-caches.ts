import ensureArtifact from '../../lib/utils/ensure-artifact.ts';
import resolveInput from '../../lib/cli/resolve-input.ts';
import customResources from '../../lib/plugins/aws/custom-resources/index.ts';

export default () => {
  if (typeof ensureArtifact.clear === 'function') ensureArtifact.clear();
  if (typeof resolveInput.clear === 'function') resolveInput.clear();
  if (typeof customResources.clearArtifactCopyCache === 'function') {
    customResources.clearArtifactCopyCache();
  }
};
