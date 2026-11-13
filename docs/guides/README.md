# Guides

In-depth guides for building, testing, deploying, and operating services with osls (OSS Serverless). New to osls? Start with [Concepts](intro.md), then work through [Services](services.md) and [Functions](functions.md).

## Concepts

- [osls Concepts](intro.md) — Core concepts and the mental model behind osls services.
- [Services](services.md) — What a service is, the `serverless.yml` file, and how projects are organized.
- [Security model](security.md) — How osls handles credentials, secrets, and the trust boundaries of a deployment.

## Build & test

- [AWS Lambda Functions](functions.md) — Defining functions, handlers, runtimes, and per-function settings.
- [AWS Lambda Events](events.md) — Wiring event sources (HTTP, schedule, queues, streams, and more) to functions.
- [IAM Permissions For Functions](iam.md) — Granting functions the permissions they need via IAM roles and policies.
- [AWS Lambda Layers](layers.md) — Publishing and consuming Lambda layers.
- [AWS Lambda Web Apps](web-apps.md) — Deploying HTTP servers as Lambda Web Functions with the `webApps` property.
- [AWS Infrastructure Resources](resources.md) — Adding raw CloudFormation resources and outputs to a service.
- [Packaging](packaging.md) — Controlling what code and dependencies are bundled into the deployment artifact.
- [Variables](variables.md) — Using `${...}` variable sources to keep configuration DRY.
- [Loading .env files](environment-variables.md) — Loading local `.env` files into a command's environment.
- [Parameters](parameters.md) — Defining and overriding stage/instance parameters.
- [Service configuration validation](configuration-validation.md) — How `serverless.yml` is validated against the schema and how to tune validation.
- [Testing](testing.md) — Strategies and tooling for testing functions and services.

## Deploy & operate

- [AWS Credentials](credentials.md) — Configuring AWS credentials and profiles for deployment.
- [Deploying to AWS](deploying.md) — The deploy workflow, what happens under the hood, and deployment options.
- [Workflow Tips](workflow.md) — Day-to-day tips for developing and iterating on services.
- [Composing services](compose.md) — Orchestrating multiple services together with compose.
- [CI/CD](cicd.md) — Running osls in continuous integration and deployment pipelines.

## Reference

- [Serverless.yml Reference](serverless.yml.md) — Full reference for every `serverless.yml` property.
- [Upgrading from osls v3 to v4](upgrading-to-v4.md) — Migration guide and breaking changes for the v4 line.
- [osls Deprecations](deprecations.md) — Deprecation codes, what they mean, and how to resolve them.
- [Authoring plugins](plugins/README.md) — Index of guides for writing your own osls plugins, commands, variables, and config extensions.

<!--
## When you add a doc

When you add a new guide under `docs/guides/`:

1. Create the guide as `docs/guides/<name>.md` with a single top-level `# Title` heading.
2. Add a link to it in this index, under the most appropriate group above (Concepts / Build & test / Deploy & operate / Reference), with a one-line description.
3. If it is a plugin-authoring guide, add it to `docs/guides/plugins/README.md` instead and ensure that index is linked here.
4. Cross-link it from related guides and, if it is a primary topic, from the root [`README.md`](../../README.md) and its mirror [`docs/README.md`](../README.md).
5. Keep titles and descriptions consistent with the guide's own `# Title`.
-->
