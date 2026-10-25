# Setting Up osls With AWS

Get started with the osls open-source CLI and Amazon Web Services in minutes.

## Installation

Install the `osls` module via npm. If you are replacing a global Serverless Framework installation, remove it first so the `serverless` command resolves to osls:

```bash
npm uninstall -g serverless
npm install -g osls@4
```

_Requires Node.js `^22.18.0 || ^24.0.0`. If you don’t already have a supported Node.js version on your machine, [install it first](https://nodejs.org/)._

The package installs the `osls`, `sls`, and `serverless` commands. This guide uses `osls` to avoid confusion with other Serverless Framework installations.

## Configure AWS Credentials

Before deploying, configure AWS credentials for the AWS account and region you want to use. The quickest way to get started is to export your access keys as environment variables:

```bash
export AWS_ACCESS_KEY_ID=<your-key-here>
export AWS_SECRET_ACCESS_KEY=<your-secret-key-here>
```

If you have the AWS CLI installed, you can run `aws configure` instead to store the keys in a profile. See the [AWS credentials guide](./guides/credentials.md#using-aws-access-keys) for AWS profiles, IAM Identity Center, and other supported options.

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
osls deploy
```

The deployed AWS Lambda functions and other essential information, such as Function URL endpoints, are displayed in the command output:

```text
Deploying "osls-hello" to stage "dev" (us-east-1)

✔ Service deployed to stack osls-hello-dev

endpoint: https://abcd1234efgh.lambda-url.us-east-1.on.aws/
functions:
  hello: osls-hello-dev-hello
```

The `endpoint` line is the public Lambda Function URL created by `url: true` in `serverless.yml`. Copy it for the `curl` test below.

More details on deploying can be found [here](./guides/deploying.md).

## Invoking Your Function

To retrieve service information, including the Function URL, run:

```bash
osls info
```

```text
service: osls-hello
stage: dev
region: us-east-1
stack: osls-hello-dev
endpoint: https://abcd1234efgh.lambda-url.us-east-1.on.aws/
functions:
  hello: osls-hello-dev-hello
```

Open the Function URL from the deploy or info output in a browser, or test it with `curl`:

```bash
curl https://your-function-url-id.lambda-url.us-east-1.on.aws/
```

If your function does not have an HTTP endpoint, or if you want to invoke it through the AWS Lambda API, use the `invoke` command:

```bash
osls invoke -f hello

# Invoke and display logs:
osls invoke -f hello --log
```

More details on the `invoke` command can be found [here](./cli-reference/invoke.md).

## Developing On The Cloud

Many osls users choose to develop on the cloud, since it matches reality and emulating Lambda locally can be complex. To deploy code changes quickly, skip the `osls deploy` command, which is much slower since it triggers a full AWS CloudFormation update. Instead, deploy code and configuration changes to individual AWS Lambda functions in seconds via the `deploy function` command, with `-f [function name in serverless.yml]` set to the function you want to deploy.

```bash
osls deploy function -f hello
```

More details on the `deploy function` command can be found [here](./cli-reference/deploy-function.md).

## Developing Locally

Use the `invoke local` command to invoke your function locally:

```bash
osls invoke local -f hello
```

You can also pass data to this local invocation:

```bash
osls invoke local --function hello --data '{"a":"bar"}'
```

More details on the `invoke local` command can be found [here](./cli-reference/invoke-local.md).

A popular plugin, `serverless-offline`, allows you to run a server locally and emulate AWS API Gateway.

More details on the **serverless-offline** plugin command can be found [here](https://github.com/dherault/serverless-offline).

## Remove Your Service

If you want to delete your service, run `remove`. This will delete the AWS resources created by your project and ensure that you don't incur any unexpected charges.

```bash
osls remove
```

More details on the `remove` command can be found [here](./cli-reference/remove.md).

## Next Steps

Now that you have deployed your first service, dig into the topics that matter most for your project:

- [Core Concepts](./guides/intro.md) — how services, functions, and events fit together.
- [Functions](./guides/functions.md) — configure handlers, memory, timeouts, and Function URLs.
- [Function events](./events/README.md) — connect your functions to API Gateway, SQS, S3, schedules, and more.
- [Variables](./guides/variables.md) — reference parameters, environment values, and secrets in `serverless.yml`.
- [CLI Reference](./cli-reference/README.md) — every osls command and its options.
