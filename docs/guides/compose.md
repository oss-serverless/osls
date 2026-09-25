# Composing services

Deploying multiple services in a monorepository is a very common pattern across larger teams. osls compose is meant to simplify deploying and orchestrating multiple services:

- Deploy multiple services in parallel
- Deploy services in a specific order
- Share outputs from one service to another
- Run commands across multiple services

## Setup

Assuming you have an application containing multiple services, for example:

```text
my-app/
  service-a/
    src/
      ...
    serverless.yml
  service-b/
    src/
      ...
    serverless.yml
```

You can create a `serverless-compose.yml` file at the root of your monorepository.

In that file, you can reference existing services by their relative paths:

```yaml
# serverless-compose.yml
services:
  service-a:
    path: service-a

  service-b:
    path: service-b
    # If the file is not named "serverless.yml":
    # config: serverless.api.yml
```

_Note: JS/TS configuration files are also supported (`serverless-compose.{yml,ts,js,json}`). JavaScript and TypeScript osls compose configuration files are executed by Node.js when loaded, so use them only from trusted projects._

## Usage

To deploy all services, instead of running `osls deploy` in each service, you can now deploy all services at once by running `osls deploy` at the root:

```bash
$ osls deploy

Deploying myapp to stage dev

    ✔  service-a › deployed › 15s
    ✔  service-b › deployed › 31s

```

In order to limit the number of services that are deployed concurrently, use `--max-concurrency` flag:

```bash
$ osls deploy --max-concurrency 5
```

### Service dependencies and variables

Service variables let us:

- order deployments
- inject outputs from one service into another

This is possible via the `${service.output}` syntax. For example:

```yaml
services:
  service-a:
    path: service-a

  service-b:
    path: service-b
    params:
      queueUrl: ${service-a.queueUrl}
```

Let's break down the example above into 3 steps:

1. `${service-a.queueUrl}` will resolve to the `queueUrl` output of the `service-a` service.

   The outputs of a service are resolved from its **CloudFormation outputs**. Here is how we can expose the `queueUrl` output in the `service-a/serverless.yml` config:

   ```yaml
   # service-a/serverless.yml
   # ...

   resources:
     Resources:
       MyQueue:
         Type: AWS::SQS::Queue
         # ...
     Outputs:
       queueUrl:
         Value: !Ref MyQueue
   ```

2. Because of the dependency introduced by the variable, `osls deploy` will automatically **deploy `service-a` first, and then `service-b`.**

3. The value will be passed to `service-b` [as a parameter](./parameters.md) named `queueUrl`. Parameters can be referenced in osls configuration via the `${param:xxx}` syntax:

   ```yaml
   # service-b/serverless.yml
   provider:
     ...
     environment:
       # Here we inject the queue URL as a Lambda environment variable
       SERVICE_A_QUEUE_URL: ${param:queueUrl}
   ```

Cross-service variables are a great way to share API URLs, queue URLs, database table names, and more, without having to hardcode resource names or use SSM.

### Explicit dependencies

Alternatively, it is possible to specify **explicit dependencies** without variables via the `dependsOn` option. For example:

```yaml
services:
  service-a:
    path: service-a

  service-b:
    path: service-b
    dependsOn: service-a

  service-c:
    path: service-c

  service-d:
    path: service-d
    dependsOn:
      - service-a
      - service-c
```

As seen in the above example, it is possible to configure more than one dependency by providing `dependsOn` as a list.

Dependencies, explicit or from variables, only order the commands: a dependent service starts deploying as soon as the services it depends on have finished. With [`provider.deploymentMode: express`](./deploying.md#deployment-mode) on an upstream service, its stack completes before its resources have stabilized, so a dependent service that uses those resources while it deploys (an event source mapping on a stream, a custom resource that calls an endpoint, or networking such as a VPC and NAT gateway, for example) can fail and need to be deployed again. Removals run in reverse order, and an express removal returns while resources such as VPC network interfaces may not have been released yet, so removing the upstream service straight afterwards can fail with a dependency error until they are gone.

### Global commands

On top of `osls deploy`, the following commands can be run globally across all services:

- `osls logs` to fetch logs from **all functions across all services**
- `osls info` to view all services info
- `osls remove` to remove all services
- `osls outputs` to view all services outputs
- `osls refresh-outputs` to refresh outputs of all services

For example, it is possible to tail logs for all functions at once:

```bash
$ osls logs --tail

service-a › users › START
service-a › users › 2021-12-31 16:54:14  INFO  New user created
service-a › users › END Duration: 13 ms ...
service-b › billing › START
service-b › billing › 2021-12-31 16:54:14  INFO  New subscription enabled
service-b › billing › END Duration: 7 ms ...

    ⠴  service-a › logs › 2s
    ⠦  service-a › logs › 2s

```

### Service-specific commands

It is possible to run commands for a specific service only. For example to deploy only a specific service:

```bash
osls deploy --service=service-a

# Shortcut alternative
osls service-a:deploy
```

Or tail logs of a single function:

```bash
osls logs --service=service-a --function=index

# Shortcut alternative
osls service-a:logs --function=index
```

All osls commands are supported **only via service-specific commands**, including custom commands from plugins, for example:

```bash
osls service-a:offline
```

### Service-specific commands when using parameters

The `osls service-a:deploy` command is the equivalent of running `osls deploy` in service-a's directory. Both can be used.

However, if "service-a" uses `${param:xxx}` to reference parameters injected by `serverless-compose.yml`, then `osls service-a:deploy` must be used. Indeed, `${param:xxx}` cannot be resolved outside of osls compose.

In these cases, you must run all commands from the root: `osls service-a:deploy`.

## Configuration

The following variables are supported in `serverless-compose.yml`:

- [`${sls:stage}`](./variables.md#referencing-osls-core-variables)
- [`${env:xxx}`](./variables.md#referencing-environment-variables)

### Differences with `serverless.yml`

The `serverless-compose.yml` and `serverless.yml` files have different syntaxes and features.

Unless documented here, expect `serverless.yml` features to not be supported in `serverless-compose.yml`. For example, it is not possible to include plugins or use most `serverless.yml` variables (like `${self:`, `${opt:`, etc.) inside `serverless-compose.yml`.

## Security model

The [osls security model](./security.md) applies to Compose as well, with a few Compose-specific notes:

- A Compose configuration is code. The configuration can also be written as `serverless-compose.js` or `serverless-compose.ts`, both of which execute on load, and deploying a project runs the osls CLI in each service directory, which in turn loads each service's `serverless.yml`. Do not run projects from untrusted sources.
- Values resolved with `${env:...}` become part of the configuration, and values passed between services flow through command line parameters of the spawned osls processes. Treat retained logs of Compose runs, in particular verbose output, as potentially secret-bearing.
- Service outputs are stored in the local state directory (`.serverless/`) and, when remote state storage is configured, in the state S3 bucket. If outputs contain sensitive values, protect the state bucket and local state files like any other deployment artifact.

## Refreshing outputs

The outputs of a service are stored locally (in the `.serverless/` directory). If a colleague deployed changes that changed the outputs of a service, you can refresh your local state via the `refresh-outputs` command:

```bash
osls refresh-outputs
```

This command has no impact on deployed services, it can be run at any time without unintended side effects.

## Removing services

To delete the whole project (and all its services), run `osls remove` in the same directory as `serverless-compose.yml`. This will run [`osls remove`](../cli-reference/remove.md) in each service directory.

To delete only one service:

1. make sure no other service depends on it (else these services will be broken)
2. run `osls <service-name>:remove`
3. then remove the service from `serverless-compose.yml`

If you remove the service from `serverless-compose.yml` without doing step 1 first, the service will still be deployed in your AWS account.

Remember to do this for every stage you may have previously deployed.

## FAQ

### Running behind a proxy

Compose honors the same proxy, custom certificate authority, and timeout environment variables as osls (`HTTP_PROXY`/`HTTPS_PROXY`, `ca`/`cafile`, and `AWS_CLIENT_TIMEOUT`) for its own AWS requests, such as remote state access. The services it deploys are handled by the osls CLI, which reads the same variables. See [Running behind a proxy](./credentials.md#running-behind-a-proxy).

### Multi-region deployments

> Is multi-region deployment possible via osls compose?

It is possible to deploy different services to different regions. For example, deploy service `frontend` to us-east-1 and service `backend` to eu-west-3.

However, osls compose currently does not support deploying _the same service_ to multiple regions. The reason is that each service is packaged in the `.serverless/` directory. If the same service was to be deployed in parallel to different regions, package artifacts would conflict and overwrite each other.
