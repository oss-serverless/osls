# Setting Up osls With AWS

Get started with the osls open-source CLI and Amazon Web Services in minutes.

## Installation

Install `osls` module via NPM:

```bash
npm install -g osls@3
```

_Requires Node.js `^20.19.0 || ^22.13.0 || >=24`. Node.js 26 and later require [osls v4](https://github.com/oss-serverless/osls/blob/4.x/docs/guides/upgrading-to-v4.md). If you don’t already have a supported Node.js version on your machine, [install it first](https://nodejs.org/)._

The package installs the `osls`, `sls`, and `serverless` commands. This guide uses `serverless` because osls 3.x is intended as a drop-in replacement for Serverless Framework v3.

## Configure AWS Credentials

Before deploying, configure AWS credentials for the AWS account and region you want to use. See the [AWS credentials guide](./guides/credentials.md) for supported options.

## Creating A Service

A project is known as a service. Create a new service directory:

```bash
mkdir osls-hello
cd osls-hello
```

Create `serverless.yml`:

```yaml
service: osls-hello

provider:
  name: aws
  runtime: nodejs24.x
  region: us-east-1
  stage: dev

functions:
  hello:
    handler: handler.hello
    url: true
```

Create `handler.js`:

```js
'use strict';

module.exports.hello = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'text/plain',
  },
  body: 'Hello from osls!\n',
});
```

The `serverless.yml` file defines your AWS Lambda functions, the events that trigger them, and any additional AWS infrastructure your functions need. This example creates a public [Lambda Function URL](./guides/functions.md#lambda-function-urls). You can learn more in the [Core Concepts documentation](./guides/intro.md).

osls does not include a maintained catalog of built-in templates. If you want to start from a template, use a trusted remote Git URL or local template directory with the [`create` command](./cli-reference/create.md).

## Deploying

Deploy the service:

```bash
serverless deploy
```

The deployed AWS Lambda functions and other essential information, such as Function URL endpoints, will be displayed in the command output.

More details on deploying can be found [here](./guides/deploying.md).

## Invoking Your Function

To retrieve service information, including the Function URL, run:

```bash
serverless info
```

Open the Function URL from the deploy or info output in a browser, or test it with `curl`:

```bash
curl https://your-function-url-id.lambda-url.us-east-1.on.aws/
```

If your function does not have an HTTP endpoint, or if you want to invoke it through the AWS Lambda API, use the `invoke` command:

```bash
serverless invoke -f hello

# Invoke and display logs:
serverless invoke -f hello --log
```

More details on the `invoke` command can be found [here](./cli-reference/invoke.md).

## Developing On The Cloud

Many osls users choose to develop on the cloud, since it matches reality and emulating Lambda locally can be complex. To deploy code changes quickly, skip the `serverless deploy` command, which is much slower since it triggers a full AWS CloudFormation update. Instead, deploy code and configuration changes to individual AWS Lambda functions in seconds via the `deploy function` command, with `-f [function name in serverless.yml]` set to the function you want to deploy.

```bash
serverless deploy function -f hello
```

More details on the `deploy function` command can be found [here](./cli-reference/deploy-function.md).

## Developing Locally

Use the `invoke local` command to invoke your function locally:

```bash
serverless invoke local -f hello
```

You can also pass data to this local invocation:

```bash
serverless invoke local --function hello --data '{"a":"bar"}'
```

More details on the `invoke local` command can be found [here](./cli-reference/invoke-local.md).

A popular plugin, `serverless-offline`, allows you to run a server locally and emulate AWS API Gateway.

More details on the **serverless-offline** plugin command can be found [here](https://github.com/dherault/serverless-offline).

## Remove Your Service

If you want to delete your service, run `remove`. This will delete the AWS resources created by your project and ensure that you don't incur any unexpected charges.

```bash
serverless remove
```

More details on the `remove` command can be found [here](./cli-reference/remove.md).
