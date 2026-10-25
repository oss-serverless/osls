import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'chai';
import { execSync } from '../utils/child-process.ts';
import serverlessExec from '../serverless-binary.ts';
import { copyPathSync, getTmpDirPath } from '../utils/fs.ts';

const fixturePaths = {
  regular: path.join(import.meta.dirname, 'fixtures/regular'),
  individually: path.join(import.meta.dirname, 'fixtures/individually'),
  artifact: path.join(import.meta.dirname, 'fixtures/artifact'),
};

describe('Integration test - Packaging - CloudFormation', () => {
  let cwd;
  beforeEach(() => {
    cwd = getTmpDirPath();
  });

  it('package artifact directive works', () => {
    copyPathSync(fixturePaths.artifact, cwd);
    execSync(`${serverlessExec} package`, { cwd });
    const cfnTemplate = JSON.parse(
      fs.readFileSync(path.join(cwd, '.serverless/cloudformation-template-update-stack.json'))
    );
    expect(cfnTemplate.Resources.HelloLambdaFunction.Properties.Code.S3Key).to.match(
      /serverless\/aws-nodejs\/dev\/[^]*\/artifact.zip/
    );
    delete cfnTemplate.Resources.HelloLambdaFunction.Properties.Code.S3Key;
    expect(cfnTemplate.Resources.HelloLambdaFunction).to.deep.equal({
      Type: 'AWS::Lambda::Function',
      Properties: {
        Code: {
          S3Bucket: {
            Ref: 'ServerlessDeploymentBucket',
          },
        },
        FunctionName: 'aws-nodejs-dev-hello',
        Handler: 'handler.hello',
        MemorySize: 1024,
        Role: {
          'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'],
        },
        Runtime: 'nodejs20.x',
        Timeout: 6,
      },
      DependsOn: ['HelloLogGroup'],
    });
  });

  it('creates the correct default function resource in cfn template', () => {
    copyPathSync(fixturePaths.regular, cwd);
    execSync(`${serverlessExec} package`, { cwd });
    const cfnTemplate = JSON.parse(
      fs.readFileSync(path.join(cwd, '.serverless/cloudformation-template-update-stack.json'))
    );
    expect(cfnTemplate.Resources.HelloLambdaFunction.Properties.Code.S3Key).to.match(
      /serverless\/aws-nodejs\/dev\/[^]*\/aws-nodejs.zip/
    );
    delete cfnTemplate.Resources.HelloLambdaFunction.Properties.Code.S3Key;
    expect(cfnTemplate.Resources.HelloLambdaFunction).to.deep.equal({
      Type: 'AWS::Lambda::Function',
      Properties: {
        Code: {
          S3Bucket: {
            Ref: 'ServerlessDeploymentBucket',
          },
        },
        FunctionName: 'aws-nodejs-dev-hello',
        Handler: 'handler.hello',
        MemorySize: 1024,
        Role: {
          'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'],
        },
        Runtime: 'nodejs20.x',
        Timeout: 6,
      },
      DependsOn: ['HelloLogGroup'],
    });
  });

  it('handles package individually with include/excludes correctly', () => {
    copyPathSync(fixturePaths.individually, cwd);
    execSync(`${serverlessExec} package`, { cwd });
    const cfnTemplate = JSON.parse(
      fs.readFileSync(path.join(cwd, '.serverless/cloudformation-template-update-stack.json'))
    );
    expect(cfnTemplate.Resources.HelloLambdaFunction.Properties.Code.S3Key).to.match(
      /serverless\/aws-nodejs\/dev\/[^]*\/hello.zip/
    );
    expect(cfnTemplate.Resources.Hello2LambdaFunction.Properties.Code.S3Key).to.match(
      /serverless\/aws-nodejs\/dev\/[^]*\/hello2.zip/
    );
    delete cfnTemplate.Resources.HelloLambdaFunction.Properties.Code.S3Key;
    expect(cfnTemplate.Resources.HelloLambdaFunction).to.deep.equal({
      Type: 'AWS::Lambda::Function',
      Properties: {
        Code: {
          S3Bucket: {
            Ref: 'ServerlessDeploymentBucket',
          },
        },
        FunctionName: 'aws-nodejs-dev-hello',
        Handler: 'handler.hello',
        MemorySize: 1024,
        Role: {
          'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'],
        },
        Runtime: 'nodejs20.x',
        Timeout: 6,
      },
      DependsOn: ['HelloLogGroup'],
    });
  });

  it('resolves self.provider.region', () => {
    copyPathSync(fixturePaths.regular, cwd);
    execSync(`${serverlessExec} package`, { cwd });
    const cfnTemplate = JSON.parse(
      fs.readFileSync(path.join(cwd, '.serverless/cloudformation-template-update-stack.json'))
    );
    expect(cfnTemplate.Resources.CustomDashnameLambdaFunction.Properties.FunctionName).to.equal(
      'aws-nodejs-us-east-1-custom-name'
    );
  });
});
