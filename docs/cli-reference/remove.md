# AWS - Remove

The `osls remove` command will remove the deployed service, defined in your current working directory, from the provider.

If the stack has deletion protection enabled (see [`provider.deletionProtection`](../guides/deploying.md#deletion-protection)), the command fails before deleting anything.

With [`provider.deploymentMode: express`](../guides/deploying.md#deployment-mode), the stack is deleted in CloudFormation express mode and the command returns while resources may still be deleting.

```bash
osls remove
```

## Options

- `--stage` or `-s` The name of the stage in service.
- `--region` or `-r` The name of the region in stage.
- `--verbose` Shows all stack events during deployment.

## Examples

### Removal of service in specific stage and region

```bash
osls remove --stage dev --region us-east-1
```

This example will remove the deployed service of your current working directory with the stage `dev` and the region `us-east-1`.

---

[← All Commands](./README.md) · [Docs Home](../README.md)
