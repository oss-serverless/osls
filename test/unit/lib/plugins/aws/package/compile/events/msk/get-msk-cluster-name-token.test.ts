import * as chai from 'chai';
import getMskClusterNameToken from '../../../../../../../../../lib/plugins/aws/package/compile/events/msk/get-msk-cluster-name-token.ts';

const { expect } = chai;

describe('getMskClusterNameToken', () => {
  it('with ARN', () => {
    const eventSourceArn =
      'arn:aws:kafka:us-east-1:111111111111:cluster/ClusterName/a1a1a1a1a1a1a1a1a';
    const result = getMskClusterNameToken(eventSourceArn);
    expect(result).to.equal('ClusterName');
  });

  it('with Fn::ImportValue', () => {
    const eventSourceArn = { 'Fn::ImportValue': 'importvalue' };
    const result = getMskClusterNameToken(eventSourceArn);
    expect(result).to.equal('importvalue');
  });

  it('with Ref', () => {
    const eventSourceArn = { Ref: 'ReferencedResource' };
    const result = getMskClusterNameToken(eventSourceArn);
    expect(result).to.equal('ReferencedResource');
  });
});
