'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { Readable, Writable } = require('node:stream');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const chai = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const AwsProvider = require('../../../../../../../lib/plugins/aws/provider');
const AwsCompileFunctions = require('../../../../../../../lib/plugins/aws/package/compile/functions');
const Serverless = require('../../../../../../../lib/serverless');
const runServerless = require('../../../../../../utils/run-serverless');
const setupProgrammaticFixture = require('../../../../../../utils/setup-programmatic-fixture');
const { createDeployAwsStubMap } = require('../../../../../../utils/aws-stub-maps');

const { getTmpDirPath, createTmpFile } = require('../../../../../../utils/fs');

const expect = chai.expect;

describe('AwsCompileFunctions', () => {
  let serverless;
  let awsProvider;
  let awsCompileFunctions;
  const functionName = 'test';
  const compiledFunctionName = 'TestLambdaFunction';

  // Direct setup is intentional because these sections exercise AwsCompileFunctions internals.
  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
      commands: [],
      options: {},
    };
    serverless = new Serverless(options);
    awsProvider = new AwsProvider(serverless, options);
    serverless.setProvider('aws', awsProvider);
    serverless.service.provider.name = 'aws';
    serverless.cli = new serverless.classes.CLI();
    awsCompileFunctions = new AwsCompileFunctions(serverless, options);
    awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate = {
      Resources: {},
      Outputs: {},
    };

    const serviceArtifact = 'new-service.zip';
    const individualArtifact = 'test.zip';
    awsCompileFunctions.packagePath = getTmpDirPath();
    // The contents of the test artifacts need to be predictable so the hashes stay the same
    serverless.utils.writeFileSync(
      path.join(awsCompileFunctions.packagePath, serviceArtifact),
      'foobar'
    );
    serverless.utils.writeFileSync(
      path.join(awsCompileFunctions.packagePath, individualArtifact),
      'barbaz'
    );

    awsCompileFunctions.serverless.service.service = 'new-service';
    awsCompileFunctions.serverless.service.package.artifactDirectoryName = 'somedir';
    awsCompileFunctions.serverless.service.package.artifact = path.join(
      awsCompileFunctions.packagePath,
      serviceArtifact
    );
    awsCompileFunctions.serverless.service.functions = {};
    awsCompileFunctions.serverless.service.functions[functionName] = {
      name: 'test',
      package: {
        artifact: path.join(awsCompileFunctions.packagePath, individualArtifact),
      },
      handler: 'handler.hello',
    };
  });

  describe('#downloadPackageArtifacts()', () => {
    let sendStub;
    let testFilePath;
    const s3BucketName = 'test-bucket';
    const s3ArtifactName = 's3-hosted-artifact.zip';
    const downloadedArtifactContent = 'downloaded artifact content';

    beforeEach(() => {
      testFilePath = createTmpFile('dummy-artifact');
      fs.writeFileSync(testFilePath, downloadedArtifactContent);
      sendStub = sinon.stub(S3Client.prototype, 'send').resolves({
        Body: fs.createReadStream(testFilePath),
      });
    });

    afterEach(() => {
      S3Client.prototype.send.restore();
      if (fs.createWriteStream.restore) fs.createWriteStream.restore();
      if (fsp.unlink.restore) fsp.unlink.restore();
    });

    function createAwsCompileFunctionsWithS3ClientStub({ onSend } = {}) {
      const s3Clients = [];
      class FakeGetObjectCommand {
        constructor(input) {
          this.input = input;
        }
      }
      class FakeS3Client {
        constructor(config) {
          this.config = config;
          s3Clients.push(this);
        }

        async send(command) {
          if (onSend) return onSend({ command, client: this, FakeGetObjectCommand });
          return undefined;
        }
      }
      const AwsCompileFunctionsWithClientStub = proxyquire(
        '../../../../../../../lib/plugins/aws/package/compile/functions',
        {
          '@aws-sdk/client-s3': {
            S3Client: FakeS3Client,
            GetObjectCommand: FakeGetObjectCommand,
          },
        }
      );

      return { AwsCompileFunctionsWithClientStub, FakeGetObjectCommand, s3Clients };
    }

    it('should download the file and replace the artifact path for function packages', async () => {
      awsCompileFunctions.serverless.service.package.individually = true;
      awsCompileFunctions.serverless.service.functions[functionName].package.artifact =
        `https://s3.amazonaws.com/${s3BucketName}/${s3ArtifactName}`;

      return expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.fulfilled.then(() => {
        const artifactFilePath =
          awsCompileFunctions.serverless.service.functions[functionName].package.artifact;
        const artifactFileName = artifactFilePath.split(path.sep).pop();

        expect(sendStub.callCount).to.equal(1);
        expect(sendStub.firstCall.args[0]).to.be.instanceOf(GetObjectCommand);
        expect(sendStub.firstCall.args[0].input).to.deep.equal({
          Bucket: s3BucketName,
          Key: s3ArtifactName,
        });
        expect(artifactFileName).to.equal(s3ArtifactName);
        return expect(fsp.readFile(artifactFilePath, 'utf8')).to.eventually.equal(
          downloadedArtifactContent
        );
      });
    });

    it('should download the file and replace the artifact path for service-wide packages', async () => {
      awsCompileFunctions.serverless.service.package.individually = false;
      awsCompileFunctions.serverless.service.functions[functionName].package.artifact = false;
      awsCompileFunctions.serverless.service.package.artifact = `https://s3.amazonaws.com/${s3BucketName}/${s3ArtifactName}`;

      return expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.fulfilled.then(() => {
        const artifactFilePath = awsCompileFunctions.serverless.service.package.artifact;
        const artifactFileName = artifactFilePath.split(path.sep).pop();

        expect(sendStub.callCount).to.equal(1);
        expect(sendStub.firstCall.args[0]).to.be.instanceOf(GetObjectCommand);
        expect(sendStub.firstCall.args[0].input).to.deep.equal({
          Bucket: s3BucketName,
          Key: s3ArtifactName,
        });
        expect(artifactFileName).to.equal(s3ArtifactName);
        return expect(fsp.readFile(artifactFilePath, 'utf8')).to.eventually.equal(
          downloadedArtifactContent
        );
      });
    });

    it('should strip query parameters when downloading presigned S3 artifact URLs', async () => {
      awsCompileFunctions.serverless.service.package.individually = true;
      awsCompileFunctions.serverless.service.functions[functionName].package.artifact =
        `https://s3.amazonaws.com/${s3BucketName}/path/to/${s3ArtifactName}?X-Amz-Signature=secret`;

      await expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.fulfilled;

      const artifactFilePath =
        awsCompileFunctions.serverless.service.functions[functionName].package.artifact;

      expect(sendStub.callCount).to.equal(1);
      expect(sendStub.firstCall.args[0]).to.be.instanceOf(GetObjectCommand);
      expect(sendStub.firstCall.args[0].input).to.deep.equal({
        Bucket: s3BucketName,
        Key: `path/to/${s3ArtifactName}`,
      });
      expect(path.basename(artifactFilePath)).to.equal(s3ArtifactName);
      expect(artifactFilePath).to.not.include('?');
      expect(artifactFilePath).to.not.include('X-Amz');
    });

    it('should not access S3 if URL is not an S3 URL', async () => {
      awsCompileFunctions.serverless.service.functions[functionName].package.artifact =
        'https://s33amazonaws.com/this/that';
      return expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.fulfilled.then(() => {
        expect(sendStub).to.not.have.been.called;
      });
    });

    it('reuses S3 clients across repeated remote package artifact downloads in the same region', async () => {
      const { AwsCompileFunctionsWithClientStub, s3Clients } =
        createAwsCompileFunctionsWithS3ClientStub({
          onSend: async ({ command, FakeGetObjectCommand }) => {
            expect(command).to.be.instanceOf(FakeGetObjectCommand);
            return { Body: fs.createReadStream(testFilePath) };
          },
        });
      const compileFunctions = new AwsCompileFunctionsWithClientStub(serverless, {
        stage: 'dev',
        region: 'us-east-1',
      });
      compileFunctions.serverless.service.functions = {
        first: {
          handler: 'handler.first',
          package: {
            artifact: `https://s3.amazonaws.com/${s3BucketName}/first.zip`,
          },
        },
        second: {
          handler: 'handler.second',
          package: {
            artifact: `https://s3.amazonaws.com/${s3BucketName}/second.zip`,
          },
        },
      };

      await compileFunctions.downloadPackageArtifacts();

      expect(s3Clients).to.have.length(1);
    });

    it('uses distinct S3 clients for distinct explicit remote artifact regions', async () => {
      const { AwsCompileFunctionsWithClientStub, s3Clients } =
        createAwsCompileFunctionsWithS3ClientStub();
      const compileFunctions = new AwsCompileFunctionsWithClientStub(serverless, {
        stage: 'dev',
        region: 'eu-west-1',
      });

      await compileFunctions.getS3Client('eu-west-1');
      await compileFunctions.getS3Client('us-east-1');

      expect(s3Clients).to.have.length(2);
      expect(s3Clients[0].config.region).to.equal('eu-west-1');
      expect(s3Clients[1].config.region).to.equal('us-east-1');
    });

    it('should reject if the downloaded artifact stream errors', async () => {
      const streamError = new Error('stream failed');
      const errorStream = new Readable({
        read() {
          this.destroy(streamError);
        },
      });
      sendStub.resolves({
        Body: errorStream,
      });
      awsCompileFunctions.serverless.service.package.individually = true;
      awsCompileFunctions.serverless.service.functions[functionName].package.artifact =
        `https://s3.amazonaws.com/${s3BucketName}/${s3ArtifactName}`;
      const originalArtifact =
        awsCompileFunctions.serverless.service.functions[functionName].package.artifact;

      await expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.rejectedWith(streamError);
      expect(
        awsCompileFunctions.serverless.service.functions[functionName].package.artifact
      ).to.equal(originalArtifact);
    });

    function setRemoteFunctionArtifact() {
      awsCompileFunctions.serverless.service.package.individually = true;
      awsCompileFunctions.serverless.service.functions[functionName].package.artifact =
        `https://s3.amazonaws.com/${s3BucketName}/${s3ArtifactName}`;
      return awsCompileFunctions.serverless.service.functions[functionName].package.artifact;
    }

    it('should reject and preserve artifact path when S3 getObject fails', async () => {
      const error = new Error('getObject failed');
      sendStub.rejects(error);
      const originalArtifact = setRemoteFunctionArtifact();

      await expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.rejectedWith(error);
      expect(
        awsCompileFunctions.serverless.service.functions[functionName].package.artifact
      ).to.equal(originalArtifact);
    });

    it('should reject and preserve artifact path when S3 getObject returns no body', async () => {
      sendStub.resolves({});
      const originalArtifact = setRemoteFunctionArtifact();

      await expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.rejected;
      expect(
        awsCompileFunctions.serverless.service.functions[functionName].package.artifact
      ).to.equal(originalArtifact);
    });

    it('should reject and preserve artifact path when writing downloaded artifact fails', async () => {
      const writeError = new Error('write failed');
      sinon.stub(fs, 'createWriteStream').returns(
        new Writable({
          write(chunk, encoding, callback) {
            callback(writeError);
          },
        })
      );
      const originalArtifact = setRemoteFunctionArtifact();

      await expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.rejectedWith(writeError);
      expect(
        awsCompileFunctions.serverless.service.functions[functionName].package.artifact
      ).to.equal(originalArtifact);
    });

    it('should remove the partial temp file when a remote artifact download fails', async () => {
      const streamError = new Error('stream failed');
      sendStub.resolves({
        Body: new Readable({
          read() {
            this.destroy(streamError);
          },
        }),
      });
      const unlinkSpy = sinon.spy(fsp, 'unlink');
      setRemoteFunctionArtifact();

      await expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.rejectedWith(streamError);

      expect(unlinkSpy).to.have.been.calledOnce;
      const removedPath = unlinkSpy.firstCall.args[0];
      expect(path.basename(removedPath)).to.equal(s3ArtifactName);
      expect(fs.existsSync(removedPath)).to.equal(false);
    });

    it('should ignore a missing temp file during cleanup and reject with the original error', async () => {
      const streamError = new Error('stream failed');
      sendStub.resolves({
        Body: new Readable({
          read() {
            this.destroy(streamError);
          },
        }),
      });
      const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
      sinon.stub(fsp, 'unlink').rejects(enoent);
      setRemoteFunctionArtifact();

      await expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.rejectedWith(streamError);
    });

    it('should reject with the original error even when temp file cleanup fails', async () => {
      const streamError = new Error('stream failed');
      sendStub.resolves({
        Body: new Readable({
          read() {
            this.destroy(streamError);
          },
        }),
      });
      const cleanupError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      sinon.stub(fsp, 'unlink').rejects(cleanupError);
      setRemoteFunctionArtifact();

      await expect(awsCompileFunctions.downloadPackageArtifacts()).to.be.rejectedWith(streamError);
    });
  });

  describe('#compileFunctions()', () => {
    it('should use function artifact if individually', async () => {
      awsCompileFunctions.serverless.service.package.individually = true;

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        const functionResource =
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources[
            compiledFunctionName
          ];

        const s3Folder = awsCompileFunctions.serverless.service.package.artifactDirectoryName;
        const s3FileName = awsCompileFunctions.serverless.service.functions[
          functionName
        ].package.artifact
          .split(path.sep)
          .pop();

        expect(functionResource.Properties.Code.S3Key).to.deep.equal(`${s3Folder}/${s3FileName}`);
      });
    });

    it('should add an ARN function role', async () => {
      awsCompileFunctions.serverless.service.provider.name = 'aws';
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          role: 'arn:aws:xxx:*:*',
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.DependsOn
        ).to.deep.equal(['FuncLogGroup']);
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.Properties.Role
        ).to.deep.equal(awsCompileFunctions.serverless.service.functions.func.role);
      });
    });

    it('should honour provider.iam.role option when set', async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          disabledDeprecations: ['PROVIDER_IAM_SETTINGS_V3'],
          provider: {
            role: 'role-a',
            iam: { role: 'role-b' },
          },
        },
        command: 'package',
      });

      expect(cfTemplate.Resources.BasicLambdaFunction.Properties.Role).to.eql({
        'Fn::GetAtt': ['role-b', 'Arn'],
      });
    });

    it('should add a logical role name function role', async () => {
      awsCompileFunctions.serverless.service.provider.name = 'aws';
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          role: 'LogicalRoleName',
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.DependsOn
        ).to.deep.equal(['FuncLogGroup', 'LogicalRoleName']);
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.Properties.Role
        ).to.deep.equal({
          'Fn::GetAtt': [awsCompileFunctions.serverless.service.functions.func.role, 'Arn'],
        });
      });
    });

    it('should add a "Fn::GetAtt" Object function role', async () => {
      awsCompileFunctions.serverless.service.provider.name = 'aws';
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          role: {
            'Fn::GetAtt': ['LogicalRoleName', 'Arn'],
          },
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.DependsOn
        ).to.deep.equal(['FuncLogGroup', 'LogicalRoleName']);
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.Properties.Role
        ).to.deep.equal(awsCompileFunctions.serverless.service.functions.func.role);
      });
    });

    it('should add a "Fn::ImportValue" Object function role', async () => {
      awsCompileFunctions.serverless.service.provider.name = 'aws';
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          role: {
            'Fn::ImportValue': 'Foo',
          },
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.DependsOn
        ).to.deep.equal(['FuncLogGroup']);
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.Properties.Role
        ).to.deep.equal(awsCompileFunctions.serverless.service.functions.func.role);
      });
    });

    it('should add function declared roles', async () => {
      awsCompileFunctions.serverless.service.provider.name = 'aws';
      awsCompileFunctions.serverless.service.functions = {
        func0: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func0',
          role: 'arn:aws:xx0:*:*',
        },
        func1: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func1',
          role: 'arn:aws:xx1:*:*',
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .Func0LambdaFunction.DependsOn
        ).to.deep.equal(['Func0LogGroup']);
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .Func0LambdaFunction.Properties.Role
        ).to.deep.equal(awsCompileFunctions.serverless.service.functions.func0.role);

        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .Func1LambdaFunction.DependsOn
        ).to.deep.equal(['Func1LogGroup']);
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .Func1LambdaFunction.Properties.Role
        ).to.deep.equal(awsCompileFunctions.serverless.service.functions.func1.role);
      });
    });

    it('should create a simple function resource', async () => {
      const s3Folder = awsCompileFunctions.serverless.service.package.artifactDirectoryName;
      const s3FileName = awsCompileFunctions.serverless.service.package.artifact
        .split(path.sep)
        .pop();
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
        },
      };
      const compiledFunction = {
        Type: 'AWS::Lambda::Function',
        DependsOn: ['FuncLogGroup'],
        Properties: {
          Code: {
            S3Key: `${s3Folder}/${s3FileName}`,
            S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
          },
          FunctionName: 'new-service-dev-func',
          Handler: 'func.function.handler',
          MemorySize: 1024,
          Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
          Runtime: 'nodejs24.x',
          Timeout: 6,
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction
        ).to.deep.equal(compiledFunction);
      });
    });

    describe('when using onError config', () => {
      let s3Folder;
      let s3FileName;

      beforeEach(() => {
        s3Folder = awsCompileFunctions.serverless.service.package.artifactDirectoryName;
        s3FileName = awsCompileFunctions.serverless.service.package.artifact.split(path.sep).pop();
      });

      describe('when IamRoleLambdaExecution is used', () => {
        beforeEach(() => {
          // pretend that the IamRoleLambdaExecution is used
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources.IamRoleLambdaExecution =
            {
              Properties: {
                Policies: [
                  {
                    PolicyDocument: {
                      Statement: [],
                    },
                  },
                ],
              },
            };
        });

        it('should create necessary resources if a SNS arn is provided', async () => {
          awsCompileFunctions.serverless.service.functions = {
            func: {
              handler: 'func.function.handler',
              name: 'new-service-dev-func',
              onError: 'arn:aws:sns:region:accountid:foo',
            },
          };

          const compiledFunction = {
            Type: 'AWS::Lambda::Function',
            DependsOn: ['FuncLogGroup'],
            Properties: {
              Code: {
                S3Key: `${s3Folder}/${s3FileName}`,
                S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
              },
              FunctionName: 'new-service-dev-func',
              Handler: 'func.function.handler',
              MemorySize: 1024,
              Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
              Runtime: 'nodejs24.x',
              Timeout: 6,
              DeadLetterConfig: {
                TargetArn: 'arn:aws:sns:region:accountid:foo',
              },
            },
          };

          const compiledDlqStatement = {
            Effect: 'Allow',
            Action: ['sns:Publish'],
            Resource: ['arn:aws:sns:region:accountid:foo'],
          };

          return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
            const compiledCfTemplate =
              awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate;

            const functionResource = compiledCfTemplate.Resources.FuncLambdaFunction;
            const dlqStatement =
              compiledCfTemplate.Resources.IamRoleLambdaExecution.Properties.Policies[0]
                .PolicyDocument.Statement[0];

            expect(functionResource).to.deep.equal(compiledFunction);
            expect(dlqStatement).to.deep.equal(compiledDlqStatement);
          });
        });

        it('should create necessary resources if a Ref is provided', async () => {
          awsCompileFunctions.serverless.service.functions = {
            func: {
              handler: 'func.function.handler',
              name: 'new-service-dev-func',
              onError: {
                Ref: 'DLQ',
              },
            },
          };

          const compiledFunction = {
            Type: 'AWS::Lambda::Function',
            DependsOn: ['FuncLogGroup'],
            Properties: {
              Code: {
                S3Key: `${s3Folder}/${s3FileName}`,
                S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
              },
              FunctionName: 'new-service-dev-func',
              Handler: 'func.function.handler',
              MemorySize: 1024,
              Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
              Runtime: 'nodejs24.x',
              Timeout: 6,
              DeadLetterConfig: {
                TargetArn: {
                  Ref: 'DLQ',
                },
              },
            },
          };

          return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
            const compiledCfTemplate =
              awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate;

            const functionResource = compiledCfTemplate.Resources.FuncLambdaFunction;
            expect(functionResource).to.deep.equal(compiledFunction);
          });
        });

        it('should create necessary resources if a Fn::ImportValue is provided', async () => {
          awsCompileFunctions.serverless.service.functions = {
            func: {
              handler: 'func.function.handler',
              name: 'new-service-dev-func',
              onError: {
                'Fn::ImportValue': 'DLQ',
              },
            },
          };

          const compiledFunction = {
            Type: 'AWS::Lambda::Function',
            DependsOn: ['FuncLogGroup'],
            Properties: {
              Code: {
                S3Key: `${s3Folder}/${s3FileName}`,
                S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
              },
              FunctionName: 'new-service-dev-func',
              Handler: 'func.function.handler',
              MemorySize: 1024,
              Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
              Runtime: 'nodejs24.x',
              Timeout: 6,
              DeadLetterConfig: {
                TargetArn: {
                  'Fn::ImportValue': 'DLQ',
                },
              },
            },
          };

          return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
            const compiledCfTemplate =
              awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate;

            const functionResource = compiledCfTemplate.Resources.FuncLambdaFunction;
            expect(functionResource).to.deep.equal(compiledFunction);
          });
        });

        it('should create necessary resources if a Fn::GetAtt is provided', async () => {
          awsCompileFunctions.serverless.service.functions = {
            func: {
              handler: 'func.function.handler',
              name: 'new-service-dev-func',
              onError: {
                'Fn::GetAtt': ['DLQ', 'Arn'],
              },
            },
          };

          const compiledFunction = {
            Type: 'AWS::Lambda::Function',
            DependsOn: ['FuncLogGroup'],
            Properties: {
              Code: {
                S3Key: `${s3Folder}/${s3FileName}`,
                S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
              },
              FunctionName: 'new-service-dev-func',
              Handler: 'func.function.handler',
              MemorySize: 1024,
              Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
              Runtime: 'nodejs24.x',
              Timeout: 6,
              DeadLetterConfig: {
                TargetArn: {
                  'Fn::GetAtt': ['DLQ', 'Arn'],
                },
              },
            },
          };

          return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
            const compiledCfTemplate =
              awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate;

            const functionResource = compiledCfTemplate.Resources.FuncLambdaFunction;
            expect(functionResource).to.deep.equal(compiledFunction);
          });
        });
      });

      describe('when IamRoleLambdaExecution is not used', () => {
        it('should create necessary function resources if a SNS arn is provided', async () => {
          awsCompileFunctions.serverless.service.functions = {
            func: {
              handler: 'func.function.handler',
              name: 'new-service-dev-func',
              onError: 'arn:aws:sns:region:accountid:foo',
            },
          };

          const compiledFunction = {
            Type: 'AWS::Lambda::Function',
            DependsOn: ['FuncLogGroup'],
            Properties: {
              Code: {
                S3Key: `${s3Folder}/${s3FileName}`,
                S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
              },
              FunctionName: 'new-service-dev-func',
              Handler: 'func.function.handler',
              MemorySize: 1024,
              Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
              Runtime: 'nodejs24.x',
              Timeout: 6,
              DeadLetterConfig: {
                TargetArn: 'arn:aws:sns:region:accountid:foo',
              },
            },
          };

          return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
            const compiledCfTemplate =
              awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate;

            const functionResource = compiledCfTemplate.Resources.FuncLambdaFunction;

            expect(functionResource).to.deep.equal(compiledFunction);
          });
        });
      });
    });

    describe('when using tracing config', () => {
      let s3Folder;
      let s3FileName;

      beforeEach(() => {
        s3Folder = awsCompileFunctions.serverless.service.package.artifactDirectoryName;
        s3FileName = awsCompileFunctions.serverless.service.package.artifact.split(path.sep).pop();
      });

      describe('when IamRoleLambdaExecution is used', () => {
        beforeEach(() => {
          // pretend that the IamRoleLambdaExecution is used
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources.IamRoleLambdaExecution =
            {
              Properties: {
                Policies: [
                  {
                    PolicyDocument: {
                      Statement: [],
                    },
                  },
                ],
              },
            };
        });

        it('should create necessary resources if a tracing config is provided', async () => {
          awsCompileFunctions.serverless.service.functions = {
            func: {
              handler: 'func.function.handler',
              name: 'new-service-dev-func',
              tracing: 'Active',
            },
          };

          const compiledFunction = {
            Type: 'AWS::Lambda::Function',
            DependsOn: ['FuncLogGroup'],
            Properties: {
              Code: {
                S3Key: `${s3Folder}/${s3FileName}`,
                S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
              },
              FunctionName: 'new-service-dev-func',
              Handler: 'func.function.handler',
              MemorySize: 1024,
              Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
              Runtime: 'nodejs24.x',
              Timeout: 6,
              TracingConfig: {
                Mode: 'Active',
              },
            },
          };

          const compiledXrayStatement = {
            Effect: 'Allow',
            Action: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
            Resource: ['*'],
          };

          return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
            const compiledCfTemplate =
              awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate;

            const functionResource = compiledCfTemplate.Resources.FuncLambdaFunction;
            const xrayStatement =
              compiledCfTemplate.Resources.IamRoleLambdaExecution.Properties.Policies[0]
                .PolicyDocument.Statement[0];

            expect(functionResource).to.deep.equal(compiledFunction);
            expect(xrayStatement).to.deep.equal(compiledXrayStatement);
          });
        });
      });
    });

    it('should create a function resource with function level environment config', async () => {
      const s3Folder = awsCompileFunctions.serverless.service.package.artifactDirectoryName;
      const s3FileName = awsCompileFunctions.serverless.service.package.artifact
        .split(path.sep)
        .pop();
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          environment: {
            test1: 'test1',
          },
        },
      };

      const compiledFunction = {
        Type: 'AWS::Lambda::Function',
        DependsOn: ['FuncLogGroup'],
        Properties: {
          Code: {
            S3Key: `${s3Folder}/${s3FileName}`,
            S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
          },
          FunctionName: 'new-service-dev-func',
          Handler: 'func.function.handler',
          MemorySize: 1024,
          Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
          Runtime: 'nodejs24.x',
          Timeout: 6,
          Environment: {
            Variables: {
              test1: 'test1',
            },
          },
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction
        ).to.deep.equal(compiledFunction);
      });
    });

    it('should accept an environment variable with CF ref and functions', async () => {
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          environment: {
            counter: {
              Ref: 'TestVariable',
            },
            list: {
              'Fn::Join:': [', ', ['a', 'b', 'c']],
            },
          },
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.Properties.Environment.Variables.counter
        ).to.eql({ Ref: 'TestVariable' });
      });
    });

    it('should preserve unsafe environment variable names as own data properties', async () => {
      awsCompileFunctions.serverless.service.provider.environment = JSON.parse(
        '{"__proto__":{"Ref":"UnsafeProviderEnv"}}'
      );
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          environment: JSON.parse('{"constructor":{"Ref":"UnsafeFunctionEnv"}}'),
        },
      };

      await awsCompileFunctions.compileFunctions();

      const variables =
        awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .FuncLambdaFunction.Properties.Environment.Variables;

      expect(Object.getPrototypeOf(variables)).to.equal(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(variables, '__proto__').value).to.deep.equal({
        Ref: 'UnsafeProviderEnv',
      });
      expect(Object.getOwnPropertyDescriptor(variables, 'constructor').value).to.deep.equal({
        Ref: 'UnsafeFunctionEnv',
      });
    });

    it('should preserve unsafe tag names as own data properties before rendering tag arrays', async () => {
      awsCompileFunctions.serverless.service.provider.tags = JSON.parse(
        '{"__proto__":"provider-tag"}'
      );
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          tags: JSON.parse('{"constructor":"function-tag"}'),
        },
      };

      await awsCompileFunctions.compileFunctions();

      const tags =
        awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .FuncLambdaFunction.Properties.Tags;

      expect(tags).to.deep.include.members([
        { Key: '__proto__', Value: 'provider-tag' },
        { Key: 'constructor', Value: 'function-tag' },
      ]);
    });

    it('should consider function based config when creating a function resource', async () => {
      const s3Folder = awsCompileFunctions.serverless.service.package.artifactDirectoryName;
      const s3FileName = awsCompileFunctions.serverless.service.package.artifact
        .split(path.sep)
        .pop();
      awsCompileFunctions.serverless.service.functions = {
        func: {
          name: 'customized-func-function',
          handler: 'func.function.handler',
          memorySize: 128,
          timeout: 10,
        },
      };
      const compiledFunction = {
        Type: 'AWS::Lambda::Function',
        DependsOn: ['FuncLogGroup'],
        Properties: {
          Code: {
            S3Key: `${s3Folder}/${s3FileName}`,
            S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
          },
          FunctionName: 'customized-func-function',
          Handler: 'func.function.handler',
          MemorySize: 128,
          Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
          Runtime: 'nodejs24.x',
          Timeout: 10,
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction
        ).to.deep.equal(compiledFunction);
      });
    });

    it('should include description if specified', async () => {
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          description: 'Lambda function description',
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.Properties.Description
        ).to.equal('Lambda function description');
      });
    });

    it('should create corresponding function output and version objects', async () => {
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
        },
        anotherFunc: {
          handler: 'anotherFunc.function.handler',
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Outputs
            .FuncLambdaFunctionQualifiedArn
        ).to.exist;
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Outputs
            .AnotherFuncLambdaFunctionQualifiedArn
        ).to.exist;
      });
    });

    it('should include description under version too if function is specified', async () => {
      const lambdaDescription = 'Lambda function description';
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          description: lambdaDescription,
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        let versionDescription;
        for (const [key, value] of Object.entries(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
        )) {
          if (key.startsWith('FuncLambdaVersion')) {
            versionDescription = value.Properties.Description;
            break;
          }
        }
        return expect(versionDescription).to.equal(lambdaDescription);
      });
    });

    it('should set function declared reserved concurrency limit', async () => {
      const s3Folder = awsCompileFunctions.serverless.service.package.artifactDirectoryName;
      const s3FileName = awsCompileFunctions.serverless.service.package.artifact
        .split(path.sep)
        .pop();
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          reservedConcurrency: 5,
        },
      };
      const compiledFunction = {
        Type: 'AWS::Lambda::Function',
        DependsOn: ['FuncLogGroup'],
        Properties: {
          Code: {
            S3Key: `${s3Folder}/${s3FileName}`,
            S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
          },
          FunctionName: 'new-service-dev-func',
          Handler: 'func.function.handler',
          MemorySize: 1024,
          ReservedConcurrentExecutions: 5,
          Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
          Runtime: 'nodejs24.x',
          Timeout: 6,
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction
        ).to.deep.equal(compiledFunction);
      });
    });

    it('should set function declared provisioned concurrency limit', async () => {
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          provisionedConcurrency: 5,
          versionFunction: false,
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncProvConcLambdaAlias.Properties.ProvisionedConcurrencyConfig
        ).to.deep.equal({ ProvisionedConcurrentExecutions: 5 });
      });
    });

    it('should set function declared reserved concurrency limit even if it is zero', async () => {
      const s3Folder = awsCompileFunctions.serverless.service.package.artifactDirectoryName;
      const s3FileName = awsCompileFunctions.serverless.service.package.artifact
        .split(path.sep)
        .pop();
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          reservedConcurrency: 0,
        },
      };
      const compiledFunction = {
        Type: 'AWS::Lambda::Function',
        DependsOn: ['FuncLogGroup'],
        Properties: {
          Code: {
            S3Key: `${s3Folder}/${s3FileName}`,
            S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
          },
          FunctionName: 'new-service-dev-func',
          Handler: 'func.function.handler',
          MemorySize: 1024,
          ReservedConcurrentExecutions: 0,
          Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
          Runtime: 'nodejs24.x',
          Timeout: 6,
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction
        ).to.deep.equal(compiledFunction);
      });
    });

    it('should set function SnapStart ApplyOn to PublishedVersions when enabled', async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              snapStart: true,
            },
          },
        },
        command: 'package',
      });

      expect(cfTemplate.Resources.BasicLambdaFunction.Properties.SnapStart).to.deep.equal({
        ApplyOn: 'PublishedVersions',
      });
    });

    it('should not configure function SnapStart ApplyOn when disabled', async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              snapStart: false,
            },
          },
        },
        command: 'package',
      });

      expect(cfTemplate.Resources.BasicLambdaFunction.Properties).to.not.have.property('SnapStart');
    });

    it('should set function DurableConfig when configured', async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              versionFunction: false,
              durableConfig: {
                executionTimeout: 3600,
                retentionPeriodInDays: 30,
              },
            },
          },
        },
        command: 'package',
      });

      expect(cfTemplate.Resources.BasicLambdaFunction.Properties.DurableConfig).to.deep.equal({
        ExecutionTimeout: 3600,
        RetentionPeriodInDays: 30,
      });
      expect(cfTemplate.Outputs).to.have.property(
        awsNaming.getLambdaVersionOutputLogicalId('basic')
      );

      const versionOutput = cfTemplate.Outputs[awsNaming.getLambdaVersionOutputLogicalId('basic')];
      expect(cfTemplate.Resources[awsNaming.getLambdaDurableAliasLogicalId('basic')]).to.deep.equal(
        {
          Type: 'AWS::Lambda::Alias',
          Properties: {
            FunctionName: { Ref: awsNaming.getLambdaLogicalId('basic') },
            FunctionVersion: { 'Fn::GetAtt': [versionOutput.Value.Ref, 'Version'] },
            Name: awsNaming.getLambdaDurableAliasName(),
          },
          DependsOn: awsNaming.getLambdaLogicalId('basic'),
        }
      );
    });

    it('should set function DurableConfig with only executionTimeout', async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              durableConfig: {
                executionTimeout: 7200,
              },
            },
          },
        },
        command: 'package',
      });

      expect(cfTemplate.Resources.BasicLambdaFunction.Properties.DurableConfig).to.deep.equal({
        ExecutionTimeout: 7200,
      });
    });

    it('should support durableConfig with container images', async () => {
      const imageUri =
        '000000000000.dkr.ecr.us-east-1.amazonaws.com/test@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            imageDurable: {
              image: imageUri,
              durableConfig: {
                executionTimeout: 3600,
              },
            },
          },
        },
        command: 'package',
      });

      const functionResource = cfTemplate.Resources[awsNaming.getLambdaLogicalId('imageDurable')];
      const versionResource = Object.values(cfTemplate.Resources).find(
        (resource) =>
          resource.Type === 'AWS::Lambda::Version' &&
          resource.Properties.FunctionName.Ref === awsNaming.getLambdaLogicalId('imageDurable')
      );
      const aliasResource =
        cfTemplate.Resources[awsNaming.getLambdaDurableAliasLogicalId('imageDurable')];

      expect(functionResource.Properties.Code).to.deep.equal({ ImageUri: imageUri });
      expect(functionResource.Properties.PackageType).to.equal('Image');
      expect(functionResource.Properties).to.not.have.property('Handler');
      expect(functionResource.Properties).to.not.have.property('Runtime');
      expect(functionResource.Properties.DurableConfig).to.deep.equal({ ExecutionTimeout: 3600 });
      expect(versionResource.Properties.CodeSha256).to.equal(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      );
      expect(aliasResource.Properties).to.deep.include({ Name: 'durable' });
      expect(aliasResource.Properties.FunctionVersion).to.deep.equal({
        'Fn::GetAtt': [
          cfTemplate.Outputs[awsNaming.getLambdaVersionOutputLogicalId('imageDurable')].Value.Ref,
          'Version',
        ],
      });
    });

    it('should include DurableConfig changes in version logical ids', async () => {
      const packageService = async (durableConfig) => {
        const { awsNaming, cfTemplate } = await runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: { runtime: 'nodejs24.x', durableConfig },
            },
          },
          command: 'package',
        });

        const versionOutput =
          cfTemplate.Outputs[awsNaming.getLambdaVersionOutputLogicalId('basic')];
        return versionOutput.Value.Ref;
      };

      const firstVersionLogicalId = await packageService({ executionTimeout: 3600 });
      const secondVersionLogicalId = await packageService({ executionTimeout: 7200 });
      const thirdVersionLogicalId = await packageService({
        executionTimeout: 7200,
        retentionPeriodInDays: 30,
      });

      expect(firstVersionLogicalId).to.not.equal(secondVersionLogicalId);
      expect(secondVersionLogicalId).to.not.equal(thirdVersionLogicalId);
    });

    it('should reject durableConfig without executionTimeout', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                durableConfig: {
                  retentionPeriodInDays: 30,
                },
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      );
    });

    it('should reject durableConfig values outside supported ranges', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                durableConfig: {
                  executionTimeout: 31622401,
                },
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      );

      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'nodejs24.x',
                durableConfig: {
                  executionTimeout: 3600,
                  retentionPeriodInDays: 91,
                },
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      );
    });

    it('should reject durableConfig values below supported ranges', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'nodejs24.x',
                durableConfig: {
                  executionTimeout: 0,
                },
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      );

      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'nodejs24.x',
                durableConfig: {
                  executionTimeout: 3600,
                  retentionPeriodInDays: 0,
                },
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      );
    });

    it('should reject durableConfig with unknown properties', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'nodejs24.x',
                durableConfig: {
                  executionTimeout: 3600,
                  unknown: true,
                },
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      );
    });

    it('should reject durableConfig with unsupported managed runtimes', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'nodejs20.x',
                durableConfig: {
                  executionTimeout: 3600,
                },
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property('code', 'DURABLE_FUNCTION_UNSUPPORTED_RUNTIME');
    });

    it('should reject durableConfig resolved through an unsupported provider runtime', async () => {
      const error = await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: { basic: { durableConfig: { executionTimeout: 3600 } } },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected;

      expect(error).to.have.property('code', 'DURABLE_FUNCTION_UNSUPPORTED_RUNTIME');
      expect(error.message).to.include('nodejs20.x');
    });

    it('should accept durableConfig resolved through a supported provider runtime', async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          provider: { runtime: 'nodejs22.x' },
          functions: { basic: { durableConfig: { executionTimeout: 3600 } } },
        },
        command: 'package',
      });

      expect(cfTemplate.Resources.BasicLambdaFunction.Properties.DurableConfig).to.deep.equal({
        ExecutionTimeout: 3600,
      });
    });

    it('should reject durableConfig with maximumRetryAttempts', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'nodejs24.x',
                durableConfig: {
                  executionTimeout: 3600,
                },
                maximumRetryAttempts: 1,
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'DURABLE_FUNCTION_MAXIMUM_RETRY_ATTEMPTS_UNSUPPORTED'
      );
    });

    it('should use durable alias for durable functions with provisioned concurrency', async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              durableConfig: {
                executionTimeout: 3600,
              },
              provisionedConcurrency: 1,
            },
          },
        },
        command: 'package',
      });

      const versionOutput = cfTemplate.Outputs[awsNaming.getLambdaVersionOutputLogicalId('basic')];
      expect(cfTemplate.Resources).to.not.have.property(
        awsNaming.getLambdaProvisionedConcurrencyAliasLogicalId('basic')
      );
      expect(cfTemplate.Resources[awsNaming.getLambdaDurableAliasLogicalId('basic')]).to.deep.equal(
        {
          Type: 'AWS::Lambda::Alias',
          Properties: {
            FunctionName: { Ref: awsNaming.getLambdaLogicalId('basic') },
            FunctionVersion: { 'Fn::GetAtt': [versionOutput.Value.Ref, 'Version'] },
            Name: awsNaming.getLambdaDurableAliasName(),
            ProvisionedConcurrencyConfig: {
              ProvisionedConcurrentExecutions: 1,
            },
          },
          DependsOn: awsNaming.getLambdaLogicalId('basic'),
        }
      );
    });

    it('should force versioning and the durable alias when provider versionFunctions is false', async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          provider: { versionFunctions: false },
          functions: {
            basic: { runtime: 'nodejs24.x', durableConfig: { executionTimeout: 3600 } },
          },
        },
        command: 'package',
      });

      expect(cfTemplate.Outputs).to.have.property(
        awsNaming.getLambdaVersionOutputLogicalId('basic')
      );
      expect(cfTemplate.Resources).to.have.property(
        awsNaming.getLambdaDurableAliasLogicalId('basic')
      );
    });

    it('should use durable alias for durable functions with SnapStart', async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'java17',
              durableConfig: {
                executionTimeout: 3600,
              },
              snapStart: true,
            },
          },
        },
        command: 'package',
      });

      const versionOutput = cfTemplate.Outputs[awsNaming.getLambdaVersionOutputLogicalId('basic')];
      expect(cfTemplate.Resources.BasicLambdaFunction.Properties.SnapStart).to.deep.equal({
        ApplyOn: 'PublishedVersions',
      });
      expect(cfTemplate.Resources).to.not.have.property(
        awsNaming.getLambdaSnapStartAliasLogicalId('basic')
      );
      expect(cfTemplate.Resources[awsNaming.getLambdaDurableAliasLogicalId('basic')]).to.deep.equal(
        {
          Type: 'AWS::Lambda::Alias',
          Properties: {
            FunctionName: { Ref: awsNaming.getLambdaLogicalId('basic') },
            FunctionVersion: { 'Fn::GetAtt': [versionOutput.Value.Ref, 'Version'] },
            Name: awsNaming.getLambdaDurableAliasName(),
          },
          DependsOn: awsNaming.getLambdaLogicalId('basic'),
        }
      );
    });

    it('should reject durableConfig with SnapStart on unsupported durable SnapStart runtimes', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'nodejs24.x',
                durableConfig: {
                  executionTimeout: 3600,
                },
                snapStart: true,
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'DURABLE_FUNCTION_SNAPSTART_UNSUPPORTED'
      );
    });

    it('should reject durableConfig with SnapStart and EFS', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'java17',
                durableConfig: {
                  executionTimeout: 3600,
                },
                snapStart: true,
                vpc: {
                  subnetIds: ['subnet-01010101'],
                  securityGroupIds: ['sg-0a0a0a0a'],
                },
                fileSystemConfig: {
                  arn: 'arn:aws:elasticfilesystem:us-east-1:111111111111:access-point/fsap-a1a1a1a1a1a1a1a1a',
                  localMountPath: '/mnt/path',
                },
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'DURABLE_FUNCTION_SNAPSTART_UNSUPPORTED'
      );
    });

    it('should reject durableConfig with SnapStart and container images', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                handler: null,
                image:
                  '000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38',
                durableConfig: {
                  executionTimeout: 3600,
                },
                snapStart: true,
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'DURABLE_FUNCTION_SNAPSTART_UNSUPPORTED'
      );
    });

    it('should reject durableConfig with SnapStart and 513 MB ephemeral storage', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'python3.13',
                durableConfig: {
                  executionTimeout: 3600,
                },
                snapStart: true,
                ephemeralStorageSize: 513,
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'DURABLE_FUNCTION_SNAPSTART_UNSUPPORTED'
      );
    });

    it('should accept durableConfig with SnapStart at the 512 MB ephemeral storage boundary', async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'python3.13',
              durableConfig: { executionTimeout: 3600 },
              snapStart: true,
              ephemeralStorageSize: 512,
            },
          },
        },
        command: 'package',
      });

      expect(cfTemplate.Resources.BasicLambdaFunction.Properties.SnapStart).to.deep.equal({
        ApplyOn: 'PublishedVersions',
      });
      expect(cfTemplate.Resources.BasicLambdaFunction.Properties.EphemeralStorage).to.deep.equal({
        Size: 512,
      });
      expect(cfTemplate.Resources).to.have.property(
        awsNaming.getLambdaDurableAliasLogicalId('basic')
      );
    });

    it('should include SnapStart changes in version logical ids', async () => {
      const packageService = async (snapStart) => {
        const { awsNaming, cfTemplate } = await runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'java17',
                durableConfig: {
                  executionTimeout: 3600,
                },
                snapStart,
              },
            },
          },
          command: 'package',
        });

        const versionOutput =
          cfTemplate.Outputs[awsNaming.getLambdaVersionOutputLogicalId('basic')];
        return versionOutput.Value.Ref;
      };

      const withoutSnapStart = await packageService(false);
      const withSnapStart = await packageService(true);

      expect(withoutSnapStart).to.not.equal(withSnapStart);
    });

    it('should reject durableConfig with Lambda destinations', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'nodejs24.x',
                durableConfig: {
                  executionTimeout: 3600,
                },
                destinations: {
                  onSuccess: 'other',
                },
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'DURABLE_FUNCTION_DESTINATIONS_UNSUPPORTED'
      );
    });

    it('should reject durableConfig with cloudFront events', async () => {
      await expect(
        runServerless({
          fixture: 'function',
          configExt: {
            functions: {
              basic: {
                runtime: 'nodejs24.x',
                durableConfig: { executionTimeout: 900 },
                events: [
                  {
                    cloudFront: {
                      eventType: 'viewer-request',
                      origin: 's3://bucketname.s3.amazonaws.com/files',
                    },
                  },
                ],
              },
            },
          },
          command: 'package',
        })
      ).to.be.eventually.rejected.and.have.property(
        'code',
        'DURABLE_FUNCTION_LAMBDA_EDGE_UNSUPPORTED'
      );
    });

    it('should accept durableConfig at the maximum boundary values', async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              durableConfig: { executionTimeout: 31622400, retentionPeriodInDays: 90 },
            },
          },
        },
        command: 'package',
      });

      expect(cfTemplate.Resources.BasicLambdaFunction.Properties.DurableConfig).to.deep.equal({
        ExecutionTimeout: 31622400,
        RetentionPeriodInDays: 90,
      });
    });

    it('should accept durableConfig at the minimum boundary values', async () => {
      const { cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              durableConfig: { executionTimeout: 1, retentionPeriodInDays: 1 },
            },
          },
        },
        command: 'package',
      });

      expect(cfTemplate.Resources.BasicLambdaFunction.Properties.DurableConfig).to.deep.equal({
        ExecutionTimeout: 1,
        RetentionPeriodInDays: 1,
      });
    });

    it('should reject durableConfig over 900 seconds with event source mappings', async () => {
      const events = [
        { sqs: 'arn:aws:sqs:region:account:MyQueue' },
        { stream: 'arn:aws:dynamodb:region:account:table/foo/stream/1' },
        {
          msk: {
            topic: 'TestingTopic',
            arn: 'arn:aws:kafka:us-east-1:111111111111:cluster/ClusterName/a1a1a1a1a1a1a1a1a',
          },
        },
        {
          kafka: {
            topic: 'TestingTopic',
            bootstrapServers: ['abc.xyz:9092'],
            accessConfigurations: {
              saslScram256Auth:
                'arn:aws:secretsmanager:us-east-1:01234567890:secret:SaslScram256Auth',
            },
          },
        },
        {
          activemq: {
            queue: 'TestingQueue',
            arn: 'arn:aws:mq:us-east-1:0000:broker:ExampleMQBroker:b-xxx-xxx',
            basicAuthArn: 'arn:aws:secretsmanager:us-east-1:01234567890:secret:MyBrokerSecretName',
          },
        },
        {
          rabbitmq: {
            queue: 'TestingQueue',
            arn: 'arn:aws:mq:us-east-1:0000:broker:ExampleMQBroker:b-xxx-xxx',
            basicAuthArn: 'arn:aws:secretsmanager:us-east-1:01234567890:secret:MyBrokerSecretName',
          },
        },
      ];

      for (const event of events) {
        await expect(
          runServerless({
            fixture: 'function',
            configExt: {
              functions: {
                basic: {
                  runtime: 'nodejs24.x',
                  durableConfig: {
                    executionTimeout: 901,
                  },
                  events: [event],
                },
              },
            },
            command: 'package',
          })
        ).to.be.eventually.rejected.and.have.property(
          'code',
          'DURABLE_FUNCTION_ESM_TIMEOUT_UNSUPPORTED'
        );
      }
    });

    it('should support durableConfig with event source mappings at 900 seconds', async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              durableConfig: {
                executionTimeout: 900,
              },
              events: [
                {
                  sqs: 'arn:aws:sqs:region:account:MyQueue',
                },
              ],
            },
          },
        },
        command: 'package',
      });

      const eventSourceMapping = Object.values(cfTemplate.Resources).find(
        (resource) => resource.Type === 'AWS::Lambda::EventSourceMapping'
      );
      expect(eventSourceMapping.Properties.FunctionName).to.deep.equal({
        'Fn::Join': [
          ':',
          [
            { 'Fn::GetAtt': [awsNaming.getLambdaLogicalId('basic'), 'Arn'] },
            awsNaming.getLambdaDurableAliasName(),
          ],
        ],
      });
      expect(eventSourceMapping.DependsOn).to.include(
        awsNaming.getLambdaDurableAliasLogicalId('basic')
      );
    });

    it('should support durableConfig with stream event source mapping destinations', async () => {
      const destination = 'arn:aws:sqs:us-east-1:123456789012:queue';
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              durableConfig: {
                executionTimeout: 900,
              },
              events: [
                {
                  stream: {
                    type: 'dynamodb',
                    arn: 'arn:aws:dynamodb:region:account:table/foo/stream/1',
                    destinations: {
                      onFailure: destination,
                    },
                  },
                },
              ],
            },
          },
        },
        command: 'package',
      });

      const eventSourceMapping = Object.values(cfTemplate.Resources).find(
        (resource) => resource.Type === 'AWS::Lambda::EventSourceMapping'
      );
      expect(eventSourceMapping.Properties.DestinationConfig).to.deep.equal({
        OnFailure: { Destination: destination },
      });
      expect(eventSourceMapping.Properties.FunctionName).to.deep.equal({
        'Fn::Join': [
          ':',
          [
            { 'Fn::GetAtt': [awsNaming.getLambdaLogicalId('basic'), 'Arn'] },
            awsNaming.getLambdaDurableAliasName(),
          ],
        ],
      });
      expect(eventSourceMapping.DependsOn).to.include(
        awsNaming.getLambdaDurableAliasLogicalId('basic')
      );
    });

    it('should support durableConfig with kafka event source mapping destinations', async () => {
      const destination = 'arn:aws:sqs:us-east-1:123456789012:queue';
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              durableConfig: {
                executionTimeout: 900,
              },
              events: [
                {
                  kafka: {
                    topic: 'TestingTopic',
                    bootstrapServers: ['abc.xyz:9092'],
                    accessConfigurations: {
                      saslScram256Auth:
                        'arn:aws:secretsmanager:us-east-1:01234567890:secret:SaslScram256Auth',
                    },
                    onFailureDestination: destination,
                  },
                },
              ],
            },
          },
        },
        command: 'package',
      });

      const eventSourceMapping = Object.values(cfTemplate.Resources).find(
        (resource) => resource.Type === 'AWS::Lambda::EventSourceMapping'
      );
      expect(eventSourceMapping.Properties.DestinationConfig).to.deep.equal({
        OnFailure: { Destination: destination },
      });
      expect(eventSourceMapping.Properties.FunctionName).to.deep.equal({
        'Fn::Join': [
          ':',
          [
            { 'Fn::GetAtt': [awsNaming.getLambdaLogicalId('basic'), 'Arn'] },
            awsNaming.getLambdaDurableAliasName(),
          ],
        ],
      });
      expect(eventSourceMapping.DependsOn).to.include(
        awsNaming.getLambdaDurableAliasLogicalId('basic')
      );
    });

    it('should propagate function conditions to generated durable resources', async () => {
      const condition = 'CreateFunctionCondition';
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        configExt: {
          resources: {
            Conditions: {
              [condition]: {
                'Fn::Equals': ['true', 'true'],
              },
            },
          },
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              condition,
              durableConfig: {
                executionTimeout: 3600,
              },
              url: true,
              maximumEventAge: 3600,
            },
          },
        },
        command: 'package',
      });

      const functionVersionOutputLogicalId = awsNaming.getLambdaVersionOutputLogicalId('basic');
      const functionVersionLogicalId = cfTemplate.Outputs[functionVersionOutputLogicalId].Value.Ref;

      expect(cfTemplate.Resources[awsNaming.getLogGroupLogicalId('basic')].Condition).to.equal(
        condition
      );
      expect(cfTemplate.Resources[functionVersionLogicalId].Condition).to.equal(condition);
      expect(cfTemplate.Outputs[functionVersionOutputLogicalId].Condition).to.equal(condition);
      expect(
        cfTemplate.Resources[awsNaming.getLambdaDurableAliasLogicalId('basic')].Condition
      ).to.equal(condition);
      expect(
        cfTemplate.Resources[awsNaming.getLambdaFunctionUrlLogicalId('basic')].Condition
      ).to.equal(condition);
      expect(
        cfTemplate.Resources[awsNaming.getLambdaFnUrlPermissionLogicalId('basic')].Condition
      ).to.equal(condition);
      expect(
        cfTemplate.Resources[awsNaming.getLambdaFnPermissionLogicalId('basic')].Condition
      ).to.equal(condition);
      expect(cfTemplate.Resources[awsNaming.getLambdaEventConfigLogicalId('basic')]).to.include({
        Condition: condition,
      });
      expect(
        cfTemplate.Resources[awsNaming.getLambdaEventConfigLogicalId('basic')].Properties.Qualifier
      ).to.equal(awsNaming.getLambdaDurableAliasName());
      expect(
        cfTemplate.Resources[awsNaming.getLambdaEventConfigLogicalId('basic')].DependsOn
      ).to.equal(awsNaming.getLambdaDurableAliasLogicalId('basic'));
    });
  });

  describe('#compileRole()', () => {
    it('should ignore inherited Fn::GetAtt role markers', () => {
      const compiledFunction = {
        Properties: {},
        DependsOn: [],
      };
      const role = Object.create({ 'Fn::GetAtt': ['InjectedRole', 'Arn'] });

      awsCompileFunctions.compileRole(compiledFunction, role);

      expect(compiledFunction.Properties.Role).to.equal(role);
      expect(compiledFunction.DependsOn).to.deep.equal([]);
    });

    it('should not set unset properties when not specified in yml (layers, vpc, etc)', async () => {
      const s3Folder = awsCompileFunctions.serverless.service.package.artifactDirectoryName;
      const s3FileName = awsCompileFunctions.serverless.service.package.artifact
        .split(path.sep)
        .pop();

      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
        },
      };
      const compiledFunction = {
        Type: 'AWS::Lambda::Function',
        DependsOn: ['FuncLogGroup'],
        Properties: {
          Code: {
            S3Key: `${s3Folder}/${s3FileName}`,
            S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
          },
          FunctionName: 'new-service-dev-func',
          Handler: 'func.function.handler',
          MemorySize: 1024,
          Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
          Runtime: 'nodejs24.x',
          Timeout: 6,
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction
        ).to.deep.equal(compiledFunction);
      });
    });

    it('should set Layers when specified', async () => {
      const s3Folder = awsCompileFunctions.serverless.service.package.artifactDirectoryName;
      const s3FileName = awsCompileFunctions.serverless.service.package.artifact
        .split(path.sep)
        .pop();

      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          layers: ['arn:aws:xxx:*:*'],
        },
      };
      const compiledFunction = {
        Type: 'AWS::Lambda::Function',
        DependsOn: ['FuncLogGroup'],
        Properties: {
          Code: {
            S3Key: `${s3Folder}/${s3FileName}`,
            S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
          },
          FunctionName: 'new-service-dev-func',
          Handler: 'func.function.handler',
          MemorySize: 1024,
          Role: { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] },
          Runtime: 'nodejs24.x',
          Timeout: 6,
          Layers: ['arn:aws:xxx:*:*'],
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction
        ).to.deep.equal(compiledFunction);
      });
    });

    it('should set Condition when specified', async () => {
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          condition: 'IsE2eTest',
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.Condition
        ).to.equal('IsE2eTest');
      });
    });

    it('should include DependsOn when specified', async () => {
      awsCompileFunctions.serverless.service.functions = {
        func: {
          handler: 'func.function.handler',
          name: 'new-service-dev-func',
          dependsOn: ['MyThing', 'MyOtherThing'],
        },
      };

      return expect(awsCompileFunctions.compileFunctions()).to.be.fulfilled.then(() => {
        expect(
          awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources
            .FuncLambdaFunction.DependsOn
        ).to.deep.equal(['FuncLogGroup', 'MyThing', 'MyOtherThing']);
      });
    });

    it('should initialize target aliases when compiling one function', async () => {
      awsCompileFunctions.serverless.service.functions = {
        source: {
          handler: 'source.handler',
          name: 'source',
          role: 'arn:aws:iam::123456789012:role/source-role',
          destinations: { onSuccess: 'target' },
        },
        target: {
          handler: 'target.handler',
          name: 'target',
          provisionedConcurrency: 1,
        },
      };

      await awsCompileFunctions.compileFunction('source');

      const eventConfig =
        awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate.Resources[
          awsProvider.naming.getLambdaEventConfigLogicalId('source')
        ];

      expect(
        awsCompileFunctions.serverless.service.getFunction('target').targetAlias
      ).to.deep.equal({
        name: awsProvider.naming.getLambdaProvisionedConcurrencyAliasName(),
        logicalId: awsProvider.naming.getLambdaProvisionedConcurrencyAliasLogicalId('target'),
      });
      expect(eventConfig.DependsOn).to.equal(
        awsProvider.naming.getLambdaProvisionedConcurrencyAliasLogicalId('target')
      );
      expect(eventConfig.Properties.DestinationConfig).to.deep.equal({
        OnSuccess: {
          Destination: {
            'Fn::Join': [
              ':',
              [
                { 'Fn::GetAtt': [awsProvider.naming.getLambdaLogicalId('target'), 'Arn'] },
                'provisioned',
              ],
            ],
          },
        },
      });
    });
  });

  describe('#compileFunctionEventInvokeConfig()', () => {
    function useFunctions(functions) {
      awsCompileFunctions.serverless.service.provider.versionFunctions = false;
      awsCompileFunctions.serverless.service.functions = Object.fromEntries(
        Object.entries(functions).map(([name, config]) => [
          name,
          {
            name,
            handler: `${name}.handler`,
            role: 'arn:aws:iam::123456789012:role/test-role',
            ...config,
          },
        ])
      );
    }

    function getEventInvokeConfig(functionName) {
      return awsCompileFunctions.serverless.service.provider.compiledCloudFormationTemplate
        .Resources[awsProvider.naming.getLambdaEventConfigLogicalId(functionName)];
    }

    async function expectCompileError() {
      try {
        await awsCompileFunctions.compileFunctions();
      } catch (error) {
        return error;
      }
      throw new Error('Expected compileFunctions to reject');
    }

    it('should reject unconditioned source destinations to conditional functions', async () => {
      useFunctions({
        source: {
          destinations: { onSuccess: 'target' },
        },
        target: {
          condition: 'IsEnabled',
        },
      });

      const error = await expectCompileError();

      expect(error).to.have.property('code', 'EVENT_INVOKE_CONFIG_CONDITIONAL_DESTINATION');
      expect(error.message).to.equal(
        'Function "source" routes async destinations to conditional function "target". Apply condition "IsEnabled" to "source" or remove the destination.'
      );
    });

    it('should reject onFailure destinations to conditional functions', async () => {
      useFunctions({
        source: {
          destinations: { onFailure: 'target' },
        },
        target: {
          condition: 'IsEnabled',
        },
      });

      const error = await expectCompileError();

      expect(error).to.have.property('code', 'EVENT_INVOKE_CONFIG_CONDITIONAL_DESTINATION');
    });

    it('should reject destinations to functions with different conditions', async () => {
      useFunctions({
        source: {
          condition: 'IsSourceEnabled',
          destinations: { onSuccess: 'target' },
        },
        target: {
          condition: 'IsTargetEnabled',
        },
      });

      const error = await expectCompileError();

      expect(error).to.have.property('code', 'EVENT_INVOKE_CONFIG_CONDITIONAL_DESTINATION');
      expect(error.message).to.equal(
        'Function "source" routes async destinations to conditional function "target". Apply condition "IsTargetEnabled" to "source" or remove the destination.'
      );
    });

    it('should allow source and destination functions with the same condition', async () => {
      useFunctions({
        source: {
          condition: 'IsEnabled',
          destinations: { onSuccess: 'target' },
        },
        target: {
          condition: 'IsEnabled',
        },
      });

      await awsCompileFunctions.compileFunctions();

      const eventInvokeConfig = getEventInvokeConfig('source');
      expect(eventInvokeConfig.Condition).to.equal('IsEnabled');
      expect(eventInvokeConfig.Properties.DestinationConfig).to.deep.equal({
        OnSuccess: {
          Destination: { 'Fn::GetAtt': [awsProvider.naming.getLambdaLogicalId('target'), 'Arn'] },
        },
      });
    });

    it('should allow conditional source functions to target unconditioned functions', async () => {
      useFunctions({
        source: {
          condition: 'IsEnabled',
          destinations: { onSuccess: 'target' },
        },
        target: {},
      });

      await awsCompileFunctions.compileFunctions();

      expect(getEventInvokeConfig('source').Properties.DestinationConfig).to.deep.equal({
        OnSuccess: {
          Destination: { 'Fn::GetAtt': [awsProvider.naming.getLambdaLogicalId('target'), 'Arn'] },
        },
      });
    });

    it('should not validate ARN destination conditions', async () => {
      const arn = 'arn:aws:lambda:us-east-1:123456789012:function:external';
      useFunctions({
        source: {
          destinations: { onSuccess: arn },
        },
      });

      await awsCompileFunctions.compileFunctions();

      expect(getEventInvokeConfig('source').Properties.DestinationConfig).to.deep.equal({
        OnSuccess: { Destination: arn },
      });
    });

    it('should not validate object destination conditions', async () => {
      const destination = { type: 'function', arn: { Ref: 'SomeFunctionArn' } };
      useFunctions({
        source: {
          destinations: { onSuccess: destination },
        },
      });

      await awsCompileFunctions.compileFunctions();

      expect(getEventInvokeConfig('source').Properties.DestinationConfig).to.deep.equal({
        OnSuccess: { Destination: destination.arn },
      });
    });

    it('should preserve existing errors for unknown string destinations', async () => {
      useFunctions({
        source: {
          destinations: { onSuccess: 'missingTarget' },
        },
      });

      const error = await expectCompileError();

      expect(error).to.have.property('code', 'FUNCTION_MISSING_IN_SERVICE');
    });
  });
});

describe('lib/plugins/aws/package/compile/functions/index.test.js', () => {
  describe('Provider properties', () => {
    let cfResources;
    let cfOutputs;
    let naming;
    let serviceConfig;
    let iamRolePolicyStatements;

    before(async () => {
      const imageSha = '6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38';
      const imageWithSha = `000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:${imageSha}`;
      const { awsNaming, cfTemplate, fixtureData } = await runServerless({
        fixture: 'package-artifact',
        command: 'package',
        configExt: {
          provider: {
            kmsKeyArn: 'arn:aws:kms:region:accountid:pro/vider',
            vpc: {
              subnetIds: ['subnet-01010101'],
              securityGroupIds: ['sg-0a0a0a0a'],
            },
            tags: {
              'providerTagA': 'providerTagAValue',
              'providerTagB': 'providerTagBValue',
              'provider:tagC': 'providerTagCValue',
              'provider:tag-D': 'providerTagDValue',
            },
            tracing: {
              lambda: 'Active',
            },
            environment: {
              providerEnvVarA: 'providerEnvVarAValue',
              providerEnvVarB: 'providerEnvVarBValue',
              sharedEnvVar: 'valueFromProvider',
              providerCfIfEnvVar: { 'Fn::If': ['cond', 'first', 'second'] },
            },
            memorySize: 4096,
            runtime: 'nodejs20.x',
            runtimeManagement: {
              mode: 'manual',
              arn: 'arn:aws:lambda:us-east-1:111111111111::runtime:7b620fc2e66107a1046b140b9d320295811af3ad5d4c6a011fad1fa65127e9e6I',
            },
            deploymentBucket: 'com.serverless.deploys',
            versionFunctions: false,
          },
          functions: {
            fnImage: { image: imageWithSha },
            foo: {
              vpc: {
                subnetIds: ['subnet-02020202', { 'Fn::If': ['cond', 'first', 'second'] }],
                securityGroupIds: ['sg-1b1b1b1b', { 'Fn::If': ['cond', 'first', 'second'] }],
              },
              kmsKeyArn: 'arn:aws:kms:region:accountid:fun/ction',
              tracing: 'PassThrough',
              environment: {
                funcEnvVarA: 'funcEnvVarAValue',
                funcEnvVarB: 'funcEnvVarBValue',
                sharedEnvVar: 'valueFromFunction',
              },
              memorySize: 2048,
              runtime: 'nodejs20.x',
              runtimeManagement: 'onFunctionUpdate',
              versionFunction: true,
            },
            fnFileSystemConfig: {
              handler: 'index.handler',
              fileSystemConfig: {
                localMountPath: '/mnt/path',
                arn: 'arn:aws:elasticfilesystem:us-east-1:111111111111:access-point/fsap-a1a1a1a1a1a1a1a1a',
              },
            },
            vpcNullify: {
              vpc: null,
              handler: 'index.handler',
            },
            vpcDisable: {
              vpc: false,
              handler: 'index.handler',
            },
          },
        },
      });
      cfResources = cfTemplate.Resources;
      cfOutputs = cfTemplate.Outputs;
      naming = awsNaming;
      serviceConfig = fixtureData.serviceConfig;
      iamRolePolicyStatements =
        cfResources.IamRoleLambdaExecution.Properties.Policies[0].PolicyDocument.Statement;
    });

    it('should support `package.artifact`', async () => {
      const {
        Code: { S3Key },
      } = cfResources[naming.getLambdaLogicalId('foo')].Properties;

      expect(S3Key.endsWith('artifact.zip')).to.be.true;
    });

    it('should prefer `functions[].package.artifact` over service.package.artifact', () => {
      const {
        Code: { S3Key },
      } = cfResources[naming.getLambdaLogicalId('other')].Properties;

      expect(S3Key.endsWith('artifact-function.zip')).to.be.true;
    });

    it('should support `provider.vpc`', () => {
      const providerConfig = serviceConfig.provider;

      const { VpcConfig } = cfResources[naming.getLambdaLogicalId('other')].Properties;

      expect(VpcConfig.SecurityGroupIds).to.deep.equal(providerConfig.vpc.securityGroupIds);
      expect(VpcConfig.SubnetIds).to.deep.equal(providerConfig.vpc.subnetIds);
    });

    it('should prefer `functions[].vpc` over `provider.vpc`', () => {
      const fooFunctionConfig = serviceConfig.functions.foo;

      const { VpcConfig } = cfResources[naming.getLambdaLogicalId('foo')].Properties;

      expect(VpcConfig.SecurityGroupIds).to.deep.equal(fooFunctionConfig.vpc.securityGroupIds);
      expect(VpcConfig.SubnetIds).to.deep.equal(fooFunctionConfig.vpc.subnetIds);
    });

    it('should allow `functions[].vpc` to specify no vpc', () => {
      const Properties = cfResources[naming.getLambdaLogicalId('vpcNullify')].Properties;

      expect(Properties.VpcConfig).to.be.undefined;
    });

    it('should allow `functions[].vpc` set to `false` to specify no vpc', () => {
      const Properties = cfResources[naming.getLambdaLogicalId('vpcDisable')].Properties;

      expect(Properties.VpcConfig).to.be.undefined;
    });

    it('should support `provider.tags`', () => {
      const providerConfig = serviceConfig.provider;

      const expectedTags = Object.entries(providerConfig.tags).map(([Key, Value]) => ({
        Key,
        Value,
      }));
      const { Tags } = cfResources[naming.getLambdaLogicalId('other')].Properties;
      expect(Tags).to.deep.include.members(expectedTags);
    });

    it('should support both `provider.tags and `function[].tags`', () => {
      const providerConfig = serviceConfig.provider;
      const fooFunctionConfig = serviceConfig.functions.foo;

      const expectedTags = Object.entries({
        ...providerConfig.tags,
        ...fooFunctionConfig.tags,
      }).map(([Key, Value]) => ({ Key, Value }));

      const { Tags } = cfResources[naming.getLambdaLogicalId('other')].Properties;

      expect(Tags).to.deep.include.members(expectedTags);
    });

    it('should support `provider.kmsKeyArn`', () => {
      const { KmsKeyArn } = cfResources[naming.getLambdaLogicalId('other')].Properties;

      expect(KmsKeyArn).to.equal(serviceConfig.provider.kmsKeyArn);
      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: ['kms:Decrypt'],
        Resource: [serviceConfig.provider.kmsKeyArn],
      });
    });

    it('should prefer `functions[].kmsKeyArn` over `provider.kmsKeyArn`', () => {
      const fooFunctionConfig = serviceConfig.functions.foo;

      const { KmsKeyArn } = cfResources[naming.getLambdaLogicalId('foo')].Properties;

      expect(KmsKeyArn).to.equal(fooFunctionConfig.kmsKeyArn);
      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: ['kms:Decrypt'],
        Resource: [fooFunctionConfig.kmsKeyArn],
      });
    });

    it('should support `provider.tracing.lambda`', () => {
      const providerConfig = serviceConfig.provider;

      const { TracingConfig } = cfResources[naming.getLambdaLogicalId('other')].Properties;

      expect(TracingConfig).to.deep.equal({ Mode: providerConfig.tracing.lambda });
      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        Resource: ['*'],
      });
    });

    it('should prefer `functions[].tracing` over `provider.tracing.lambda`', () => {
      const fooFunctionConfig = serviceConfig.functions.foo;

      const { TracingConfig } = cfResources[naming.getLambdaLogicalId('foo')].Properties;

      expect(TracingConfig).to.deep.equal({ Mode: fooFunctionConfig.tracing });
      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        Resource: ['*'],
      });
    });

    it('should support `provider.environment`', () => {
      const providerConfig = serviceConfig.provider;

      const {
        Environment: { Variables },
      } = cfResources[naming.getLambdaLogicalId('other')].Properties;

      expect(Variables).to.deep.equal(providerConfig.environment);
    });

    it('should prefer `functions[].environment` over `provider.environment`', () => {
      const providerConfig = serviceConfig.provider;
      const fooFunctionConfig = serviceConfig.functions.foo;

      const {
        Environment: { Variables },
      } = cfResources[naming.getLambdaLogicalId('foo')].Properties;

      const expectedVariables = {
        ...providerConfig.environment,
        ...fooFunctionConfig.environment,
      };
      expect(Variables).to.deep.equal(expectedVariables);
    });

    it('should support `provider.memorySize`', () => {
      const providerConfig = serviceConfig.provider;

      const { MemorySize } = cfResources[naming.getLambdaLogicalId('other')].Properties;

      expect(MemorySize).to.equal(providerConfig.memorySize);
    });

    it('should prefer `functions[].memorySize` over `provider.memorySize`', () => {
      const fooFunctionConfig = serviceConfig.functions.foo;

      const { MemorySize } = cfResources[naming.getLambdaLogicalId('foo')].Properties;

      expect(MemorySize).to.equal(fooFunctionConfig.memorySize);
    });

    it('should support `provider.runtime`', () => {
      const providerConfig = serviceConfig.provider;

      const { Runtime } = cfResources[naming.getLambdaLogicalId('other')].Properties;

      expect(Runtime).to.equal(providerConfig.runtime);
    });

    it('should prefer `functions[].runtime` over `provider.runtime`', () => {
      const fooFunctionConfig = serviceConfig.functions.foo;

      const { Runtime } = cfResources[naming.getLambdaLogicalId('foo')].Properties;

      expect(Runtime).to.equal(fooFunctionConfig.runtime);
    });

    it('should accept `provider.runtime: java25`', async () => {
      const {
        awsNaming: localNaming,
        cfTemplate: { Resources: localResources },
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          provider: {
            runtime: 'java25',
          },
        },
      });

      expect(localResources[localNaming.getLambdaLogicalId('basic')].Properties.Runtime).to.equal(
        'java25'
      );
      expect(localResources[localNaming.getLambdaLogicalId('other')].Properties.Runtime).to.equal(
        'java25'
      );
    });

    it('should accept `functions[].runtime: java25`', async () => {
      const {
        awsNaming: localNaming,
        cfTemplate: { Resources: localResources },
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          functions: {
            basic: {
              runtime: 'java25',
            },
          },
        },
      });

      expect(localResources[localNaming.getLambdaLogicalId('basic')].Properties.Runtime).to.equal(
        'java25'
      );
      expect(localResources[localNaming.getLambdaLogicalId('other')].Properties.Runtime).to.equal(
        'nodejs20.x'
      );
    });

    it('should accept `provider.runtime: ruby4.0`', async () => {
      const {
        awsNaming: localNaming,
        cfTemplate: { Resources: localResources },
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          provider: {
            runtime: 'ruby4.0',
          },
        },
      });

      expect(localResources[localNaming.getLambdaLogicalId('basic')].Properties.Runtime).to.equal(
        'ruby4.0'
      );
      expect(localResources[localNaming.getLambdaLogicalId('other')].Properties.Runtime).to.equal(
        'ruby4.0'
      );
    });

    it('should accept `functions[].runtime: ruby4.0`', async () => {
      const {
        awsNaming: localNaming,
        cfTemplate: { Resources: localResources },
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          functions: {
            basic: {
              runtime: 'ruby4.0',
            },
          },
        },
      });

      expect(localResources[localNaming.getLambdaLogicalId('basic')].Properties.Runtime).to.equal(
        'ruby4.0'
      );
      expect(localResources[localNaming.getLambdaLogicalId('other')].Properties.Runtime).to.equal(
        'nodejs20.x'
      );
    });

    it('should accept `provider.runtime: java8.al2023`', async () => {
      const {
        awsNaming: localNaming,
        cfTemplate: { Resources: localResources },
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          provider: {
            runtime: 'java8.al2023',
          },
        },
      });

      expect(localResources[localNaming.getLambdaLogicalId('basic')].Properties.Runtime).to.equal(
        'java8.al2023'
      );
      expect(localResources[localNaming.getLambdaLogicalId('other')].Properties.Runtime).to.equal(
        'java8.al2023'
      );
    });

    it('should accept `provider.runtime: java11.al2023`', async () => {
      const {
        awsNaming: localNaming,
        cfTemplate: { Resources: localResources },
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          provider: {
            runtime: 'java11.al2023',
          },
        },
      });

      expect(localResources[localNaming.getLambdaLogicalId('basic')].Properties.Runtime).to.equal(
        'java11.al2023'
      );
      expect(localResources[localNaming.getLambdaLogicalId('other')].Properties.Runtime).to.equal(
        'java11.al2023'
      );
    });

    it('should accept `provider.runtime: java17.al2023`', async () => {
      const {
        awsNaming: localNaming,
        cfTemplate: { Resources: localResources },
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          provider: {
            runtime: 'java17.al2023',
          },
        },
      });

      expect(localResources[localNaming.getLambdaLogicalId('basic')].Properties.Runtime).to.equal(
        'java17.al2023'
      );
      expect(localResources[localNaming.getLambdaLogicalId('other')].Properties.Runtime).to.equal(
        'java17.al2023'
      );
    });

    it('should accept `functions[].runtime: java17.al2023`', async () => {
      const {
        awsNaming: localNaming,
        cfTemplate: { Resources: localResources },
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          functions: {
            basic: {
              runtime: 'java17.al2023',
            },
          },
        },
      });

      expect(localResources[localNaming.getLambdaLogicalId('basic')].Properties.Runtime).to.equal(
        'java17.al2023'
      );
      expect(localResources[localNaming.getLambdaLogicalId('other')].Properties.Runtime).to.equal(
        'nodejs20.x'
      );
    });

    it('should reject deprecated `provider.runtime` values', () => {
      return expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              runtime: 'provided',
            },
          },
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      );
    });

    it('should reject deprecated `functions[].runtime` values', () => {
      return expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            functions: {
              basic: {
                runtime: 'python3.9',
              },
            },
          },
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      );
    });

    it('should reject `functions[].name` values outside the Lambda character set', () => {
      return expect(
        runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            functions: {
              basic: {
                name: 'my.dotted.name',
              },
            },
          },
        })
      ).to.eventually.be.rejected.and.have.property(
        'code',
        'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION'
      );
    });

    it('should support `provider.runtimeManagement`', () => {
      const providerConfig = serviceConfig.provider;

      const { UpdateRuntimeOn } =
        cfResources[naming.getLambdaLogicalId('other')].Properties.RuntimeManagementConfig;

      expect(UpdateRuntimeOn.toLowerCase()).to.equal(providerConfig.runtimeManagement.mode);
    });

    it('should prefer `functions[].runtimeManagement` over `provider.runtimeManagement`', () => {
      const { UpdateRuntimeOn } =
        cfResources[naming.getLambdaLogicalId('foo')].Properties.RuntimeManagementConfig;

      expect(UpdateRuntimeOn).to.equal('FunctionUpdate');
    });

    it('should support `provider.versionFunctions: false`', () => {
      expect(cfOutputs).to.not.have.property(naming.getLambdaVersionOutputLogicalId('other'));
    });

    it('should prefer `functions[].versionFunction` over `provider.versionFunctions`', () => {
      expect(cfOutputs).to.have.property(naming.getLambdaVersionOutputLogicalId('foo'));
    });

    it('should support `provider.deploymentBucket`', () => {
      const providerConfig = serviceConfig.provider;

      const {
        Code: { S3Bucket },
      } = cfResources[naming.getLambdaLogicalId('foo')].Properties;

      expect(S3Bucket).to.deep.equal(providerConfig.deploymentBucket);
    });

    it('should support `functions[].fileSystemConfig` with vpc configured on provider', () => {
      const functionServiceConfig = serviceConfig.functions.fnFileSystemConfig;
      const fileSystemCfConfig =
        cfResources[naming.getLambdaLogicalId('fnFileSystemConfig')].Properties;

      const { arn, localMountPath } = functionServiceConfig.fileSystemConfig;
      expect(arn).to.match(/^arn/);
      expect(localMountPath).to.be.a('string');
      expect(fileSystemCfConfig.FileSystemConfigs).to.deep.equal([
        { Arn: arn, LocalMountPath: localMountPath },
      ]);
      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: ['elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite'],
        Resource: [arn],
      });
    });

    it('should support `provider.architecture`', async () => {
      const imageSha = '6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38';
      const imageWithSha = `000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:${imageSha}`;
      const {
        awsNaming: localNaming,
        cfTemplate: { Resources: localResources },
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          functions: { fnImage: { image: imageWithSha } },
          provider: { architecture: 'arm64' },
        },
      });

      expect(
        localResources[localNaming.getLambdaLogicalId('basic')].Properties.Architectures
      ).to.deep.equal(['arm64']);
      expect(
        localResources[localNaming.getLambdaLogicalId('fnImage')].Properties.Architectures
      ).to.deep.equal(['arm64']);
      expect(cfResources[naming.getLambdaLogicalId('fnImage')].Properties).to.not.have.property(
        'Architectures'
      );
      expect(cfResources[naming.getLambdaLogicalId('foo')].Properties).to.not.have.property(
        'Architectures'
      );
    });

    it('should support `vpc` defined with `Fn::Split`', async () => {
      const { awsNaming, cfTemplate, fixtureData } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          provider: {
            vpc: {
              subnetIds: {
                'Fn::Split': [',', 'subnet-01010101,subnet-21212121'],
              },
              securityGroupIds: {
                'Fn::Split': [',', 'sg-0a0a0a0a,sg-0b0b0b0b'],
              },
            },
          },
        },
      });

      const providerConfig = fixtureData.serviceConfig.provider;

      const { VpcConfig } = cfTemplate.Resources[awsNaming.getLambdaLogicalId('basic')].Properties;

      expect(VpcConfig.SecurityGroupIds).to.deep.equal(providerConfig.vpc.securityGroupIds);
      expect(VpcConfig.SubnetIds).to.deep.equal(providerConfig.vpc.subnetIds);
    });

    describe('when custom IAM role is used', () => {
      let customRoleServiceConfig;
      let basicFunctionRole;
      let otherFunctionRole;

      before(async () => {
        const { awsNaming, cfTemplate, fixtureData } = await runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              iam: {
                role: 'arn:aws:iam::123456789012:role/fromProvider',
              },
            },
            functions: {
              basic: {
                role: 'arn:aws:iam::123456789012:role/fromFunction',
              },
            },
          },
        });
        basicFunctionRole =
          cfTemplate.Resources[awsNaming.getLambdaLogicalId('basic')].Properties.Role;
        otherFunctionRole =
          cfTemplate.Resources[awsNaming.getLambdaLogicalId('other')].Properties.Role;
        customRoleServiceConfig = fixtureData.serviceConfig;
      });

      it('should support `provider.iam.role` as arn string', async () => {
        const providerConfig = customRoleServiceConfig.provider;

        expect(otherFunctionRole).to.equal(providerConfig.iam.role);
      });

      it('should prefer `functions[].role` over `provider.iam.role`', () => {
        const basicFunctionConfig = customRoleServiceConfig.functions.basic;

        expect(basicFunctionRole).to.equal(basicFunctionConfig.role);
      });

      it('should support `provider.iam.role` defined as CF function', async () => {
        const { awsNaming, cfTemplate, fixtureData } = await runServerless({
          fixture: 'function',
          command: 'package',
          configExt: {
            provider: {
              iam: {
                role: {
                  'Fn::Sub': 'arn:aws:iam::${AWS::AccountId}:role/fromFunction',
                },
              },
            },
          },
        });

        const functionRole =
          cfTemplate.Resources[awsNaming.getLambdaLogicalId('basic')].Properties.Role;
        expect(functionRole).to.deep.equal(fixtureData.serviceConfig.provider.iam.role);
      });
    });
  });

  describe('`provider.iam.role` variants', () => {
    it('should support resource name', async () => {
      const { awsNaming, cfTemplate, fixtureData } = await runServerless({
        fixture: 'function',
        configExt: {
          provider: {
            iam: {
              role: 'LogicalNameRole',
            },
          },
        },
        command: 'package',
      });

      const funcResource = cfTemplate.Resources[awsNaming.getLambdaLogicalId('basic')];
      expect(funcResource.DependsOn).to.deep.equal(['BasicLogGroup', 'LogicalNameRole']);
      expect(funcResource.Properties.Role).to.deep.equal({
        'Fn::GetAtt': [fixtureData.serviceConfig.provider.iam.role, 'Arn'],
      });
    });

    it('should support Fn::GetAtt function', async () => {
      const { awsNaming, cfTemplate, fixtureData } = await runServerless({
        fixture: 'function',
        configExt: {
          provider: {
            iam: {
              role: {
                'Fn::GetAtt': ['LogicalNameRole', 'Arn'],
              },
            },
          },
        },
        command: 'package',
      });

      const funcResource = cfTemplate.Resources[awsNaming.getLambdaLogicalId('basic')];
      expect(funcResource.DependsOn).to.deep.equal(['BasicLogGroup', 'LogicalNameRole']);
      expect(funcResource.Properties.Role).to.deep.equal(
        fixtureData.serviceConfig.provider.iam.role
      );
    });
  });

  describe('Function properties', () => {
    let cfResources;
    let cfOutputs;
    let naming;
    let serverless;
    let serviceConfig;
    let iamRolePolicyStatements;
    const imageSha = '6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38';
    const imageWithSha = `000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:${imageSha}`;
    const getFunctionResource = (functionName) =>
      cfResources[naming.getLambdaLogicalId(functionName)];
    const getVersionResourceEntry = (functionName) => {
      const functionLogicalId = naming.getLambdaLogicalId(functionName);
      const entry = Object.entries(cfResources).find(
        ([, resource]) =>
          resource.Type === 'AWS::Lambda::Version' &&
          resource.Properties.FunctionName.Ref === functionLogicalId
      );
      expect(entry).to.not.equal(undefined);
      return entry;
    };

    before(async () => {
      const {
        awsNaming,
        cfTemplate,
        serverless: serverlessInstance,
        fixtureData,
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          functions: {
            target: {
              handler: 'target.handler',
            },
            fnNamed: {
              handler: 'target.handler',
              name: 'custom-function-name',
            },
            fnSized: {
              handler: 'target.handler',
              memorySize: 512,
            },
            fnTimeout: {
              handler: 'target.handler',
              timeout: 30,
            },
            fnDescription: {
              handler: 'target.handler',
              description: 'Function description',
            },
            fnRoleArn: {
              handler: 'target.handler',
              role: 'arn:aws:iam::123456789012:role/functionRole',
            },
            fnRoleName: {
              handler: 'target.handler',
              role: 'LogicalNameRole',
            },
            fnRoleGetAtt: {
              handler: 'target.handler',
              role: { 'Fn::GetAtt': ['LogicalNameRole', 'Arn'] },
            },
            fnRoleImportValue: {
              handler: 'target.handler',
              role: { 'Fn::ImportValue': 'SharedRoleArn' },
            },
            fnVpc: {
              handler: 'target.handler',
              vpc: {
                subnetIds: ['subnet-01010101'],
                securityGroupIds: ['sg-0a0a0a0a'],
              },
            },
            fnTags: {
              handler: 'target.handler',
              tags: {
                functionTag: 'function-value',
              },
            },
            fnOnErrorArn: {
              handler: 'target.handler',
              onError: 'arn:aws:sns:us-east-1:123456789012:failures',
            },
            fnOnErrorRef: {
              handler: 'target.handler',
              onError: { Ref: 'FailureTopic' },
            },
            fnOnErrorImportValue: {
              handler: 'target.handler',
              onError: { 'Fn::ImportValue': 'FailureTopicArn' },
            },
            fnOnErrorGetAtt: {
              handler: 'target.handler',
              onError: { 'Fn::GetAtt': ['FailureTopic', 'Arn'] },
            },
            fnKmsGetAtt: {
              handler: 'target.handler',
              kmsKeyArn: { 'Fn::GetAtt': ['FunctionKey', 'Arn'] },
            },
            fnKmsRef: {
              handler: 'target.handler',
              kmsKeyArn: { Ref: 'FunctionKeyArn' },
            },
            fnKmsImportValue: {
              handler: 'target.handler',
              kmsKeyArn: { 'Fn::ImportValue': 'FunctionKeyArn' },
            },
            fnEnvironmentIntrinsic: {
              handler: 'target.handler',
              environment: {
                EXTERNAL_VALUE: { Ref: 'ExternalEnvValue' },
              },
            },
            fnReserved: {
              handler: 'target.handler',
              reservedConcurrency: 5,
            },
            fnReservedZero: {
              handler: 'target.handler',
              reservedConcurrency: 0,
            },
            fnCondition: {
              handler: 'target.handler',
              condition: 'CreateFunctionCondition',
              maximumRetryAttempts: 0,
              provisionedConcurrency: 1,
              url: true,
            },
            fnConditionSnapStart: {
              handler: 'target.handler',
              runtime: 'java17',
              condition: 'CreateFunctionCondition',
              snapStart: true,
            },
            fnDependsOn: {
              handler: 'target.handler',
              dependsOn: ['SharedDependency'],
            },
            trigger: {
              handler: 'trigger.handler',
              destinations: { onSuccess: 'target' },
            },
            fnArch: {
              handler: 'target.handler',
              architecture: 'arm64',
            },
            fnTargetFailure: {
              handler: 'target.handler',
            },
            fnProvisionedDestinationTarget: {
              handler: 'target.handler',
              provisionedConcurrency: 1,
            },
            fnProvisionedDestinationSource: {
              handler: 'trigger.handler',
              provisionedConcurrency: 1,
              destinations: { onSuccess: 'fnProvisionedDestinationTarget' },
            },
            fnDestinationsOnFailure: {
              handler: 'trigger.handler',
              destinations: { onFailure: 'fnTargetFailure' },
            },
            fnDestinationsArn: {
              handler: 'trigger.handler',
              destinations: { onSuccess: 'arn:aws:lambda:us-east-1:12313231:function:external' },
            },
            fnDestinationsRefSns: {
              handler: 'trigger.handler',
              destinations: {
                onSuccess: { type: 'sns', arn: { Ref: 'SomeSNSArn' } },
              },
            },
            fnDestinationsRefSqs: {
              handler: 'trigger.handler',
              destinations: {
                onSuccess: { type: 'sqs', arn: { Ref: 'SomeSQSArn' } },
              },
            },
            fnDestinationsRefEventBus: {
              handler: 'trigger.handler',
              destinations: {
                onSuccess: { type: 'eventBus', arn: { Ref: 'SomeEventBusArn' } },
              },
            },
            fnDestinationsRefFunction: {
              handler: 'trigger.handler',
              destinations: {
                onSuccess: { type: 'function', arn: { Ref: 'SomeFunctionArn' } },
              },
            },
            fnDestinationsRefOnFailure: {
              handler: 'trigger.handler',
              destinations: {
                onFailure: { type: 'sns', arn: { Ref: 'SomeSNSArn' } },
              },
            },
            fnDisabledLogs: { handler: 'trigger.handler', disableLogs: true },
            fnMaximumEventAge: { handler: 'trigger.handler', maximumEventAge: 3600 },
            fnMaximumRetryAttempts: { handler: 'trigger.handler', maximumRetryAttempts: 0 },
            fnFileSystemConfig: {
              handler: 'trigger.handler',
              vpc: {
                subnetIds: ['subnet-01010101'],
                securityGroupIds: ['sg-0a0a0a0a'],
              },
              fileSystemConfig: {
                localMountPath: '/mnt/path',
                arn: 'arn:aws:elasticfilesystem:us-east-1:111111111111:access-point/fsap-a1a1a1a1a1a1a1a1a',
              },
            },
            fnImage: {
              image: imageWithSha,
            },
            fnImageArch: {
              image: imageWithSha,
              architecture: 'arm64',
            },
            fnImageWithConfig: {
              image: {
                uri: imageWithSha,
                workingDirectory: './workdir',
                entryPoint: ['executable', 'param1'],
                command: ['anotherexecutable'],
              },
            },
            fnExternalLayer: {
              handler: 'target.handler',
              layers: [{ Ref: 'ExternalLambdaLayer' }],
            },
            fnProvisioned: {
              handler: 'trigger.handler',
              maximumRetryAttempts: 0,
              provisionedConcurrency: 1,
            },
            fnEphemeralStorage: {
              handler: 'index.handler',
              ephemeralStorageSize: 1024,
            },
            fnRecursiveLoop: {
              handler: 'index.handler',
              recursiveLoop: 'Allow',
            },
            fnLogs: {
              handler: 'target.handler',
              logs: {
                applicationLogLevel: 'DEBUG',
                logFormat: 'JSON',
                logGroup: 'helloLoggingLogGroup',
                systemLogLevel: 'DEBUG',
              },
            },
            fnUrl: {
              handler: 'target.handler',
              url: true,
            },
            fnUrlWithAuthCorsAndInvokeMode: {
              handler: 'target.handler',
              url: {
                authorizer: 'aws_iam',
                cors: {
                  maxAge: 3600,
                },
                invokeMode: 'RESPONSE_STREAM',
              },
            },
            fnUrlNullifyDefaultCorsValue: {
              handler: 'target.handler',
              url: {
                authorizer: 'aws_iam',
                cors: {
                  allowedHeaders: null,
                },
              },
            },
            fnUrlWithProvisioned: {
              handler: 'target.handler',
              url: true,
              provisionedConcurrency: 1,
            },
          },
          resources: {
            Conditions: {
              CreateFunctionCondition: {
                'Fn::Equals': ['true', 'true'],
              },
            },
            Resources: {
              ExternalLambdaLayer: {
                Type: 'AWS::Lambda::LayerVersion',
                Properties: {
                  CompatibleRuntimes: ['nodejs20.x'],
                  Content: {
                    S3Bucket: 'bucket',
                    S3Key: 'key',
                  },
                  LayerName: 'externalLayer',
                },
              },
            },
          },
        },
      });
      cfResources = cfTemplate.Resources;
      cfOutputs = cfTemplate.Outputs;
      naming = awsNaming;
      serverless = serverlessInstance;
      serviceConfig = fixtureData.serviceConfig;
      iamRolePolicyStatements =
        cfResources.IamRoleLambdaExecution.Properties.Policies[0].PolicyDocument.Statement;
    });

    it('should generate expected function resource', () => {
      const funcResource = getFunctionResource('target');
      const functionObject = serverless.service.getFunction('target');

      expect(funcResource.Type).to.equal('AWS::Lambda::Function');
      expect(funcResource.DependsOn).to.deep.equal([naming.getLogGroupLogicalId('target')]);
      expect(funcResource.Properties.Code.S3Bucket).to.deep.equal({
        Ref: 'ServerlessDeploymentBucket',
      });
      expect(funcResource.Properties.Code.S3Key)
        .to.be.a('string')
        .and.match(/\.zip$/);
      expect(funcResource.Properties.FunctionName).to.equal(functionObject.name);
      expect(funcResource.Properties.Handler).to.equal('target.handler');
      expect(funcResource.Properties.MemorySize).to.equal(functionObject.memory);
      expect(funcResource.Properties.Role).to.deep.equal({
        'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'],
      });
      expect(funcResource.Properties.Runtime).to.equal('nodejs20.x');
      expect(funcResource.Properties.Timeout).to.equal(functionObject.timeout);
      expect(funcResource.Properties).to.not.have.property('DeadLetterConfig');
      expect(funcResource.Properties).to.not.have.property('Description');
      expect(funcResource.Properties).to.not.have.property('Environment');
      expect(funcResource.Properties).to.not.have.property('KmsKeyArn');
      expect(funcResource.Properties).to.not.have.property('Layers');
      expect(funcResource.Properties).to.not.have.property('ReservedConcurrentExecutions');
      expect(funcResource.Properties).to.not.have.property('Tags');
      expect(funcResource.Properties).to.not.have.property('TracingConfig');
      expect(funcResource.Properties).to.not.have.property('VpcConfig');
    });

    it('should support `functions[].role`, expressed via arn', () => {
      const funcResource = getFunctionResource('fnRoleArn');

      expect(funcResource.DependsOn).to.deep.equal([naming.getLogGroupLogicalId('fnRoleArn')]);
      expect(funcResource.Properties.Role).to.equal(serviceConfig.functions.fnRoleArn.role);
    });

    it('should support `functions[].role`, expressed via resource name', () => {
      const funcResource = getFunctionResource('fnRoleName');

      expect(funcResource.DependsOn).to.deep.equal([
        naming.getLogGroupLogicalId('fnRoleName'),
        serviceConfig.functions.fnRoleName.role,
      ]);
      expect(funcResource.Properties.Role).to.deep.equal({
        'Fn::GetAtt': [serviceConfig.functions.fnRoleName.role, 'Arn'],
      });
    });

    it('should support `functions[].role`, expressed via Fn::GetAtt', () => {
      const funcResource = getFunctionResource('fnRoleGetAtt');

      expect(funcResource.DependsOn).to.deep.equal([
        naming.getLogGroupLogicalId('fnRoleGetAtt'),
        'LogicalNameRole',
      ]);
      expect(funcResource.Properties.Role).to.deep.equal(serviceConfig.functions.fnRoleGetAtt.role);
    });

    it('should support `functions[].role`, expressed via Fn::ImportValue', () => {
      const funcResource = getFunctionResource('fnRoleImportValue');

      expect(funcResource.DependsOn).to.deep.equal([
        naming.getLogGroupLogicalId('fnRoleImportValue'),
      ]);
      expect(funcResource.Properties.Role).to.deep.equal(
        serviceConfig.functions.fnRoleImportValue.role
      );
    });

    it('should support `functions[].vpc`', () => {
      const { VpcConfig } = getFunctionResource('fnVpc').Properties;

      expect(VpcConfig.SecurityGroupIds).to.deep.equal(
        serviceConfig.functions.fnVpc.vpc.securityGroupIds
      );
      expect(VpcConfig.SubnetIds).to.deep.equal(serviceConfig.functions.fnVpc.vpc.subnetIds);
    });

    it('should support `function[].tags`', () => {
      expect(getFunctionResource('fnTags').Properties.Tags).to.deep.include({
        Key: 'functionTag',
        Value: serviceConfig.functions.fnTags.tags.functionTag,
      });
    });

    it('should support `functions[].onError` as arn', () => {
      const arn = serviceConfig.functions.fnOnErrorArn.onError;

      expect(getFunctionResource('fnOnErrorArn').Properties.DeadLetterConfig).to.deep.equal({
        TargetArn: arn,
      });
      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: ['sns:Publish'],
        Resource: [arn],
      });
    });

    it('should support `functions[].onError` as Ref', () => {
      expect(getFunctionResource('fnOnErrorRef').Properties.DeadLetterConfig).to.deep.equal({
        TargetArn: serviceConfig.functions.fnOnErrorRef.onError,
      });
    });

    it('should support `functions[].onError` as Fn::ImportValue', () => {
      expect(getFunctionResource('fnOnErrorImportValue').Properties.DeadLetterConfig).to.deep.equal(
        {
          TargetArn: serviceConfig.functions.fnOnErrorImportValue.onError,
        }
      );
    });

    it('should support `functions[].onError` as Fn::GetAtt', () => {
      expect(getFunctionResource('fnOnErrorGetAtt').Properties.DeadLetterConfig).to.deep.equal({
        TargetArn: serviceConfig.functions.fnOnErrorGetAtt.onError,
      });
    });

    it('should support `functions[].kmsKeyArn` as Fn::GetAtt', () => {
      expect(getFunctionResource('fnKmsGetAtt').Properties.KmsKeyArn).to.deep.equal(
        serviceConfig.functions.fnKmsGetAtt.kmsKeyArn
      );
    });

    it('should support `functions[].kmsKeyArn` as Ref', () => {
      expect(getFunctionResource('fnKmsRef').Properties.KmsKeyArn).to.deep.equal(
        serviceConfig.functions.fnKmsRef.kmsKeyArn
      );
    });

    it('should support `functions[].kmsKeyArn` as Fn::ImportValue', () => {
      expect(getFunctionResource('fnKmsImportValue').Properties.KmsKeyArn).to.deep.equal(
        serviceConfig.functions.fnKmsImportValue.kmsKeyArn
      );
    });

    it('should support `functions[].environment` as CF intrinsic function', () => {
      expect(
        getFunctionResource('fnEnvironmentIntrinsic').Properties.Environment.Variables
          .EXTERNAL_VALUE
      ).to.deep.equal(serviceConfig.functions.fnEnvironmentIntrinsic.environment.EXTERNAL_VALUE);
    });

    it('should support `functions[].name`', () => {
      expect(getFunctionResource('fnNamed').Properties.FunctionName).to.equal(
        serviceConfig.functions.fnNamed.name
      );
    });

    it('should support `functions[].memorySize`', () => {
      expect(getFunctionResource('fnSized').Properties.MemorySize).to.equal(
        serviceConfig.functions.fnSized.memorySize
      );
    });

    it('should support `functions[].timeout`', () => {
      expect(getFunctionResource('fnTimeout').Properties.Timeout).to.equal(
        serviceConfig.functions.fnTimeout.timeout
      );
    });

    it('should default to the fixture provider runtime', () => {
      const funcResource = cfResources[naming.getLambdaLogicalId('target')];
      expect(funcResource.Properties.Runtime).to.equal('nodejs20.x');
    });

    it('should support `functions[].description`', () => {
      const [, versionResource] = getVersionResourceEntry('fnDescription');

      expect(getFunctionResource('fnDescription').Properties.Description).to.equal(
        serviceConfig.functions.fnDescription.description
      );
      expect(versionResource.Properties.Description).to.equal(
        serviceConfig.functions.fnDescription.description
      );
    });

    it('should create lambda version resource and the output', () => {
      const [versionLogicalId, versionResource] = getVersionResourceEntry('target');

      expect(versionResource.Properties.FunctionName).to.deep.equal({
        Ref: naming.getLambdaLogicalId('target'),
      });
      expect(cfOutputs[naming.getLambdaVersionOutputLogicalId('target')].Value).to.deep.equal({
        Ref: versionLogicalId,
      });
    });

    it('should support `functions[].reservedConcurrency`', () => {
      expect(getFunctionResource('fnReserved').Properties.ReservedConcurrentExecutions).to.equal(
        serviceConfig.functions.fnReserved.reservedConcurrency
      );
      expect(
        getFunctionResource('fnReservedZero').Properties.ReservedConcurrentExecutions
      ).to.equal(0);
    });

    it('should support `functions[].provisionedConcurrency`', () => {
      const aliasResource =
        cfResources[naming.getLambdaProvisionedConcurrencyAliasLogicalId('fnProvisioned')];

      expect(aliasResource.Type).to.equal('AWS::Lambda::Alias');
      expect(aliasResource.DependsOn).to.equal(naming.getLambdaLogicalId('fnProvisioned'));
      expect(aliasResource.Properties.FunctionName).to.deep.equal({
        Ref: naming.getLambdaLogicalId('fnProvisioned'),
      });
      expect(aliasResource.Properties.Name).to.equal('provisioned');
      expect(aliasResource.Properties.ProvisionedConcurrencyConfig).to.deep.equal({
        ProvisionedConcurrentExecutions:
          serviceConfig.functions.fnProvisioned.provisionedConcurrency,
      });
    });

    it('should support `Ref` references to external layers (not defined as a part of `layers` top-level property in configuration)', async () => {
      expect(
        cfResources[naming.getLambdaLogicalId('fnExternalLayer')].Properties.Layers
      ).to.deep.equal([{ Ref: 'ExternalLambdaLayer' }]);
    });

    it('should support `functions[].condition`', () => {
      const condition = serviceConfig.functions.fnCondition.condition;
      const [versionLogicalId, versionResource] = getVersionResourceEntry('fnCondition');

      expect(getFunctionResource('fnCondition').Condition).to.equal(condition);
      expect(versionResource.Condition).to.equal(condition);
      expect(cfOutputs[naming.getLambdaVersionOutputLogicalId('fnCondition')]).to.deep.include({
        Condition: condition,
      });
      expect(cfOutputs[naming.getLambdaVersionOutputLogicalId('fnCondition')].Value).to.deep.equal({
        Ref: versionLogicalId,
      });
      expect(
        cfResources[naming.getLambdaProvisionedConcurrencyAliasLogicalId('fnCondition')].Condition
      ).to.equal(condition);
      expect(cfResources[naming.getLambdaFunctionUrlLogicalId('fnCondition')].Condition).to.equal(
        condition
      );
      expect(
        cfOutputs[naming.getLambdaFunctionUrlOutputLogicalId('fnCondition')].Condition
      ).to.equal(condition);
      expect(
        cfResources[naming.getLambdaFnUrlPermissionLogicalId('fnCondition')].Condition
      ).to.equal(condition);
      expect(cfResources[naming.getLambdaFnPermissionLogicalId('fnCondition')].Condition).to.equal(
        condition
      );
      expect(cfResources[naming.getLambdaEventConfigLogicalId('fnCondition')].Condition).to.equal(
        condition
      );
      expect(
        cfResources[naming.getLambdaSnapStartAliasLogicalId('fnConditionSnapStart')].Condition
      ).to.equal(serviceConfig.functions.fnConditionSnapStart.condition);
    });

    it('should support `functions[].dependsOn`', () => {
      expect(getFunctionResource('fnDependsOn').DependsOn).to.deep.equal([
        naming.getLogGroupLogicalId('fnDependsOn'),
        ...serviceConfig.functions.fnDependsOn.dependsOn,
      ]);
    });

    it('should support `functions[].url` set to `true`', () => {
      expect(cfResources[naming.getLambdaFunctionUrlLogicalId('fnUrl')].Properties).to.deep.equal({
        AuthType: 'NONE',
        TargetFunctionArn: {
          'Fn::GetAtt': [naming.getLambdaLogicalId('fnUrl'), 'Arn'],
        },
      });
      expect(cfOutputs[naming.getLambdaFunctionUrlLogicalId('fnUrl')].Value).to.deep.equal({
        'Fn::GetAtt': [naming.getLambdaFunctionUrlOutputLogicalId('fnUrl'), 'FunctionUrl'],
      });

      expect(
        cfResources[naming.getLambdaFnUrlPermissionLogicalId('fnUrl')].Properties
      ).to.deep.equal({
        Action: 'lambda:InvokeFunctionUrl',
        FunctionName: {
          'Fn::GetAtt': ['FnUrlLambdaFunction', 'Arn'],
        },
        FunctionUrlAuthType: 'NONE',
        Principal: '*',
      });
      expect(cfResources[naming.getLambdaFnPermissionLogicalId('fnUrl')].Properties).to.deep.equal({
        Action: 'lambda:InvokeFunction',
        FunctionName: {
          'Fn::GetAtt': ['FnUrlLambdaFunction', 'Arn'],
        },
        InvokedViaFunctionUrl: true,
        Principal: '*',
      });
    });

    it('should support `functions[].url` set to `true` with provisionedConcurrency set', () => {
      const provisionedTarget = {
        'Fn::Join': [
          ':',
          [
            {
              'Fn::GetAtt': ['FnUrlWithProvisionedLambdaFunction', 'Arn'],
            },
            'provisioned',
          ],
        ],
      };

      expect(
        cfResources[naming.getLambdaFunctionUrlLogicalId('fnUrlWithProvisioned')].Properties
      ).to.deep.equal({
        AuthType: 'NONE',
        TargetFunctionArn: provisionedTarget,
      });
      expect(
        cfResources[naming.getLambdaFunctionUrlLogicalId('fnUrlWithProvisioned')].DependsOn
      ).to.equal('FnUrlWithProvisionedProvConcLambdaAlias');

      expect(
        cfResources[naming.getLambdaFnUrlPermissionLogicalId('fnUrl')].Properties
      ).to.deep.equal({
        Action: 'lambda:InvokeFunctionUrl',
        FunctionName: {
          'Fn::GetAtt': ['FnUrlLambdaFunction', 'Arn'],
        },
        FunctionUrlAuthType: 'NONE',
        Principal: '*',
      });
      expect(
        cfResources[naming.getLambdaFnUrlPermissionLogicalId('fnUrlWithProvisioned')].DependsOn
      ).to.equal('FnUrlWithProvisionedProvConcLambdaAlias');
      expect(
        cfResources[naming.getLambdaFnUrlPermissionLogicalId('fnUrlWithProvisioned')].Properties
      ).to.deep.equal({
        Action: 'lambda:InvokeFunctionUrl',
        FunctionName: provisionedTarget,
        FunctionUrlAuthType: 'NONE',
        Principal: '*',
      });
      expect(
        cfResources[naming.getLambdaFnPermissionLogicalId('fnUrlWithProvisioned')].Properties
      ).to.deep.equal({
        Action: 'lambda:InvokeFunction',
        FunctionName: provisionedTarget,
        InvokedViaFunctionUrl: true,
        Principal: '*',
      });
      expect(
        cfResources[naming.getLambdaFnPermissionLogicalId('fnUrlWithProvisioned')].DependsOn
      ).to.equal('FnUrlWithProvisionedProvConcLambdaAlias');
    });

    it('should support `functions[].url` with durableConfig', async () => {
      const { awsNaming, cfTemplate } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          functions: {
            basic: {
              runtime: 'nodejs24.x',
              durableConfig: {
                executionTimeout: 3600,
              },
              url: true,
            },
          },
        },
      });

      const versionOutput = cfTemplate.Outputs[awsNaming.getLambdaVersionOutputLogicalId('basic')];
      const durableAliasLogicalId = awsNaming.getLambdaDurableAliasLogicalId('basic');
      const durableAliasTarget = {
        'Fn::Join': [
          ':',
          [
            { 'Fn::GetAtt': [awsNaming.getLambdaLogicalId('basic'), 'Arn'] },
            awsNaming.getLambdaDurableAliasName(),
          ],
        ],
      };

      expect(cfTemplate.Resources[durableAliasLogicalId]).to.deep.equal({
        Type: 'AWS::Lambda::Alias',
        Properties: {
          FunctionName: { Ref: awsNaming.getLambdaLogicalId('basic') },
          FunctionVersion: { 'Fn::GetAtt': [versionOutput.Value.Ref, 'Version'] },
          Name: awsNaming.getLambdaDurableAliasName(),
        },
        DependsOn: awsNaming.getLambdaLogicalId('basic'),
      });

      expect(
        cfTemplate.Resources[awsNaming.getLambdaFunctionUrlLogicalId('basic')].Properties
      ).to.deep.equal({
        AuthType: 'NONE',
        TargetFunctionArn: durableAliasTarget,
      });
      expect(
        cfTemplate.Resources[awsNaming.getLambdaFunctionUrlLogicalId('basic')].DependsOn
      ).to.equal(durableAliasLogicalId);
      expect(
        cfTemplate.Resources[awsNaming.getLambdaFnUrlPermissionLogicalId('basic')].Properties
          .FunctionName
      ).to.deep.equal(durableAliasTarget);
      expect(
        cfTemplate.Resources[awsNaming.getLambdaFnUrlPermissionLogicalId('basic')].DependsOn
      ).to.equal(durableAliasLogicalId);
      expect(
        cfTemplate.Resources[awsNaming.getLambdaFnPermissionLogicalId('basic')].Properties
          .FunctionName
      ).to.deep.equal(durableAliasTarget);
      expect(
        cfTemplate.Resources[awsNaming.getLambdaFnPermissionLogicalId('basic')].DependsOn
      ).to.equal(durableAliasLogicalId);
    });

    it('should support `functions[].url` set to an object with values', () => {
      expect(
        cfResources[naming.getLambdaFunctionUrlLogicalId('fnUrlWithAuthCorsAndInvokeMode')]
          .Properties
      ).to.deep.equal({
        AuthType: 'AWS_IAM',
        TargetFunctionArn: {
          'Fn::GetAtt': [naming.getLambdaLogicalId('fnUrlWithAuthCorsAndInvokeMode'), 'Arn'],
        },
        Cors: {
          AllowMethods: ['*'],
          AllowOrigins: ['*'],
          AllowHeaders: [
            'Content-Type',
            'X-Amz-Date',
            'Authorization',
            'X-Api-Key',
            'X-Amz-Security-Token',
            'X-Amzn-Trace-Id',
          ],
          MaxAge: 3600,
          AllowCredentials: undefined,
          ExposeHeaders: undefined,
        },
        InvokeMode: 'RESPONSE_STREAM',
      });
      expect(
        cfOutputs[naming.getLambdaFunctionUrlLogicalId('fnUrlWithAuthCorsAndInvokeMode')].Value
      ).to.deep.equal({
        'Fn::GetAtt': [
          naming.getLambdaFunctionUrlOutputLogicalId('fnUrlWithAuthCorsAndInvokeMode'),
          'FunctionUrl',
        ],
      });
    });

    it('should support nullifying default cors value with `null` for `functions[].url`', () => {
      expect(
        cfResources[naming.getLambdaFunctionUrlLogicalId('fnUrlNullifyDefaultCorsValue')].Properties
      ).to.deep.equal({
        AuthType: 'AWS_IAM',
        TargetFunctionArn: {
          'Fn::GetAtt': [naming.getLambdaLogicalId('fnUrlNullifyDefaultCorsValue'), 'Arn'],
        },
        Cors: {
          AllowMethods: ['*'],
          AllowOrigins: ['*'],
          AllowHeaders: undefined,
          MaxAge: undefined,
          AllowCredentials: undefined,
          ExposeHeaders: undefined,
        },
      });
      expect(
        cfOutputs[naming.getLambdaFunctionUrlLogicalId('fnUrlNullifyDefaultCorsValue')].Value
      ).to.deep.equal({
        'Fn::GetAtt': [
          naming.getLambdaFunctionUrlOutputLogicalId('fnUrlNullifyDefaultCorsValue'),
          'FunctionUrl',
        ],
      });
    });

    it('should support `functions[].architecture`', () => {
      expect(
        cfResources[naming.getLambdaLogicalId('fnArch')].Properties.Architectures
      ).to.deep.equal(['arm64']);
      expect(
        cfResources[naming.getLambdaLogicalId('fnImageArch')].Properties.Architectures
      ).to.deep.equal(['arm64']);
      expect(cfResources[naming.getLambdaLogicalId('fnImage')].Properties).to.not.have.property(
        'Architectures'
      );
      expect(cfResources[naming.getLambdaLogicalId('target')].Properties).to.not.have.property(
        'Architectures'
      );
    });

    it('should support `functions[].destinations.onSuccess` referencing function in same stack', () => {
      const destinationConfig =
        cfResources[naming.getLambdaEventConfigLogicalId('trigger')].Properties.DestinationConfig;

      expect(destinationConfig).to.deep.equal({
        OnSuccess: {
          Destination: { 'Fn::GetAtt': [naming.getLambdaLogicalId('target'), 'Arn'] },
        },
      });
      expect(destinationConfig).to.not.have.property('OnFailure');

      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: 'lambda:InvokeFunction',
        Resource: {
          'Fn::Sub': `arn:\${AWS::Partition}:lambda:\${AWS::Region}:\${AWS::AccountId}:function:${
            serverless.service.getFunction('target').name
          }`,
        },
      });
    });

    it('should support `functions[].destinations.onFailure` referencing function in same stack', () => {
      const destinationConfig =
        cfResources[naming.getLambdaEventConfigLogicalId('fnDestinationsOnFailure')].Properties
          .DestinationConfig;

      expect(destinationConfig).to.not.have.property('OnSuccess');
      expect(destinationConfig).to.deep.equal({
        OnFailure: {
          Destination: { 'Fn::GetAtt': [naming.getLambdaLogicalId('fnTargetFailure'), 'Arn'] },
        },
      });

      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: 'lambda:InvokeFunction',
        Resource: {
          'Fn::Sub': `arn:\${AWS::Partition}:lambda:\${AWS::Region}:\${AWS::AccountId}:function:${
            serverless.service.getFunction('fnTargetFailure').name
          }`,
        },
      });
    });

    it('should support `functions[].destinations` referencing a provisioned function in same stack', () => {
      const target = {
        'Fn::Join': [
          ':',
          [
            {
              'Fn::GetAtt': [naming.getLambdaLogicalId('fnProvisionedDestinationTarget'), 'Arn'],
            },
            'provisioned',
          ],
        ],
      };
      const eventConfig =
        cfResources[naming.getLambdaEventConfigLogicalId('fnProvisionedDestinationSource')];

      expect(eventConfig.Properties.Qualifier).to.equal('provisioned');
      expect(eventConfig.Properties.DestinationConfig).to.deep.equal({
        OnSuccess: { Destination: target },
      });
      expect(eventConfig.DependsOn).to.have.members([
        naming.getLambdaProvisionedConcurrencyAliasLogicalId('fnProvisionedDestinationSource'),
        naming.getLambdaProvisionedConcurrencyAliasLogicalId('fnProvisionedDestinationTarget'),
      ]);

      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: 'lambda:InvokeFunction',
        Resource: {
          'Fn::Sub': `arn:\${AWS::Partition}:lambda:\${AWS::Region}:\${AWS::AccountId}:function:${
            serverless.service.getFunction('fnProvisionedDestinationTarget').name
          }:provisioned`,
        },
      });
    });

    it('should support `functions[].destinations` referencing durable function in same stack', async () => {
      const {
        awsNaming,
        cfTemplate,
        serverless: serverlessInstance,
      } = await runServerless({
        fixture: 'function',
        command: 'package',
        configExt: {
          functions: {
            source: {
              handler: 'source.handler',
              destinations: {
                onSuccess: 'target',
                onFailure: 'target',
              },
            },
            target: {
              handler: 'target.handler',
              runtime: 'nodejs24.x',
              durableConfig: {
                executionTimeout: 3600,
              },
            },
          },
        },
      });
      const durableAliasLogicalId = awsNaming.getLambdaDurableAliasLogicalId('target');
      const durableAliasTarget = {
        'Fn::Join': [
          ':',
          [
            { 'Fn::GetAtt': [awsNaming.getLambdaLogicalId('target'), 'Arn'] },
            awsNaming.getLambdaDurableAliasName(),
          ],
        ],
      };
      const eventConfig = cfTemplate.Resources[awsNaming.getLambdaEventConfigLogicalId('source')];
      const iamStatements =
        cfTemplate.Resources[awsNaming.getRoleLogicalId()].Properties.Policies[0].PolicyDocument
          .Statement;

      expect(eventConfig.Properties.DestinationConfig).to.deep.equal({
        OnSuccess: { Destination: durableAliasTarget },
        OnFailure: { Destination: durableAliasTarget },
      });
      expect([].concat(eventConfig.DependsOn)).to.include(durableAliasLogicalId);
      expect(iamStatements).to.deep.include({
        Effect: 'Allow',
        Action: 'lambda:InvokeFunction',
        Resource: {
          'Fn::Sub': `arn:\${AWS::Partition}:lambda:\${AWS::Region}:\${AWS::AccountId}:function:${
            serverlessInstance.service.getFunction('target').name
          }:${awsNaming.getLambdaDurableAliasName()}`,
        },
      });
    });

    it('should support `functions[].destinations.onSuccess` referencing arn', () => {
      const destinationConfig =
        cfResources[naming.getLambdaEventConfigLogicalId('fnDestinationsArn')].Properties
          .DestinationConfig;

      const arn = serviceConfig.functions.fnDestinationsArn.destinations.onSuccess;
      expect(arn).to.match(/^arn/);
      expect(destinationConfig).to.deep.equal({
        OnSuccess: { Destination: arn },
      });

      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: 'lambda:InvokeFunction',
        Resource: arn,
      });
    });

    it('should support `functions[].destinations.onSuccess` as `Ref` for `sns`', () => {
      const destinationConfig =
        cfResources[naming.getLambdaEventConfigLogicalId('fnDestinationsRefSns')].Properties
          .DestinationConfig;

      const property = serviceConfig.functions.fnDestinationsRefSns.destinations.onSuccess;
      expect(destinationConfig).to.deep.equal({
        OnSuccess: { Destination: property.arn },
      });

      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: 'sns:Publish',
        Resource: property.arn,
      });
    });

    it('should support `functions[].destinations.onSuccess` as `Ref` for `sqs`', () => {
      const destinationConfig =
        cfResources[naming.getLambdaEventConfigLogicalId('fnDestinationsRefSqs')].Properties
          .DestinationConfig;

      const property = serviceConfig.functions.fnDestinationsRefSqs.destinations.onSuccess;
      expect(destinationConfig).to.deep.equal({
        OnSuccess: { Destination: property.arn },
      });

      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: 'sqs:SendMessage',
        Resource: property.arn,
      });
    });

    it('should support `functions[].destinations.onSuccess` as `Ref` for `eventBus`', () => {
      const destinationConfig =
        cfResources[naming.getLambdaEventConfigLogicalId('fnDestinationsRefEventBus')].Properties
          .DestinationConfig;

      const property = serviceConfig.functions.fnDestinationsRefEventBus.destinations.onSuccess;
      expect(destinationConfig).to.deep.equal({
        OnSuccess: { Destination: property.arn },
      });

      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: 'events:PutEvents',
        Resource: property.arn,
      });
    });

    it('should support `functions[].destinations.onSuccess` as `Ref` for `function`', () => {
      const destinationConfig =
        cfResources[naming.getLambdaEventConfigLogicalId('fnDestinationsRefFunction')].Properties
          .DestinationConfig;

      const property = serviceConfig.functions.fnDestinationsRefFunction.destinations.onSuccess;
      expect(destinationConfig).to.deep.equal({
        OnSuccess: { Destination: property.arn },
      });

      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: 'lambda:InvokeFunction',
        Resource: property.arn,
      });
    });

    it('should support `functions[].destinations.onFailure` as `Ref`', () => {
      const destinationConfig =
        cfResources[naming.getLambdaEventConfigLogicalId('fnDestinationsRefOnFailure')].Properties
          .DestinationConfig;

      const property = serviceConfig.functions.fnDestinationsRefOnFailure.destinations.onFailure;
      expect(destinationConfig).to.deep.equal({
        OnFailure: { Destination: property.arn },
      });

      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: 'sns:Publish',
        Resource: property.arn,
      });
    });

    it('should support `functions[].disableLogs`', () => {
      expect(cfResources[naming.getLambdaLogicalId('fnDisabledLogs')]).to.not.have.property(
        'DependsOn'
      );
    });

    it('should support `functions[].maximumEventAge`', () => {
      const maximumEventAge = serviceConfig.functions.fnMaximumEventAge.maximumEventAge;
      expect(maximumEventAge).to.be.a('number');
      expect(
        cfResources[naming.getLambdaEventConfigLogicalId('fnMaximumEventAge')].Properties
          .MaximumEventAgeInSeconds
      ).to.equal(maximumEventAge);
    });

    it('should support `functions[].maximumRetryAttempts`', () => {
      const maximumRetryAttempts =
        serviceConfig.functions.fnMaximumRetryAttempts.maximumRetryAttempts;

      expect(maximumRetryAttempts).to.be.a('number');

      expect(
        cfResources[naming.getLambdaEventConfigLogicalId('fnMaximumRetryAttempts')].Properties
          .MaximumRetryAttempts
      ).to.equal(maximumRetryAttempts);

      expect(cfResources[naming.getLambdaEventConfigLogicalId('fnProvisioned')].DependsOn).to.equal(
        naming.getLambdaProvisionedConcurrencyAliasLogicalId('fnProvisioned')
      );
    });

    it('should support `functions[].ephemeralStorageSize`', () => {
      const ephemeralStorageSize = serviceConfig.functions.fnEphemeralStorage.ephemeralStorageSize;

      expect(ephemeralStorageSize).to.be.a('number');

      expect(
        cfResources[naming.getLambdaLogicalId('fnEphemeralStorage')].Properties.EphemeralStorage
      ).to.deep.equal({ Size: ephemeralStorageSize });
    });

    it('should support `functions[].recursiveLoop`', () => {
      expect(
        cfResources[naming.getLambdaLogicalId('fnRecursiveLoop')].Properties.RecursiveLoop
      ).to.equal('Allow');
    });

    it('should not set RecursiveLoop when not specified', () => {
      expect(cfResources[naming.getLambdaLogicalId('fnEphemeralStorage')].Properties.RecursiveLoop)
        .to.be.undefined;
    });

    it('should support `functions[].logs`', () => {
      const logs = serviceConfig.functions.fnLogs.logs;

      expect(logs.applicationLogLevel).to.be.a('string');
      expect(logs.logFormat).to.be.a('string');
      expect(logs.logGroup).to.be.a('string');
      expect(logs.systemLogLevel).to.be.a('string');

      expect(
        cfResources[naming.getLambdaLogicalId('fnLogs')].Properties.LoggingConfig
      ).to.deep.equal({
        ApplicationLogLevel: logs.applicationLogLevel,
        LogFormat: logs.logFormat,
        LogGroup: logs.logGroup,
        SystemLogLevel: logs.systemLogLevel,
      });
    });

    it('should accept `DEBUG` as a valid applicationLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                applicationLogLevel: 'DEBUG',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should accept `ERROR` as a valid applicationLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                applicationLogLevel: 'ERROR',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should accept `FATAL` as a valid applicationLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                applicationLogLevel: 'FATAL',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should accept `INFO` as a valid applicationLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                applicationLogLevel: 'INFO',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should accept `TRACE` as a valid applicationLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                applicationLogLevel: 'TRACE',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should accept `WARN` as a valid applicationLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                applicationLogLevel: 'WARN',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should reject invalid applicationLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                applicationLogLevel: 'INVALID',
              },
            },
          },
        },
        command: 'package',
      }).catch((error) => {
        expect(error).to.have.property('code', 'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION');
      });
    });

    it('should accept `JSON` as a valid logFormat value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                logFormat: 'JSON',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should accept `Text` as a valid logFormat value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                logFormat: 'Text',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should reject invalid logFormat value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                logFormat: 'INVALID',
              },
            },
          },
        },
        command: 'package',
      }).catch((error) => {
        expect(error).to.have.property('code', 'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION');
      });
    });

    it('should accept valid logGroup value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                logGroup: 'valid',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should reject invalid logGroup value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                logGroup: '',
              },
            },
          },
        },
        command: 'package',
      }).catch((error) => {
        expect(error).to.have.property('code', 'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION');
      });
    });

    it('should accept `DEBUG` as a valid systemLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                systemLogLevel: 'DEBUG',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should accept `INFO` as a valid systemLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                systemLogLevel: 'INFO',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should accept `WARN` as a valid systemLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                systemLogLevel: 'WARN',
              },
            },
          },
        },
        command: 'package',
      }).then((result) => {
        expect(result).to.be.ok;
      });
    });

    it('should reject invalid systemLogLevel value', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              logs: {
                systemLogLevel: 'INVALID',
              },
            },
          },
        },
        command: 'package',
      }).catch((error) => {
        expect(error).to.have.property('code', 'INVALID_NON_SCHEMA_COMPLIANT_CONFIGURATION');
      });
    });

    it('should support `provider.logs.lambda`', async () => {
      const { cfTemplate, awsNaming } = await runServerless({
        fixture: 'function',
        configExt: {
          provider: {
            logs: {
              lambda: {
                logFormat: 'JSON',
                applicationLogLevel: 'INFO',
                systemLogLevel: 'WARN',
                logGroup: '/aws/lambda/provider-log-group',
              },
            },
          },
        },
        command: 'package',
      });

      const { LoggingConfig } =
        cfTemplate.Resources[awsNaming.getLambdaLogicalId('basic')].Properties;

      expect(LoggingConfig).to.deep.equal({
        LogFormat: 'JSON',
        ApplicationLogLevel: 'INFO',
        SystemLogLevel: 'WARN',
        LogGroup: '/aws/lambda/provider-log-group',
      });
    });

    it('should prefer `functions[].logs` over `provider.logs.lambda`', async () => {
      const { cfTemplate, awsNaming } = await runServerless({
        fixture: 'function',
        configExt: {
          provider: {
            logs: {
              lambda: {
                logFormat: 'Text',
                applicationLogLevel: 'ERROR',
              },
            },
          },
          functions: {
            basic: {
              logs: {
                logFormat: 'JSON',
                applicationLogLevel: 'DEBUG',
              },
            },
          },
        },
        command: 'package',
      });

      const { LoggingConfig } =
        cfTemplate.Resources[awsNaming.getLambdaLogicalId('basic')].Properties;

      expect(LoggingConfig).to.deep.equal({
        LogFormat: 'JSON',
        ApplicationLogLevel: 'DEBUG',
      });
    });

    it('should support `functions[].fileSystemConfig` (with vpc configured on function)', () => {
      const functionServiceConfig = serviceConfig.functions.fnFileSystemConfig;
      const fileSystemCfConfig =
        cfResources[naming.getLambdaLogicalId('fnFileSystemConfig')].Properties;

      const { arn, localMountPath } = functionServiceConfig.fileSystemConfig;
      expect(arn).to.match(/^arn/);
      expect(localMountPath).to.be.a('string');
      expect(fileSystemCfConfig.FileSystemConfigs).to.deep.equal([
        { Arn: arn, LocalMountPath: localMountPath },
      ]);
      expect(iamRolePolicyStatements).to.deep.include({
        Effect: 'Allow',
        Action: ['elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite'],
        Resource: [arn],
      });
    });

    // This is just a happy-path test of images support. Due to sharing code from `provider.js`
    // all further configurations are tested as a part of `test/unit/lib/plugins/aws/provider.test.js`
    it('should support `functions[].image` with sha', () => {
      const functionServiceConfig = serviceConfig.functions.fnImage;
      const functionCfLogicalId = naming.getLambdaLogicalId('fnImage');
      const functionCfConfig = cfResources[functionCfLogicalId].Properties;

      expect(functionCfConfig.Code).to.deep.equal({ ImageUri: functionServiceConfig.image });
      expect(functionCfConfig).to.not.have.property('Handler');
      expect(functionCfConfig).to.not.have.property('Runtime');

      const imageDigest = functionServiceConfig.image.slice(
        functionServiceConfig.image.lastIndexOf('@') + 1
      );
      expect(imageDigest).to.match(/^sha256:[a-f0-9]{64}$/);
      const imageDigestSha = imageDigest.slice('sha256:'.length);
      const versionCfConfig = Object.values(cfResources).find(
        (resource) =>
          resource.Type === 'AWS::Lambda::Version' &&
          resource.Properties.FunctionName.Ref === functionCfLogicalId
      ).Properties;
      expect(versionCfConfig.CodeSha256).to.equal(imageDigestSha);
    });

    it('should support `functions[].image` with image config properties', () => {
      const functionCfLogicalId = naming.getLambdaLogicalId('fnImageWithConfig');
      const functionCfConfig = cfResources[functionCfLogicalId].Properties;

      expect(functionCfConfig.ImageConfig).to.deep.equal({
        Command: ['anotherexecutable'],
        EntryPoint: ['executable', 'param1'],
        WorkingDirectory: './workdir',
      });
    });
  });

  describe('Validation', () => {
    it('should throw error when `functions[].fileSystemConfig` is configured with no vpc', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              fileSystemConfig: {
                localMountPath: '/mnt/path',
                arn: 'arn:aws:elasticfilesystem:us-east-1:111111111111:access-point/fsap-a1a1a1a1a1a1a1a1a',
              },
            },
          },
        },
        command: 'package',
      }).catch((error) => {
        expect(error).to.have.property('code', 'LAMBDA_FILE_SYSTEM_CONFIG_MISSING_VPC');
      });
    });

    it('should throw error when `SnapStart` and `ProvisionedConcurrency` is enabled on the function', () => {
      return runServerless({
        fixture: 'function',
        configExt: {
          functions: {
            basic: {
              snapStart: true,
              provisionedConcurrency: 10,
            },
          },
        },
        command: 'package',
      }).catch((error) => {
        expect(error).to.have.property(
          'code',
          'FUNCTION_BOTH_PROVISIONED_CONCURRENCY_AND_SNAPSTART_ENABLED_ERROR'
        );
      });
    });
  });

  describe('Version hash resolution', () => {
    const testLambdaHashingVersion = () => {
      it('should create a different version if configuration changed', async () => {
        const { servicePath: serviceDir, updateConfig } = await setupProgrammaticFixture(
          'function',
          {
            configExt: {},
          }
        );

        const { cfTemplate: originalTemplate } = await runServerless({
          cwd: serviceDir,
          command: 'package',
        });

        const originalVersionArn =
          originalTemplate.Outputs.BasicLambdaFunctionQualifiedArn.Value.Ref;

        await updateConfig({
          functions: {
            basic: {
              environment: {
                MY_ENV_VAR: 'myvalue',
              },
            },
          },
        });

        const { cfTemplate: updatedTemplate } = await runServerless({
          cwd: serviceDir,
          command: 'package',
        });

        const updatedVersionArn = updatedTemplate.Outputs.BasicLambdaFunctionQualifiedArn.Value.Ref;

        expect(
          updatedTemplate.Resources.BasicLambdaFunction.Properties.Environment.Variables.MY_ENV_VAR
        ).to.equal('myvalue');

        expect(originalVersionArn).to.not.equal(updatedVersionArn);
      });

      it('should not create a different version if only function-wide configuration changed', async () => {
        const { servicePath: serviceDir, updateConfig } = await setupProgrammaticFixture(
          'function',
          {
            configExt: {},
          }
        );

        const { cfTemplate: originalTemplate } = await runServerless({
          cwd: serviceDir,
          command: 'package',
        });
        const originalVersionArn =
          originalTemplate.Outputs.BasicLambdaFunctionQualifiedArn.Value.Ref;

        await updateConfig({
          functions: {
            basic: {
              tags: {
                basic: 'bar',
              },
              reservedConcurrency: 1,
            },
          },
        });
        const { cfTemplate: updatedTemplate } = await runServerless({
          cwd: serviceDir,
          command: 'package',
        });
        const updatedVersionArn = updatedTemplate.Outputs.BasicLambdaFunctionQualifiedArn.Value.Ref;

        expect(
          updatedTemplate.Resources.BasicLambdaFunction.Properties.ReservedConcurrentExecutions
        ).to.equal(1);

        expect(originalVersionArn).to.equal(updatedVersionArn);
      });

      it('should create a different version if SnapStart changed', async () => {
        const { servicePath: serviceDir, updateConfig } = await setupProgrammaticFixture(
          'function',
          {
            configExt: {},
          }
        );

        await updateConfig({
          functions: {
            basic: {
              runtime: 'java17',
              versionFunction: true,
              snapStart: false,
            },
          },
        });

        const { cfTemplate: originalTemplate } = await runServerless({
          cwd: serviceDir,
          command: 'package',
        });

        const originalVersionArn =
          originalTemplate.Outputs.BasicLambdaFunctionQualifiedArn.Value.Ref;

        await updateConfig({
          functions: {
            basic: {
              runtime: 'java17',
              versionFunction: true,
              snapStart: true,
            },
          },
        });

        const { awsNaming, cfTemplate: updatedTemplate } = await runServerless({
          cwd: serviceDir,
          command: 'package',
        });

        const updatedVersionArn = updatedTemplate.Outputs.BasicLambdaFunctionQualifiedArn.Value.Ref;
        const snapStartAlias =
          updatedTemplate.Resources[awsNaming.getLambdaSnapStartAliasLogicalId('basic')];

        expect(originalTemplate.Resources.BasicLambdaFunction.Properties).to.not.have.property(
          'SnapStart'
        );
        expect(updatedTemplate.Resources.BasicLambdaFunction.Properties.SnapStart).to.deep.equal({
          ApplyOn: 'PublishedVersions',
        });
        expect(snapStartAlias.Properties).to.deep.equal({
          FunctionName: { Ref: awsNaming.getLambdaLogicalId('basic') },
          FunctionVersion: { 'Fn::GetAtt': [updatedVersionArn, 'Version'] },
          Name: awsNaming.getLambdaSnapStartEnabledAliasName(),
        });
        expect(originalVersionArn).to.not.equal(updatedVersionArn);
      });

      describe('with layers', () => {
        let firstCfTemplate;
        let serviceDir;
        let updateConfig;
        const mockDescribeStackResponse = {
          CloudFormation: {
            describeStacks: { Stacks: [{ Outputs: [{ OutputKey: 'test' }] }] },
          },
        };

        beforeEach(async () => {
          const serviceData = await setupProgrammaticFixture('function-layers', { configExt: {} });
          ({ servicePath: serviceDir, updateConfig } = serviceData);
          const data = await runServerless({
            cwd: serviceDir,
            command: 'package',
            awsSdkV3StubMap: mockDescribeStackResponse,
          });
          firstCfTemplate = data.cfTemplate;
        });

        it('should create different version ids for identical lambdas with and without layers', () => {
          expect(
            firstCfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref
          ).to.not.equal(firstCfTemplate.Outputs.NoLayerFuncLambdaFunctionQualifiedArn.Value.Ref);
        });

        it('should generate different lambda version id when lambda layer properties are different', async () => {
          const firstVersionId =
            firstCfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref;

          await updateConfig({
            layers: { testLayer: { path: 'test-layer', description: 'Different description' } },
          });

          const data = await runServerless({
            cwd: serviceDir,
            command: 'package',
            awsSdkV3StubMap: mockDescribeStackResponse,
          });

          expect(firstVersionId).to.not.equal(
            data.cfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref
          );
        });

        it('should ignore changing character of S3Key paths when generating layer version id', async () => {
          // the S3Key path is timestamped and so changes on every deployment regardless of layer changes, and should
          // therefore not be included in the version id digest
          const firstVersionId =
            firstCfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref;
          const firstS3Key =
            firstCfTemplate.Resources.TestLayerLambdaLayer.Properties.Content.S3Key;

          const data = await runServerless({
            cwd: serviceDir,
            command: 'package',
            awsSdkV3StubMap: mockDescribeStackResponse,
          });

          expect(firstS3Key).to.not.equal(
            data.cfTemplate.Resources.TestLayerLambdaLayer.Properties.Content.S3Key
          );
          expect(firstVersionId).to.equal(
            data.cfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref
          );
        });

        it('should ignore properties order when generating layer version id', async () => {
          const firstVersionId =
            firstCfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref;

          await updateConfig({
            functions: {
              layerFunc: { layers: [{ Ref: 'TestLayerLambdaLayer' }], handler: 'index.handler' },
            },
          });

          const data = await runServerless({
            cwd: serviceDir,
            command: 'package',
            awsSdkV3StubMap: mockDescribeStackResponse,
          });

          expect(firstVersionId).to.equal(
            data.cfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref
          );
        });

        it('should create different lambda version id for different property keys (but no different values)', async () => {
          const firstVersionId =
            firstCfTemplate.Outputs.LayerFuncWithConfigLambdaFunctionQualifiedArn.Value.Ref;

          await updateConfig({
            functions: {
              layerFuncWithConfig: { handler: 'index.handler', timeout: 128 },
            },
          });

          const data = await runServerless({
            cwd: serviceDir,
            command: 'package',
            awsSdkV3StubMap: mockDescribeStackResponse,
          });

          expect(firstVersionId).to.not.equal(
            data.cfTemplate.Outputs.LayerFuncWithConfigLambdaFunctionQualifiedArn.Value.Ref
          );
        });

        it('should create same version id when layer source and config are unchanged', async () => {
          const firstVersionId =
            firstCfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref;

          const data = await runServerless({
            cwd: serviceDir,
            command: 'package',
            awsSdkV3StubMap: mockDescribeStackResponse,
          });

          expect(firstVersionId).to.equal(
            data.cfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref
          );
        });

        it('should generate different lambda version id when lambda layer arns are different', async () => {
          const firstVersionId =
            firstCfTemplate.Outputs.ArnLayerFuncLambdaFunctionQualifiedArn.Value.Ref;

          await updateConfig({
            functions: {
              arnLayerFunc: {
                handler: 'index.handler',
                layers: ['arn:aws:lambda:us-east-2:123456789012:layer:my-layer:2'],
              },
            },
          });

          const data = await runServerless({
            cwd: serviceDir,
            command: 'package',
            awsSdkV3StubMap: mockDescribeStackResponse,
          });

          expect(firstVersionId).to.not.equal(
            data.cfTemplate.Outputs.ArnLayerFuncLambdaFunctionQualifiedArn.Value.Ref
          );
        });

        describe('when layer content is changed', () => {
          let originalLayer;
          let sourceChangeLayer;
          let backupLayer;

          beforeEach(async () => {
            originalLayer = path.join(serviceDir, 'test-layer');
            sourceChangeLayer = path.join(serviceDir, 'extra-layers', 'test-layer-source-change');
            backupLayer = path.join(serviceDir, 'extra-layers', 'test-layer-backup');

            await fsp.rename(originalLayer, backupLayer);
            await fsp.rename(sourceChangeLayer, originalLayer);
          });

          afterEach(async () => {
            await fsp.rename(originalLayer, sourceChangeLayer);
            await fsp.rename(backupLayer, originalLayer);
          });

          it('should create different lambda version id', async () => {
            const firstVersionId =
              firstCfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref;

            const data = await runServerless({
              cwd: serviceDir,
              command: 'package',
              awsSdkV3StubMap: mockDescribeStackResponse,
            });

            expect(firstVersionId).to.not.equal(
              data.cfTemplate.Outputs.LayerFuncLambdaFunctionQualifiedArn.Value.Ref
            );
          });
        });
      });
    };
    describe('default hashing version', () => {
      testLambdaHashingVersion();
    });
  });

  describe('Remote package artifacts', () => {
    const sourceBucketName = 'source-bucket';
    const serviceArtifactKey = 'service.zip';
    const functionArtifactKey = 'function.zip';
    const serviceArtifactUrl = `https://s3.amazonaws.com/${sourceBucketName}/${serviceArtifactKey}`;
    const functionArtifactUrl = `https://s3.amazonaws.com/${sourceBucketName}/${functionArtifactKey}`;
    let awsSdkV3Stub;
    let naming;
    let uploadedCfTemplate;
    let uploadedBodies;
    let serviceArtifactS3Key;
    let functionArtifactS3Key;

    const getS3Sends = (method) =>
      awsSdkV3Stub.sends.filter(
        ({ service, method: sendMethod }) => service === 'S3' && sendMethod === method
      );

    const getFunctionCode = (functionName) =>
      uploadedCfTemplate.Resources[naming.getLambdaLogicalId(functionName)].Properties.Code;

    const expectFunctionCodeS3Location = (functionName, s3Key) => {
      expect(getFunctionCode(functionName)).to.deep.equal({
        S3Bucket: { Ref: 'ServerlessDeploymentBucket' },
        S3Key: s3Key,
      });
    };

    const getUploadInput = (key) => {
      const uploadSend = getS3Sends('upload').find(({ input }) => input.Key === key);
      expect(uploadSend).to.exist;
      return uploadSend.input;
    };

    const captureUploadBody = async ({ Key, Body }) => {
      if (!Body || typeof Body.on !== 'function') {
        uploadedBodies.set(Key, Body);
        return {};
      }
      const chunks = [];
      await new Promise((resolve, reject) => {
        Body.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        Body.on('end', resolve);
        Body.on('error', reject);
      });
      uploadedBodies.set(Key, Buffer.concat(chunks).toString('utf8'));
      return {};
    };

    before(async () => {
      uploadedBodies = new Map();
      const data = await runServerless({
        fixture: 'package-artifact',
        command: 'deploy',
        lastLifecycleHookName: 'aws:deploy:deploy:uploadArtifacts',
        configExt: {
          package: { artifact: serviceArtifactUrl },
          functions: {
            bar: { handler: 'index.handler' },
            other: { package: { artifact: functionArtifactUrl } },
          },
        },
        awsSdkV3StubMap: createDeployAwsStubMap({
          Lambda: {
            getFunction: {
              Configuration: { LastModified: '2020-05-20T15:34:16.494+0000' },
            },
          },
          S3: {
            headObject: {},
            getObject: ({ Key }) => ({ Body: Readable.from([`${Key} content`]) }),
            upload: captureUploadBody,
          },
        }),
      });
      ({ awsNaming: naming, awsSdkV3Stub } = data);
      const artifactDirectoryName = data.serverless.service.package.artifactDirectoryName;
      const compiledTemplateS3Key = `${artifactDirectoryName}/${naming.getCompiledTemplateS3Suffix()}`;
      serviceArtifactS3Key = `${artifactDirectoryName}/${serviceArtifactKey}`;
      functionArtifactS3Key = `${artifactDirectoryName}/${functionArtifactKey}`;
      uploadedCfTemplate = JSON.parse(getUploadInput(compiledTemplateS3Key).Body);
    });

    it('should support `package.artifact`', async () => {
      const getObjectInputs = getS3Sends('getObject').map(({ input }) => input);
      expect(getObjectInputs).to.deep.include({
        Bucket: sourceBucketName,
        Key: serviceArtifactKey,
      });

      expectFunctionCodeS3Location('foo', serviceArtifactS3Key);
      expectFunctionCodeS3Location('bar', serviceArtifactS3Key);

      const uploadInput = getUploadInput(serviceArtifactS3Key);
      expect(uploadInput).to.include({
        Bucket: 'deployment-bucket',
        ContentType: 'application/zip',
      });
      expect(path.basename(uploadInput.Body.path)).to.equal(serviceArtifactKey);
      expect(uploadedBodies.get(serviceArtifactS3Key)).to.equal(`${serviceArtifactKey} content`);
    });

    it('should support `functions[].package.artifact`', async () => {
      const getObjectInputs = getS3Sends('getObject').map(({ input }) => input);
      expect(getObjectInputs).to.deep.include({
        Bucket: sourceBucketName,
        Key: functionArtifactKey,
      });

      expectFunctionCodeS3Location('other', functionArtifactS3Key);
      expectFunctionCodeS3Location('foo', serviceArtifactS3Key);
      expectFunctionCodeS3Location('bar', serviceArtifactS3Key);

      const uploadInput = getUploadInput(functionArtifactS3Key);
      expect(uploadInput).to.include({
        Bucket: 'deployment-bucket',
        ContentType: 'application/zip',
      });
      expect(path.basename(uploadInput.Body.path)).to.equal(functionArtifactKey);
      expect(uploadedBodies.get(functionArtifactS3Key)).to.equal(`${functionArtifactKey} content`);
    });
  });
});
