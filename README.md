# osls

osls, short for Open Serverless, is an open-source command-line tool for deploying serverless applications on AWS. It uses familiar YAML in `serverless.yml` to define Lambda functions, event sources, IAM permissions, and supporting CloudFormation resources.

osls v4 continues the osls project that began as a maintained fork of [Serverless Framework](https://github.com/serverless/serverless) v3. It is independent from upstream Serverless Framework v4 and does not use Serverless Dashboard, Console, or licensing services. It remains compatible with most Serverless Framework v3 service configurations, with the v4 breaking changes documented in the [upgrade guide](./docs/guides/upgrading-to-v4.md).

osls v4 is the current stable release. The osls v3 line lives on the [`3.x` branch](https://github.com/oss-serverless/osls/tree/3.x) and continues to receive bug and security fixes. If you are coming from osls v3 or Serverless Framework v3, start with [Upgrading to v4](./docs/guides/upgrading-to-v4.md).

## Installation

Requires Node.js `^20.19.0 || ^22.13.0 || >=24`.

If you are replacing a global Serverless Framework installation, remove it first so the `serverless` command resolves to osls.

```sh
npm uninstall -g serverless
npm install -g osls@4

osls --version
```

The package provides the `osls`, `sls`, and `serverless` commands.

## Documentation

The full documentation lives in [`docs/`](./docs/README.md). Start here:

- [Setup](./docs/getting-started.md) — install osls and deploy your first service
- [Concepts](./docs/guides/intro.md) — the core ideas behind services, functions, and events
- [Upgrading to v4](./docs/guides/upgrading-to-v4.md) — what changed from v3 and how to migrate
- [Serverless.yml Reference](./docs/guides/serverless.yml.md) — the full configuration reference

Browse the reference sections, each with its own index:

- [Guides](./docs/guides/README.md) — concepts, build & test, deploy & operate, and reference topics
- [Function events](./docs/events/README.md) — every supported AWS Lambda event source
- [CLI Reference](./docs/cli-reference/README.md) — every osls command and its options
- [Authoring plugins](./docs/guides/plugins/README.md) — write your own commands, variables, and configuration extensions

## Project status

This repository was created and is maintained by [Bref](https://bref.sh) maintainers and contributors. The main goal is continuity for existing serverless projects, including Bref projects, so they keep working over the long term. No major new feature areas are planned, but community contributions are welcome for maintenance work such as supporting new AWS Lambda runtimes, adapting to AWS changes, fixing bugs, and making small improvements.

## How osls differs from upstream Serverless Framework

- The documentation is focused on the current osls release and AWS usage. Documentation for non-AWS providers has been removed.
- New AWS Lambda runtimes are kept up to date.
- osls is published as an npm package only. There is no standalone binary distribution.
- Internal AWS calls use AWS SDK for JavaScript v3 in osls v4, including support for IAM Identity Center credentials.
- Known inherited dependency vulnerabilities have been fixed.
- Serverless Dashboard, Enterprise, and Console features have been removed. If you rely on those hosted upstream services, use upstream Serverless Framework instead.
- Serverless Components support has been removed because those projects are old and unmaintained.
- The Tencent Cloud integration from the upstream `serverless` CLI has been removed.
- Unused dependencies, broken auto-updating, post-install messages, and automatic use of a local `serverless` installation from `node_modules` have been removed.
