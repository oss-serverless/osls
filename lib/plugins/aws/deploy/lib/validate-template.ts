import getS3EndpointForRegion from '../../utils/get-s3-endpoint-for-region.ts';
import ServerlessError from '../../../../serverless-error.ts';
import { CloudFormationClient, ValidateTemplateCommand } from '@aws-sdk/client-cloudformation';

function getCloudFormationClient(context) {
  context.cloudFormationClientPromise ||= context.provider
    .getAwsSdkV3Config()
    .then((config) => new CloudFormationClient(config));
  return context.cloudFormationClientPromise;
}

export default {
  async validateTemplate() {
    const bucketName = this.bucketName;
    const artifactDirectoryName = this.serverless.service.package.artifactDirectoryName;
    const compiledTemplateFileName = this.provider.naming.getCompiledTemplateS3Suffix();
    const s3Endpoint = getS3EndpointForRegion(this.provider.getRegion());
    const params = {
      TemplateURL: `https://${s3Endpoint}/${bucketName}/${artifactDirectoryName}/${compiledTemplateFileName}`,
    };

    const cloudFormation = await getCloudFormationClient(this);
    return cloudFormation.send(new ValidateTemplateCommand(params)).catch((error) => {
      const errorMessage = ['The CloudFormation template is invalid:', ` ${error.message}`].join(
        ''
      );
      throw new ServerlessError(errorMessage, 'INVALID_AWS_CLOUDFORMATION_TEMPLATE');
    });
  },
};
