# AWS - Rollback Function

Rolls back a single function to a previously published Lambda version without running a full CloudFormation deployment. Use it to quickly revert a code change to one function; to roll back the whole service (infrastructure and all functions), use [`osls rollback`](./rollback.md) instead.

```bash
osls rollback function --function <name> \
  --function-version <version>
```

**Note:** You can only rollback a function which was previously deployed through `osls deploy`. Functions are not versioned when running `osls deploy function`.

**Note:** This command is not supported for functions configured with `durableConfig` locally or already deployed with durable configuration in AWS. Use `osls deploy` to publish and retarget durable function versions.

**Note:** This command is not supported for [web apps](../guides/web-apps.md), which have no published versions. Use [`osls rollback`](./rollback.md) instead.

## Options

- `--function` or `-f` The name of the function which should be rolled back. **Required**.
- `--function-version` The version to which the function should be rolled back. **Required**.

## What rollback restores

`osls rollback function` repoints the function to the code and configuration of an existing published Lambda version. It is a code-and-configuration swap only: it does **not** roll back data in DynamoDB, S3, RDS, or any other stateful resource, and it does not touch the rest of your CloudFormation stack.

You can only roll back to a version that was published by a previous `osls deploy`. Functions deployed with `osls deploy function` are not versioned, so they cannot be used as rollback targets. Use [`osls deploy list functions`](./deploy-list.md) to see the versions still available.

## Examples

### AWS

At first you want to run `osls deploy list functions` to see all the deployed functions of your service and their corresponding versions.
After picking a function and the version you can run the `osls rollback function` command to rollback the function.

E.g. `osls rollback function -f my-function --function-version 23` rolls back the function `my-function` to the version `23`.

---

[← All Commands](./README.md) · [Docs Home](../README.md)
