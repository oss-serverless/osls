# AWS - Metrics

Lets you watch the metrics of a specific function.

```bash
osls metrics
```

The metrics of [web apps](../guides/web-apps.md) are not included. AWS Lambda publishes them in the `AWS/Lambda/Web` CloudWatch namespace.

## Options

- `--function` or `-f` The function you want to fetch the metrics for.
- `--stage` or `-s` The stage you want to view the function metrics for. If not provided, the plugin will use the default stage listed in `serverless.yml`. If that doesn't exist either it'll just fetch the metrics from the `dev` stage.
- `--region` or `-r` The region you want to view the function metrics for. If not provided, the plugin will use the default region listed in `serverless.yml`. If that doesn't exist either it'll just fetch the metrics from the `us-east-1` region.
- `--startTime` A specific unit in time to start fetching metrics from (ie: `2010-10-20`, `1469705761`, `30m` (30 minutes ago), `2h` (2 hours ago) or `3d` (3 days ago)). Accepts the same formats as [`osls logs --startTime`](./logs.md): relative time, ISO 8601 dates and datetimes (interpreted as UTC unless an explicit offset is given), or Unix epoch time in seconds or milliseconds. Defaults to 24h ago.
- `--endTime` A specific unit in time to end fetching metrics from (ie: `2010-10-21` or `1469705761`). Accepts the same formats as `--startTime`. Defaults to now.

## Examples

**Note:** There's a small lag between invoking the function and actually having access to the metrics. It takes a few seconds for the metrics to show up right after invoking the function.

### See service wide metrics for the last 24h

```bash
osls metrics
```

Displays service wide metrics for the last 24h.

### See service wide metrics for a specific timespan

```bash
osls metrics --startTime 2016-01-01 --endTime 2016-01-02
```

Displays service wide metrics for the time between January 1, 2016 and January 2, 2016.

### See all metrics for the function `hello` of the last 24h

```bash
osls metrics --function hello
```

Displays all `hello` function metrics for the last 24h.

### See metrics for the function `hello` of a specific timespan

```bash
osls metrics --function hello \
  --startTime 2016-01-01 \
  --endTime 2016-01-02
```

Displays all `hello` function metrics for the time between January 1, 2016 and January 2, 2016.

---

[← All Commands](./README.md) · [Docs Home](../README.md)
