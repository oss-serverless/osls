'use strict';

const sinon = require('sinon');
const validateTemplate = require('../../../../../../../lib/plugins/aws/deploy/lib/validate-template');
const { CloudFormationClient, ValidateTemplateCommand } = require('@aws-sdk/client-cloudformation');

// Configure chai
const expect = require('chai').expect;

describe('validateTemplate', () => {
  let awsDeploy;
  let validateTemplateStub;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    awsDeploy = {
      ...validateTemplate,
      bucketName: 'deployment-bucket',
      provider: {
        getAwsSdkV3Config: async () => ({ region: 'us-east-1' }),
        getRegion: () => 'us-east-1',
        naming: {
          getCompiledTemplateS3Suffix: () => 'compiled-cloudformation-template.json',
        },
      },
      serverless: {
        service: {
          package: {
            artifactDirectoryName: 'somedir',
          },
        },
      },
    };
    validateTemplateStub = sandbox.stub(CloudFormationClient.prototype, 'send');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('#validateTemplate()', () => {
    it('should resolve if the CloudFormation template is valid', async () => {
      validateTemplateStub.resolves();

      await awsDeploy.validateTemplate();
      expect(validateTemplateStub).to.have.been.calledOnce;
      expect(validateTemplateStub.firstCall.args[0]).to.be.instanceOf(ValidateTemplateCommand);
      expect(validateTemplateStub.firstCall.args[0].input).to.deep.equal({
        TemplateURL:
          'https://s3.amazonaws.com/deployment-bucket/somedir/compiled-cloudformation-template.json',
      });
    });

    it('uses an existing CloudFormation client promise from the plugin context', async () => {
      const send = sinon.stub().resolves();
      const getAwsSdkV3ConfigStub = sandbox
        .stub(awsDeploy.provider, 'getAwsSdkV3Config')
        .throws(new Error('Expected existing CloudFormation client to be reused'));
      awsDeploy.cloudFormationClientPromise = Promise.resolve({ send });

      await awsDeploy.validateTemplate();

      expect(getAwsSdkV3ConfigStub).to.not.have.been.called;
      expect(send).to.have.been.calledOnce;
      expect(send.firstCall.args[0]).to.be.instanceOf(ValidateTemplateCommand);
      expect(send.firstCall.args[0].input).to.deep.equal({
        TemplateURL:
          'https://s3.amazonaws.com/deployment-bucket/somedir/compiled-cloudformation-template.json',
      });
    });

    it('should throw an error if the CloudFormation template is invalid', async () => {
      validateTemplateStub.rejects({ message: 'Some error while validating' });

      return expect(awsDeploy.validateTemplate()).to.be.rejected.then((error) => {
        expect(validateTemplateStub).to.have.been.calledOnce;
        expect(validateTemplateStub.firstCall.args[0]).to.be.instanceOf(ValidateTemplateCommand);
        expect(validateTemplateStub.firstCall.args[0].input).to.deep.equal({
          TemplateURL:
            'https://s3.amazonaws.com/deployment-bucket/somedir/compiled-cloudformation-template.json',
        });
        expect(error.message).to.match(/is invalid: Some error while validating/);
      });
    });
  });
});
