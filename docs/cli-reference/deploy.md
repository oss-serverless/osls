# AWS - Deploy

The `osls deploy` command deploys your entire service via CloudFormation. Run this command when you have made infrastructure changes (i.e., you edited `serverless.yml`). Use `osls deploy function -f myFunction` when you have made code changes and you want to quickly upload your updated code to AWS Lambda or just change function configuration.

With [`provider.deploymentMode: express`](../guides/deploying.md#deployment-mode), the stack operation completes as soon as the configuration is applied and resources may still be stabilizing when the command returns.

```bash
osls deploy
```

## Options

- `--config` or `-c` Name of your configuration file, if other than `serverless.yml|.yaml|.js|.json`.
- `--stage` or `-s` The stage in your service that you want to deploy to.
- `--region` or `-r` The region in that stage that you want to deploy to.
- `--package` or `-p` path to a pre-packaged directory and skip packaging step.
- `--verbose` Shows all stack events during deployment, and display any Stack Output.
- `--force` Forces a deployment to take place.
- `--conceal` Hides secrets from the output (e.g. API Gateway key values).
- `--minify-template` Minify the CloudFormation template.
- `--aws-s3-accelerate` Enables S3 Transfer Acceleration making uploading artifacts much faster. You can read more about it [here](http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html). It requires additional `s3:PutAccelerateConfiguration` permissions. **Note: When using Transfer Acceleration, additional data transfer charges may apply.**
- `--no-aws-s3-accelerate` Explicitly disables S3 Transfer Acceleration. It also requires additional `s3:PutAccelerateConfiguration` permissions.

To deploy a single function without CloudFormation, use [`osls deploy function -f <name>`](./deploy-function.md) instead. The `deploy` command does not accept a `--function` option in osls v4.

## Artifacts

After the `osls deploy` command runs, osls runs `osls package` in the background first then deploys the generated package.

## Examples

### Deployment without stage and region options

```bash
osls deploy
```

This is the simplest deployment usage possible. With this command osls will deploy your service to the defined
provider in the default stage (`dev`) to the default region (`us-east-1`).

### Deployment with stage and region options

```bash
osls deploy --stage production --region eu-central-1
```

With this example we've defined that we want our service to be deployed to the `production` stage in the region
`eu-central-1`.

### Deployment from a pre-packaged directory

```bash
osls deploy --package /path/to/package/directory
```

With this example, the packaging step will be skipped and the CLI will start deploying the package from the `/path/to/package/directory` directory.

### Environment variables

- `SLS_AWS_MONITORING_FREQUENCY` allows the adjustment of the deployment monitoring frequency time in ms, default is `5000`.

```bash
SLS_AWS_MONITORING_FREQUENCY=10000 osls deploy
```

---

[← All Commands](./README.md) · [Docs Home](../README.md)
