# AWS - Logs

Lets you watch the logs of a specific function.

```bash
osls logs -f hello

# Optionally tail the logs with --tail or -t
osls logs -f hello -t
```

This command returns as many log events as can fit in 1MB (up to 10,000 log events). You can use the `--filter` option to ensure the logs you're looking for are included.

This command can't read Infrequent Access log groups, so for functions with `logGroupClass: infrequent_access` use CloudWatch Logs Insights instead.

## Options

- `--function` or `-f` The function you want to fetch the logs for. **Required**
- `--stage` or `-s` The stage you want to view the function logs for. If not provided, the plugin will use the default stage listed in `serverless.yml`. If that doesn't exist either it'll just fetch the logs from the `dev` stage.
- `--region` or `-r` The region you want to view the function logs for. If not provided, the plugin will use the default region listed in `serverless.yml`. If that doesn't exist either it'll just fetch the logs from the `us-east-1` region.
- `--startTime` A specific unit in time to start fetching logs from (ie: `2010-10-20` or `1469694264`). Here's a list of the supported string formats:

```bash
30s                        # since 30 seconds ago
30m                        # since 30 minutes ago
2h                         # since 2 hours ago
3d                         # since 3 days ago

2013-02-08                 # A calendar date
2013-02-08T09              # An hour time part separated by a T
2013-02-08T09:30           # An hour and minute time part
2013-02-08T09:30:26        # An hour, minute and second time part
2013-02-08T09:30:26.123    # With fractional seconds
2013-02-08T09:30:26+07:00  # With an explicit UTC offset

20130208                   # Basic (short) full date
20130208T08                # Short date and time, hours only
20130208T0809              # Short date and time up to minutes
20130208T080910            # Short date and time up to seconds
20130208T080910.123        # Short date and time up to ms

1469694264                 # Unix epoch time in seconds
1469694264000              # Unix epoch time in milliseconds
```

Dates and times without an explicit UTC offset are interpreted as UTC.

- `--filter` You can specify a filter string to filter the log output. This is useful if you want to to get the `error` logs for example.
- `--tail` or `-t` You can optionally tail the logs and keep listening for new logs in your terminal session by passing this option.
- `--interval` or `-i` If you choose to tail the output, you can control the interval at which osls polls the logs with this option. The default is `1000`ms.

## Examples

### AWS

**Note:** There's a small lag between invoking the function and actually having the log event registered in CloudWatch. So it takes a few seconds for the logs to show up right after invoking the function.

```bash
osls logs -f hello
```

This will fetch the logs from last 10 minutes as startTime was not given.

```bash
osls logs -f hello --startTime 5h
```

This will fetch the logs that happened in the past 5 hours.

```bash
osls logs -f hello --startTime 1469694264
```

This will fetch the logs that happened starting at epoch `1469694264`.

```bash
osls logs -f hello -t
```

osls will tail the CloudWatch log output and print new log messages coming in starting from 10 seconds ago.

```bash
osls logs -f hello --filter serverless
```

This will fetch only the logs that contain the string `serverless`

---

[← All Commands](./README.md) · [Docs Home](../README.md)
