# AWS - Rollback

Rollback a service to a specific deployment.

```bash
osls rollback --timestamp timestamp
```

If `timestamp` is not specified, the CLI will show your existing deployments.

## Options

- `--timestamp` or `-t` The deployment you want to rollback to.
- `--verbose` Shows any Stack Output.

## What rollback restores

`osls rollback` redeploys the CloudFormation template and code artifacts from a previous deployment, returning your infrastructure and function code to that point in time. It does **not** roll back data: changes to DynamoDB tables, S3 objects, RDS databases, or any other stateful resource are not reverted.

Rollback only works while the target deployment's artifacts still exist in the deployment bucket. osls keeps the most recent deployments and prunes older ones (the last `5` by default, configurable via `provider.deploymentBucket.maxPreviousDeploymentArtifacts`). Once a deployment's artifacts have been pruned, you can no longer roll back to it.

Rollback uses the [`provider.deploymentMode`](../guides/deploying.md#deployment-mode) from the current `serverless.yml`, not the one saved with the target deployment.

## Examples

### AWS

At first you want to run `osls deploy list` to show your existing deployments. This will provide you with a list of the deployments stored in your S3 bucket. You can then use the timestamp of one of these deployments to set your infrastructure stack to this specific deployment.

**Example:**

```bash
$ osls deploy list
Listing deployments:
-------------
Timestamp: 1476790110568
Datetime: 2016-10-18T11:28:30.568Z
Files:
- compiled-cloudformation-template.json
- mail-service.zip
-------------
Timestamp: 1476889476243
Datetime: 2016-10-19T15:04:36.243Z
Files:
- compiled-cloudformation-template.json
- mail-service.zip
-------------
Timestamp: 1476893957131
Datetime: 2016-10-19T16:19:17.131Z
Files:
- compiled-cloudformation-template.json
- mail-service.zip
-------------
Timestamp: 1476895175540
Datetime: 2016-10-19T16:39:35.540Z
Files:
- compiled-cloudformation-template.json
- mail-service.zip
-------------
Timestamp: 1476993293402
Datetime: 2016-10-20T19:54:53.402Z
Files:
- compiled-cloudformation-template.json
- mail-service.zip

$ osls rollback -t 1476893957131
Updating Stack...
Checking Stack update progress...
.....
Stack update finished...
```

---

[← All Commands](./README.md) · [Docs Home](../README.md)
