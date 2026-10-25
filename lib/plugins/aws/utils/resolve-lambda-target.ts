import naming from '../lib/naming.ts';

const resolveLambdaTarget = (functionName, functionObject) => {
  const lambdaLogicalId = naming.getLambdaLogicalId(functionName);
  const functionArnGetter = { 'Fn::GetAtt': [lambdaLogicalId, 'Arn'] };
  if (!functionObject.targetAlias) return functionArnGetter;
  return { 'Fn::Join': [':', [functionArnGetter, functionObject.targetAlias.name]] };
};

export default resolveLambdaTarget;
