import { expect } from 'chai';
import resolveLambdaTarget from '../../../../../../lib/plugins/aws/utils/resolve-lambda-target.ts';

describe('#resolveLambdaTarget', () => {
  it('should return a reference to Lambda Arn when provisionnedConcurrency is not set', () => {
    const functionObj = {};
    const functionName = 'foo';
    expect(resolveLambdaTarget(functionName, functionObj)).to.deep.equal({
      'Fn::GetAtt': ['FooLambdaFunction', 'Arn'],
    });
  });

  it('should return a reference to provisioned Alias Arn when provisionnedConcurrency is set', () => {
    const functionObj = { targetAlias: { name: 'provisioned' } };
    const functionName = 'foo';
    expect(resolveLambdaTarget(functionName, functionObj)).to.deep.equal({
      'Fn::Join': [':', [{ 'Fn::GetAtt': ['FooLambdaFunction', 'Arn'] }, 'provisioned']],
    });
  });

  it('should reflect a target alias added after an earlier unqualified resolution', () => {
    const functionObj = {};
    const functionName = 'foo';

    expect(resolveLambdaTarget(functionName, functionObj)).to.deep.equal({
      'Fn::GetAtt': ['FooLambdaFunction', 'Arn'],
    });

    functionObj.targetAlias = { name: 'provisioned' };

    expect(resolveLambdaTarget(functionName, functionObj)).to.deep.equal({
      'Fn::Join': [':', [{ 'Fn::GetAtt': ['FooLambdaFunction', 'Arn'] }, 'provisioned']],
    });
  });
});
