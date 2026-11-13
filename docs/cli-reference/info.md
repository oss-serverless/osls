# AWS - Info

Displays information about the deployed service.

```bash
osls info
```

## Options

- `--stage` or `-s` The stage in your service you want to display information about.
- `--region` or `-r` The region in your stage that you want to display information about.
- `--verbose` Displays any Stack Output.
- `--conceal` Hide secrets from the output (e.g. API Gateway key values).

## Examples

### AWS

On AWS the info plugin uses the `Outputs` section of the CloudFormation stack and the AWS SDK to gather the necessary information.
See the example below for an example output.

**Example:**

```bash
$ osls info

Service Information
service: my-serverless-service
stage: dev
region: us-east-1
api keys:
  myKey: some123valid456api789key1011for1213api1415gateway
endpoints:
  GET - https://dxaynpuzd4.execute-api.us-east-1.amazonaws.com/dev/users
functions:
  my-serverless-service-dev-hello
```

The URLs of [function URLs](../guides/functions.md#lambda-function-urls) and of [web apps](../guides/web-apps.md) are listed under `endpoints` too, prefixed with the name of the function or web app. A service whose only endpoint is one of those prints it as `endpoint: <url>`.

#### Verbose

When using the `--verbose` flag, the `info` command will also append all Stack Outputs to the output:

```bash
$ osls info --verbose

Service Information
service: my-serverless-service
stage: dev
region: us-east-1
api keys:
  myKey: some123valid456api789key1011for1213api1415gateway
endpoints:
  GET - https://dxaynpuzd4.execute-api.us-east-1.amazonaws.com/dev/users
functions:
  my-serverless-service-dev-hello

Stack Outputs
CloudFrontUrl: d2d10e2tyk1pei.cloudfront.net
ScreenshotBucket: dev-svdgraaf-screenshots
ServiceEndpoint: https://12341jc801.execute-api.us-east-1.amazonaws.com/dev
ServerlessDeploymentBucketName: lambda-screenshots-dev-serverlessdeploymentbucket-15b7pkc04f98a
```

---

[← All Commands](./README.md) · [Docs Home](../README.md)
