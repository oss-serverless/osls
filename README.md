**osls** – Build applications on AWS Lambda and other next-gen cloud services, that auto-scale and only charge you when they run. This lowers the total cost of running and operating your apps, enabling you to build more and manage less.

osls is a command-line tool with an easy and approachable YAML syntax to deploy both your code and cloud infrastructure needed to make tons of serverless application use-cases. It's a multi-language framework that supports Node.js, Typescript, Python, Go, Java, and more.

osls is short for Open Serverless.

---

This repository is a maintained alternative to [Serverless Framework](https://github.com/serverless/serverless) v3. It exists for those that cannot upgrade to Serverless Framework v4 and is a drop-in replacement for v3.

## Installation

Requires Node.js `^20.19.0 || ^22.13.0 || >=24`.

Install the 3.x release line explicitly:

```sh
npm install -g osls@3

serverless --version
```

If you are replacing a global Serverless Framework installation, remove it first so the `serverless` command resolves to osls:

```sh
npm uninstall -g serverless
npm install -g osls@3
```

The package provides the `osls`, `sls`, and `serverless` commands.

The repository has been created and is maintained by [Bref](https://bref.sh) maintainers and contributors. The main goal of this repository is to provide continuity for Bref users, so that these Bref projects keep working for the next 5 years. No major new features are planned. However, community contributions to keep the project running (even for languages other than PHP), like adding support to new runtime versions, adapting to AWS changes, bugfixes, and other small improvements are welcome.

## Changes

This repository contains the following differences with the original Serverless Framework v3:

- [Up-to-date documentation for v3](./docs) (all documentation for non-AWS providers has been removed).
- Up-to-date support for new AWS Lambda runtimes.
- There is no standalone binary version, the package is only available via NPM.
- Fixed vulnerabilities in dependencies:
  - [micromatch](https://github.com/serverless/serverless/issues/12482)
  - [braces](https://github.com/serverless/serverless/issues/12481)
  - [tar](https://github.com/serverless/serverless/issues/12422)
- Lighter and faster CLI
  - Serverless Dashboard/Enterprise features are removed (because there is no guarantee to keep them working with v3), if you are using them you should upgrade to v4.
  - Serverless Components support have been removed: these are old and unmaintained projects, it's very unlikely you are using them. That improves the boot time of the CLI.
  - Serverless' integration for Tencent Cloud (China version of the `serverless` CLI) has been removed.
  - Removed unused dependencies.
  - Removed auto-updating (because it's not working anymore).
  - Removed automatic use of local `serverless` installation (in `node_modules`): this avoids surprises running the local `serverless` version instead of this fork.
  - Removed post-install messages.
- Fixed a node warning ("The `punycode` module is deprecated").

## Get Started

- [Setup](./docs/getting-started.md)
- [Concepts](./docs/guides/intro.md)
- [AWS Credentials](./docs/guides/credentials.md)

## Usage

- [Deploying](./docs/guides/deploying.md)
- [Packaging](./docs/guides/packaging.md)
- [Testing](./docs/guides/testing.md)
- [Services](./docs/guides/services.md)
- [Functions](./docs/guides/functions.md)
- [Layers](./docs/guides/layers.md)
- [IAM Function Permissions](./docs/guides/iam.md)
- [Parameters](./docs/guides/parameters.md)
- [Variables](./docs/guides/variables.md)
- [Resources](./docs/guides/resources.md)
- [Composing services](./docs/guides/compose.md)
- [Workflow Tips](./docs/guides/workflow.md)
- [Security Model](./docs/guides/security.md)
- [Serverless.yml Reference](./docs/guides/serverless.yml.md)

# Function events

- [Overview](./docs/guides/events.md)
- [HTTP (API Gateway v2)](./docs/events/http-api.md)
- [REST (API Gateway v1)](./docs/events/apigateway.md)
- [ActiveMQ](./docs/events/activemq.md)
- [Application Load Balancer](./docs/events/alb.md)
- [Alexa Skill](./docs/events/alexa-skill.md)
- [Alexa Smart Home](./docs/events/alexa-smart-home.md)
- [CloudWatch Event](./docs/events/cloudwatch-event.md)
- [CloudWatch Log](./docs/events/cloudwatch-log.md)
- [CloudFront](./docs/events/cloudfront.md)
- [Cognito User Pool](./docs/events/cognito-user-pool.md)
- [EventBridge Event](./docs/events/event-bridge.md)
- [IoT](./docs/events/iot.md)
- [IoT Fleet Provisioning](./docs/events/iot-fleet-provisioning.md)
- [Kafka](./docs/events/kafka.md)
- [Kinesis & DynamoDB](./docs/events/streams.md)
- [MSK](./docs/events/msk.md)
- [RabbitMQ](./docs/events/rabbitmq.md)
- [S3](./docs/events/s3.md)
- [Schedule](./docs/events/schedule.md)
- [SNS](./docs/events/sns.md)
- [SQS](./docs/events/sqs.md)
- [Websocket](./docs/events/websocket.md)

## CLI Reference

- [Overview](./docs/cli-reference)
- [config credentials](./docs/cli-reference/config-credentials.md)
- [create](./docs/cli-reference/create.md)
- [install](./docs/cli-reference/install.md)
- [package](./docs/cli-reference/package.md)
- [deploy](./docs/cli-reference/deploy.md)
- [deploy function](./docs/cli-reference/deploy-function.md)
- [deploy list](./docs/cli-reference/deploy-list.md)
- [invoke](./docs/cli-reference/invoke.md)
- [invoke local](./docs/cli-reference/invoke-local.md)
- [logs](./docs/cli-reference/logs.md)
- [metrics](./docs/cli-reference/metrics.md)
- [info](./docs/cli-reference/info.md)
- [rollback](./docs/cli-reference/rollback.md)
- [rollback function](./docs/cli-reference/rollback-function.md)
- [remove](./docs/cli-reference/remove.md)
- [plugin list](./docs/cli-reference/plugin-list.md)
- [plugin search](./docs/cli-reference/plugin-search.md)
- [plugin install](./docs/cli-reference/plugin-install.md)
- [plugin uninstall](./docs/cli-reference/plugin-uninstall.md)
- [generate event](./docs/cli-reference/generate-event.md)
- [print](./docs/cli-reference/print.md)

## Learn More

- [Configuration Validation](./docs/guides/configuration-validation.md)
- [Resolution of Environment Variables](./docs/guides/environment-variables.md)
- [Deprecations](./docs/guides/deprecations.md)

## Creating Plugins

- [Overview](./docs/guides/plugins/README.md)
- [Creating Plugins](./docs/guides/plugins/creating-plugins.md)
  - [CLI Output](./docs/guides/plugins/cli-output.md)
  - [Custom Commands](./docs/guides/plugins/custom-commands.md)
  - [Custom Variables](./docs/guides/plugins/custom-variables.md)
  - [Extending the Configuration schema](./docs/guides/plugins/custom-configuration.md)
  - [Extending and overriding configuration](./docs/guides/plugins/extending-configuration.md)
