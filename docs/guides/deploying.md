# Deploying to AWS

osls was designed to provision your AWS Lambda Functions, Events and infrastructure Resources safely and quickly. It does this via a couple of methods designed for different types of deployments.

## Deploy All

This is the main method for doing deployments with osls:

```bash
osls deploy
```

Use this method when you have updated your Function, Event or Resource configuration in `serverless.yml` and you want to deploy that change (or multiple changes at the same time) to Amazon Web Services.

**Note:** You can always enforce a deployment using the `--force` option, or specify a different configuration file name with the the `--config` option.

### How It Works

osls translates all syntax in `serverless.yml` to a single AWS CloudFormation template. By depending on CloudFormation for deployments, users of osls get the safety and reliability of CloudFormation.

- An AWS CloudFormation template is created from your `serverless.yml`.
- If a Stack has not yet been created, then it is created with no resources except for an S3 Bucket, which will store zip files of your Function code.
- If you're using locally build ECR images, dedicated ECR repository is created for your service. You also will be logged to that repository via `docker login` if needed.
- The code of your Functions is then packaged into zip files.
- If you're using locally build ECR images, they are built and uploaded to ECR.
- osls fetches the hashes for all files of the previous deployment (if any) and compares them against the hashes of the local files.
- osls terminates the deployment process if all file hashes are the same.
- Zip files of your Functions' code are uploaded to your Code S3 Bucket.
- Any IAM Roles, Functions, Events and Resources are added to the AWS CloudFormation template.
- The CloudFormation Stack is updated with the new CloudFormation template.
- Each deployment publishes a new version for each function in your service.

### Deployment method

Since osls v3, deployments are done using [CloudFormation change sets](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html). It is possible to use [CloudFormation direct deployments](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-direct.html) instead.

Direct deployments **are faster** and have no downsides (unless you specifically use the generated change sets). In osls, change sets remain the default deployment method; direct deployments are opt-in.

You are encouraged to enable direct deployments via the `deploymentMethod` option:

```yaml
provider:
  name: aws
  deploymentMethod: direct
```

### Deployment mode

[CloudFormation express mode](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-express-mode.html) completes stack operations as soon as resource configuration is applied, without waiting for resources to stabilize. Deployments usually finish faster, but resources may still be initializing when the command returns. AWS positions it for development iteration; keep the default mode where a successful deployment must mean that resources are ready to serve traffic.

Enable it with `provider.deploymentMode`:

```yaml
provider:
  name: aws
  deploymentMode: express
```

The setting applies to every stack operation osls performs for the service: `osls deploy` (with either `deploymentMethod`), `osls rollback` and `osls remove`. `osls deploy function` does not use CloudFormation and is unaffected. No template changes are needed. CloudFormation still waits for custom resources to respond, and stack outputs that reference resource attributes are resolved before the operation completes. AWS documents no resource restrictions, but a resource that depends on another one being fully operational can fail; if that happens, use the default mode for that stage.

Rollback keeps working as in the default mode: a failed deployment is rolled back unless `provider.disableRollback` is `true`. This differs from CloudFormation's own express default, used by the AWS CLI and the CDK, which disables rollback unless you opt back in; the SAM CLI makes the same choice as osls. Keep rollback enabled unless you need to inspect failed resources: the constraints below only apply while it is disabled.

Keep in mind:

- `osls deploy` returns as soon as the configuration is applied. Resources such as CloudFront distributions may still be propagating when osls prints the service information, so a request made straight after the deploy can still reach the previous configuration. Express mode is not always faster: an express operation can still take tens of seconds for a single resource, and a resource that keeps failing can be retried for several minutes before the deployment fails.
- CloudFormation does not accept `OnFailure` in express mode, so osls cannot ask it to delete a stack whose creation failed, which it otherwise does with `deploymentMethod: direct`. This matters when a deployment creates the stack: the first deployment of a service creates the stack with the deployment bucket, and with a custom `provider.deploymentBucket` it creates the whole stack at once. A failed creation leaves the stack in `ROLLBACK_COMPLETE`; run `osls remove` before deploying again, as is already the case for change set deployments.
- With `disableRollback: true`, a failed express deployment leaves the stack in `CREATE_FAILED` or `UPDATE_FAILED`. Until an update succeeds, CloudFormation rejects every update that does not also use express mode with rollback disabled, and `RollbackStack` (`aws cloudformation rollback-stack`) is rejected too. Keep both settings, fix the problem and deploy again, with either deployment method. If `osls deploy` reports that there are no changes, deploy with `--force`.
- While rollback is disabled, CloudFormation rejects updates that replace a resource, for example changing a function's `name` (which also replaces its log group) or a DynamoDB table's or SQS queue's name. The deployment fails and leaves the stack in `UPDATE_FAILED`, and CloudFormation records the attempted properties, so reverting the change is treated as a replacement as well: a resource that keeps its physical name is deleted before it is created again, which discards a log group and its logs, and the creation can fail once more with `AlreadyExists` until the deletion has propagated. Deploy the reverted configuration with `deploymentMethod: direct` and `disableRollback: true` still set (`osls rollback --timestamp` uses the same path, while a change set built from the reverted configuration alone reports nothing to deploy), or remove and redeploy the service. Re-enable rollback before deploying the replacement.
- `provider.rollbackConfiguration` still applies, and the operation only completes after its monitoring period.
- Switching between express and the default mode is a per-deployment choice: after a successful operation, the next one can use either mode.
- `osls deploy --package` uses the value saved by `osls package`; re-run `osls package` after changing it. `osls rollback` and `osls remove` use the current `serverless.yml`.
- `osls remove` reports completion while resources may still be deleting in the background. Deploying a service that reuses the same physical resource names straight afterwards, including redeploying the same service right after `osls remove`, can fail with a name conflict.
- Nested stacks inherit the mode from the root stack.

### Deletion protection

Set `provider.deletionProtection` to have osls manage [CloudFormation termination protection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-protect-stacks.html) for the service stack:

```yaml
provider:
  name: aws
  deletionProtection: true
```

To protect only some stages, list them:

```yaml
provider:
  name: aws
  deletionProtection:
    stages:
      - prod
```

After every successful `osls deploy`, including deploys that are skipped because nothing changed, osls sets the stack's termination protection to match the configuration: enabled when the value is `true` or the current stage is listed in `stages`, disabled otherwise. With the `stages` form, deploying an unlisted stage therefore actively disables protection on that stage's stack. Third-party termination protection plugins typically only ever enable protection, so check the `stages` list when migrating from one. `osls deploy function` and `osls rollback` never change the setting, and removing `provider.deletionProtection` from `serverless.yml` does not disable protection on an existing stack; it only stops osls from managing it.

While a stack is protected, `osls remove` fails early with `AWS_CLOUDFORMATION_DELETION_PROTECTION_ENABLED`, before any deployment artifacts are deleted, and deleting the stack in the AWS console or CLI is rejected by CloudFormation. To remove the service, set `provider.deletionProtection` to `false` (or drop the stage from `stages`), deploy, then remove. If deploying is not possible, for example because the stack is stuck in a failed state, disable protection directly with `aws cloudformation update-termination-protection --no-enable-termination-protection --stack-name <stack-name>`.

Keep in mind:

- The deploying identity needs `cloudformation:UpdateTerminationProtection` on the stack. `osls remove` uses `cloudformation:DescribeStacks` to check the flag; if that call is denied, osls logs a warning and continues, and CloudFormation still refuses to delete a protected stack.
- Protection is applied after the stack has been created or updated, so a brand-new stack is unprotected until its first deployment completes.
- An invalid value fails the deploy with `INVALID_DELETION_PROTECTION_CONFIG` before anything is uploaded. Configuration validation already rejects most invalid shapes; this also covers `configValidationMode: warn` and `off`.
- `osls deploy --package` uses the value saved by `osls package`; re-run `osls package` after changing it.
- Nested stacks inherit the root stack's setting.
- Termination protection prevents accidents, not malicious deletion: anyone allowed to call `UpdateTerminationProtection` can turn it off, and deploying with `deletionProtection: false` does exactly that.

### Tips

- Use this in your CI/CD systems, as it is the safest method of deployment.
- You can print the progress during the deployment if you use `verbose` mode, like this:
  ```bash
  osls deploy --verbose
  ```
- This method uses the AWS CloudFormation Stack Update method. CloudFormation is slow, so this method is slower. If you want to develop more quickly, use the `osls deploy function` command (described below)

- This method defaults to `dev` stage and `us-east-1` region. You can change the default stage and region in your `serverless.yml` file by setting the `stage` and `region` properties inside a `provider` object as the following example shows:

  ```yaml
  # serverless.yml

  service: service-name
  provider:
    name: aws
    stage: beta
    region: us-west-2
  ```

- You can also deploy to different stages and regions by passing in flags to the command:

  ```bash
  osls deploy --stage production --region eu-central-1
  ```

- You can specify your own S3 bucket which should be used to store all the deployment artifacts.
  The `deploymentBucket` config which is nested under `provider` lets you e.g. set the `name` or the `serverSideEncryption` method for this bucket. If you don't provide your own bucket, osls
  will create a bucket which uses default AES256 encryption.

- You can limit how many previous deployment artifacts are retained in the deployment bucket by setting `maxPreviousDeploymentArtifacts` under `deploymentBucket` config to an integer. Older artifacts beyond that count are pruned after each deployment, which also bounds how far back `osls rollback` can go.

- You can specify your own S3 prefix which should be used to store all the deployment artifacts.
  The `deploymentPrefix` config which is nested under `provider` lets you set the prefix under which the deployment artifacts will be stored. If not specified, defaults to `serverless`.

- You can make uploading to S3 faster by adding `--aws-s3-accelerate`

- You can disable creation of default S3 bucket policy by setting `skipPolicySetup` under `deploymentBucket` config. It only applies to deployment bucket that is automatically created
  by osls.

- You can enable versioning for the deployment bucket by setting `versioning` under `deploymentBucket` config to `true`.

Check out the [deploy command docs](../cli-reference/deploy.md) for all details and options.

## Deploying to multiple regions

A single service is deployed to one region per command run. To deploy the same service to several regions, run `osls deploy` once per region, overriding the region each time with the `--region` flag:

```bash
osls deploy --region us-east-1
osls deploy --region eu-central-1
```

Each region gets its own independent CloudFormation stack, so the deployments do not interfere with one another. In CI/CD you can loop over a list of regions, or run the per-region deploys in parallel. To orchestrate several distinct services (each potentially in a different region), see [Composing services](./compose.md).

## Deploy Function

This deployment method does not touch your AWS CloudFormation Stack. Instead, it simply overwrites the zip file of the current function on AWS. This method is much faster, since it does not rely on CloudFormation.

```bash
osls deploy function --function myFunction
```

- **Note:** You can always enforce a deployment using the `--force` option.
- **Note:** You can use `--update-config` to change only Lambda configuration without deploying code.

### How It Works

- The CLI packages up the targeted AWS Lambda Function into a zip file.
- The CLI fetches the hash of the already uploaded function .zip file and compares it to the local .zip file hash.
- The CLI terminates if both hashes are the same.
- That zip file is uploaded to your S3 bucket using the same name as the previous function, which the CloudFormation stack is pointing to.

### Tips

- Use this when you are developing and want to test on AWS because it's much faster.
- During development, people will often run this command several times, as opposed to `osls deploy` which is only run when larger infrastructure provisioning is required.

Check out the [deploy command docs](../cli-reference/deploy.md) for all details and options.

## Deploying a package

This deployment option takes a deployment directory that has already been created with `osls package` and deploys it to the cloud provider. This allows you to easily integrate CI / CD workflows with osls.

```bash
osls deploy --package path-to-package
```

### How It Works

- The argument to the `--package` flag is a directory that has been previously packaged by osls (with `osls package`).
- The deploy process bypasses the package step and uses the existing package to deploy and update CloudFormation stacks.
