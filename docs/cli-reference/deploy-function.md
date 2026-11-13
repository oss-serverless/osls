# AWS - Deploy Function

The `osls deploy function` command deploys an individual function without AWS CloudFormation. This command simply swaps out the zip file that your CloudFormation stack is pointing toward. This is a much faster way of deploying changes in code.

```bash
osls deploy function -f functionName
```

**Note:** This command deploys both function configuration and code by default.
This puts your function in a state that is out of sync with your CloudFormation
stack. Use this for faster development cycles and not production deployments.

**Note:** This command is not supported for functions configured with `durableConfig` locally or already deployed with durable configuration in AWS. Use `osls deploy` so osls can publish a new durable function version and retarget the generated durable alias.

**Note:** This command deploys functions only. For a [web app](../guides/web-apps.md) it fails with `"<name>" is a web app. Deploy it with "serverless deploy".`, because the code of a web app can only change with a new revision, which `osls deploy` creates.

## Options

- `--function` or `-f` The name of the function which should be deployed. **Required**.
- `--force` Forces a deployment to take place.
- `--stage` or `-s` The stage in your service that you want to deploy to.
- `--region` or `-r` The region in that stage that you want to deploy to.
- `--update-config` or `-u` Pushes ONLY Lambda-level configuration changes e.g. handler, timeout or memorySize

## Examples

### Deployment without stage and region options

```bash
osls deploy function --function helloWorld
```

### Deployment with stage and region options

```bash
osls deploy function --function helloWorld \
  --stage dev \
  --region us-east-1
```

### Deploy only configuration changes

```bash
osls deploy function --function helloWorld --update-config
```

---

[← All Commands](./README.md) · [Docs Home](../README.md)
