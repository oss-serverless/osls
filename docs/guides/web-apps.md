# AWS Lambda Web Apps

A _web app_ is an HTTP server that runs on AWS Lambda as a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html). There is no handler and there are no events: you deploy an ordinary Node.js server, such as an Express or Fastify app, and Lambda gives it an HTTPS URL, starts as many copies of it as the traffic needs and stops them when it is idle.

Web apps are configured under the top-level `webApps` property, next to `functions`. The property is compatible with the `webApps` property that Serverless Framework v4 documents, so a v4 `webApps` block for a JavaScript server works on osls unchanged. The [differences](#differences-from-serverless-framework-v4) are listed at the end of this guide.

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Writing the server](#writing-the-server)
- [Settings inherited from the provider](#settings-inherited-from-the-provider)
- [Environment variables](#environment-variables)
- [URL](#url)
- [Packaging](#packaging)
- [Deployment bucket](#deployment-bucket)
- [Deploying](#deploying)
- [IAM](#iam)
- [Logs](#logs)
- [VPC](#vpc)
- [CloudFormation resources](#cloudformation-resources)
- [Commands](#commands)
- [Differences from Serverless Framework v4](#differences-from-serverless-framework-v4)

## Quick start

```yaml
# serverless.yml
service: my-web-app

provider:
  name: aws
  region: us-east-1
  deploymentBucket:
    versioning: true # required for web apps, see "Deployment bucket"

webApps:
  api:
    entry: src/server.js
```

```js
// src/server.js
const http = require('http');

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ message: 'Hello from AWS Lambda' }));
});

server.listen(process.env.PORT ?? 3000);
```

`osls deploy` packages the web app, deploys it with the CloudFormation stack of the service and prints its URL:

```
endpoint: https://bcdfghjklmnpqrst.b7t.lambda-web.us-east-1.on.aws
```

The same server runs on your machine with `node src/server.js`.

## Configuration

Each key under `webApps` is the name of a web app. A name contains letters, digits, hyphens and underscores, and cannot also be used under `functions`.

```yaml
# serverless.yml
webApps:
  api:
    # The file that starts the HTTP server, relative to the service directory
    entry: src/server.js
    # Node.js 24 or newer (default: provider.runtime when it is nodejs24.x or newer, otherwise nodejs24.x)
    runtime: nodejs24.x
    # The name of the web function in AWS (default: ${service}-${stage}-${key})
    name: ${sls:stage}-api
    # Up to 256 characters
    description: Storefront API
    # Seconds a request may take, 3-900 (default: provider.timeout when it is set, otherwise the AWS default of 30)
    timeout: 60
    # Requests a single execution environment serves at once, 1-128 (default: the AWS default of 64)
    maxConcurrency: 32
    # Merged over provider.environment
    environment:
      TABLE_NAME: !Ref OrdersTable
    # Log levels, case-insensitive (default: the provider.logs.lambda levels, otherwise the AWS default of INFO)
    logs:
      applicationLogLevel: info # trace, debug, info, warn, error or fatal
      systemLogLevel: info # debug, info or warn
    # Retention of both log groups of the web app (default: provider.logRetentionInDays)
    logRetentionInDays: 14
    # Data protection policy of both log groups of the web app (default: provider.logDataProtectionPolicy)
    logDataProtectionPolicy:
      Name: data-protection-policy
      Version: '2021-06-01'
      Statement: []
    # The execution role (default: the role of the service, see "IAM")
    role: arn:aws:iam::123456789012:role/my-role
    # Key that encrypts the environment variables and the code that AWS Lambda prepares (default: provider.kmsKeyArn)
    kmsKeyArn: arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab
    # Merged over provider.tags
    tags:
      team: web
    package:
      # Applied after the service-level package.patterns
      patterns:
        - '!tests/**'
      # A prebuilt zip file that is deployed as it is, instead of packaging the service directory
      artifact: build/api.zip
    # true (the default) for a public endpoint, or its settings. false is not accepted
    url:
      # Requires requests signed with IAM credentials
      authorizer: aws_iam
      # Most execution environments the endpoint may run at once, 2-10000
      maxEnvironments: 50
      # Most requests per second the endpoint accepts
      rateLimit: 2000
```

Only `entry` is required.

## Writing the server

A web app is a plain Node.js HTTP server. Lambda does not call a handler: it starts your program and forwards each HTTP request to the address the server listens on. Three rules follow from that.

- **Listen on the address Lambda assigns.** Lambda passes it in the `AWS_LAMBDA_HTTP_ENDPOINT` environment variable, as `host:port`. osls adds a small start file to the package (see below) that copies it to `PORT` and `HOSTNAME`, the variables most servers and frameworks read already, so `app.listen(process.env.PORT)` is enough. A server that listens on `127.0.0.1` or `localhost` only is not reachable, and requests fail with HTTP 502.
- **Start listening within 10 seconds.** Do slow initialization after `listen`, or lazily.
- **Run on Linux arm64 with Node.js 24.** Native dependencies have to be built for that platform. Every execution environment has 2 vCPUs and 2 GB of memory, which is not configurable, so `memorySize` and `architecture` do not exist for web apps.

The endpoint speaks HTTP/1.1 and streams request and response bodies. WebSocket upgrades are not supported, server-sent events are. Lambda adds no CORS headers, so handle CORS in your app.

### The start file

Lambda loads one file of the package, which it imports as a module. So that a server written for `node src/server.js` works unchanged, osls adds the file `__osls_web_app_start.mjs` to the root of the package and points Lambda at it through the `AWS_LAMBDA_NODEJS_ENTRYPOINT` environment variable. The start file:

1. sets `PORT` and `HOSTNAME` from `AWS_LAMBDA_HTTP_ENDPOINT`,
2. sets `process.argv[1]` to your `entry`,
3. runs your `entry` as the main script, the way `node` does. In a CommonJS `entry`, `require.main === module` is therefore true. An ES module `entry` works as well, including top-level `await`.

The start file is not added to a [prebuilt `package.artifact`](#prebuilt-artifact).

## Settings inherited from the provider

A web app takes these `provider` settings, and a value on the web app wins:

- `environment`, merged under the `environment` of the web app.
- `tags`, merged under the `tags` of the web app.
- `iam.role`: web apps use the execution role of the service, see [IAM](#iam).
- `kmsKeyArn`, `logRetentionInDays` and `logDataProtectionPolicy`.
- `logs.lambda.applicationLogLevel` and `logs.lambda.systemLogLevel`, each on its own. A web app always logs JSON, so they apply whatever `logs.lambda.logFormat` says.
- `timeout`, when it is set. A service with `provider.timeout: 6` for its functions gives its web apps 6 seconds too, unless they set their own `timeout`. A `provider.timeout` below 3 is rejected for a web app that does not set its own.
- `runtime`, when it is `nodejs24.x` or newer. With any other `provider.runtime`, such as `nodejs22.x` or `python3.14`, web apps run on `nodejs24.x`.

Other `provider` settings for functions do not apply to web apps: `memorySize`, `architecture`, `vpc`, `layers`, `tracing`, `runtimeManagement`, `versionFunctions`, and the `logFormat`, `logGroup` and `logGroupClass` settings of `logs.lambda`.

## Environment variables

`environment` takes the same values as for functions, including CloudFormation intrinsic functions. A few rules are specific to web apps:

- `PORT`, `HOSTNAME` and `AWS_LAMBDA_NODEJS_ENTRYPOINT` are set by osls and cannot be set in the `environment` of a web app. When `provider.environment` sets one of them for the functions of the service, the web app gets the value of osls instead.
- Names that Lambda reserves for web functions, such as `AWS_REGION` or `AWS_LAMBDA_HTTP_ENDPOINT`, are rejected, in `provider.environment` too.
- For web functions Lambda only accepts names that start with a letter, values of 1 to 4,096 characters, and 32 KB in total. osls checks the names and the literal values when it packages.

## URL

Every web app gets one HTTPS endpoint, and its URL stays the same across deployments. It is public by default, like a function with `url: true`, and your app decides who may do what. Because a web app without an endpoint cannot receive requests, `url: false` is not accepted.

```yaml
webApps:
  admin:
    entry: src/admin.js
    url:
      authorizer: aws_iam
      maxEnvironments: 50
      rateLimit: 2000
```

- `authorizer: aws_iam` makes Lambda reject requests that are not signed with [Signature Version 4](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html) for the `lambda` service by an identity that is allowed to call `lambda:InvokeWebFunctionEndpoint` on the endpoint. Signed requests need the `X-Amz-Content-SHA256` header.
- `maxEnvironments` limits how many execution environments the endpoint runs at once, and `rateLimit` how many requests per second it accepts. Requests above a limit get HTTP 429. AWS accepts `0` (which blocks all traffic), 100 to 1,000 in steps of 100, and 2,000 to 10,000 in steps of 1,000 as `rateLimit`. Removing a limit from `serverless.yml` removes it from the endpoint.

The endpoint is named `main`, is of the `HomeRegion` type and sends all traffic to the revision of the latest deployment. Custom domains are not part of Lambda Web Functions. Put Amazon CloudFront in front of the endpoint for a custom domain, caching or AWS WAF, using [`resources`](./resources.md).

## Packaging

Each web app is packaged into a zip file of its own, whatever `package.individually` says. The zip is built like the package of a function:

- It contains the service directory, without development dependencies and the files osls always excludes (see [Packaging](./packaging.md)).
- The service-level `package.patterns` apply first, then the `package.patterns` of the web app.
- osls adds [the start file](#the-start-file).

osls does not bundle or compile. A TypeScript `entry` is rejected: compile it first and point `entry` at the JavaScript output.

Because the whole service directory is packaged by default, a web app also ships the code of the functions and the other web apps of the service, and a change to any file changes its package. Give each web app the files it needs:

```yaml
webApps:
  api:
    entry: api/server.js
    package:
      patterns:
        - '!**'
        - 'api/**'
        - 'node_modules/**'
```

Packaging fails when the `entry` file is not among the packaged files, or when the package is larger than the 512 MiB that Lambda accepts for a web function once unzipped.

### Prebuilt artifact

`package.artifact` deploys a zip file that you built yourself, exactly as it is:

```yaml
webApps:
  site:
    entry: server.js # path inside the zip file
    package:
      artifact: build/site.zip
```

In this case `entry` is the path of the file inside the zip, and packaging fails when the zip does not contain it. No start file is added: Lambda loads `entry` directly, `PORT` and `HOSTNAME` are not set, and the server reads `AWS_LAMBDA_HTTP_ENDPOINT` itself:

```js
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? 'localhost:3000';
const separatorIndex = endpoint.lastIndexOf(':');
server.listen(Number(endpoint.slice(separatorIndex + 1)), endpoint.slice(0, separatorIndex));
```

The artifact has to be a local file. An S3 location is not supported for web apps.

## Deployment bucket

Lambda does not copy the code of a web app. It reads the zip file from the deployment bucket for as long as the revision that uses it exists, which puts two requirements on the bucket: it has to be **versioned**, and its bucket policy has to let the Lambda service read it.

### Bucket managed by osls

Set `provider.deploymentBucket.versioning`:

```yaml
provider:
  name: aws
  deploymentBucket:
    versioning: true
```

osls refuses to package a service with web apps without it. It is not turned on silently, because `osls remove` relies on the same setting to empty a versioned bucket. For a service that is already deployed without versioning, `osls deploy` enables versioning on the bucket before it uploads the code.

osls adds the statement that Lambda needs to the bucket policy, so `provider.deploymentBucket.skipPolicySetup` cannot be combined with web apps.

### Bucket of your own

A bucket that you name in `provider.deploymentBucket` (or `provider.deploymentBucket.name`) is never modified by osls. Before deploying web apps to it:

1. Enable versioning on the bucket. `osls deploy` checks this and stops when the bucket is not versioned. Set `provider.deploymentBucket.versioning: true` next to `name` as well, so that `osls remove` deletes every version of the objects of the service instead of leaving them behind as noncurrent versions.
2. Add this statement to its bucket policy, with your bucket name, Region, account ID and the names of the web functions (`<service>-<stage>-<key>` unless `name` is set, or `*` for all of them):

   ```json
   {
     "Effect": "Allow",
     "Principal": { "Service": "lambda.amazonaws.com" },
     "Action": ["s3:GetObject", "s3:GetObjectVersion"],
     "Resource": "arn:aws:s3:::my-deployment-bucket/*",
     "Condition": {
       "ArnLike": {
         "aws:SourceArn": "arn:aws:lambda:us-east-1:123456789012:web-function/my-service-dev-api/revision/*"
       }
     }
   }
   ```

   osls cannot check the bucket policy. Without the statement the deployment fails when CloudFormation creates the revision.

When the bucket encrypts objects with a KMS key (`serverSideEncryption: aws:kms`), the key policy has to allow `lambda.amazonaws.com` to call `kms:Decrypt` as well.

### Where the code is stored

The zip of a web app is uploaded to `<deploymentPrefix>/<service>/<stage>/web-apps/<key>-<sha256>.zip`, where the last part is the SHA-256 hash of the zip file. The name depends on the content alone, so:

- `osls deploy` checks whether the object exists and uploads the zip only when it does not.
- A deployment that does not change the web app leaves its revision, and the execution environments that run it, alone.
- The zips are stored outside of the directories of the individual deployments, so the cleanup of old deployments (`maxPreviousDeploymentArtifacts`) never deletes them. Deleting the zip of a revision that is in use breaks it permanently.

Zips of earlier versions of a web app are therefore kept until `osls remove` deletes them with everything else under the service prefix. Their size is the size of your packages, and you can delete the ones that no deployment you might roll back to refers to.

## Deploying

`osls deploy` deploys web apps with the CloudFormation stack of the service. The code and the settings of a web app make up a _revision_, which cannot be changed. A deployment that changes either creates a new revision, moves the traffic of the endpoint to it once it is ready, and deletes the previous revision. The URL stays the same.

- Lambda does not check that the server starts. A deployment succeeds when the revision is created, also when the server crashes on startup, so send the URL a request after deploying.
- Web apps do not change when a deployment without changes is skipped: as before, that takes a service with functions, all of which the previous deployment updated. In the other cases, which include every service without functions, the deployment runs and CloudFormation finds nothing to change.
- `osls rollback` redeploys the template of an earlier deployment, which creates a revision from the code of that deployment. This needs no special handling because the zips of web apps are kept.
- `osls remove` deletes the web functions with the stack, and the uploaded code with the rest of the deployment bucket content of the service.
- `osls deploy function` does not deploy web apps, see [Commands](#commands).

## IAM

Web apps use the execution role of the service, the same role as the functions (see [IAM](./iam.md)):

- Statements in `provider.iam.role.statements` and policies in `provider.iam.role.managedPolicies` apply to functions and web apps alike.
- The default role is created for a service that only has web apps too, and is allowed to write to the log groups of the web apps.
- When `provider.iam.role` refers to an existing role, web apps use that role.
- `role` on a web app refers to a role of your own, in the same forms as `role` on a function: an ARN, the logical ID of a role in `resources`, or a `Fn::GetAtt`, `Fn::ImportValue` or `Fn::Sub` reference. The default role is not created when every function and every web app of the service has a `role`.

A role of your own has to trust `lambda.amazonaws.com` and to allow `logs:CreateLogStream` and `logs:PutLogEvents` on both [log groups](#logs) of the web app.

With `kmsKeyArn`, the default role is allowed to call `kms:Decrypt` on the key, as it is for functions. The key policy also has to allow the Lambda service to use the key, see [Data protection for Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-encryption.html).

## Logs

A web app writes JSON log lines to two CloudWatch log groups:

- `/aws/lambda/web/<name>.local`, where lines arrive first,
- `/aws/lambda/web/<name>`, to which Lambda copies them.

`<name>` is the `name` of the web app, `<service>-<stage>-<key>` by default. osls creates both log groups in the stack with the `logRetentionInDays` and `logDataProtectionPolicy` of the web app, and they are deleted with the stack. The settings `disableLogs`, `logs.logFormat`, `logs.logGroup` and `logs.logGroupClass` of functions do not exist for web apps.

`osls logs --web-app <key>` reads the `.local` log group:

```bash
osls logs --web-app api --tail
```

## VPC

A web app reaches public IPv4 addresses directly. To reach resources in a VPC, a revision needs an `AWS::Lambda::NetworkConnector`, which osls does not create: `vpc` on a web app is rejected, and `provider.vpc` applies to functions only.

You can define the connector in `resources` and attach its latest version to the revision yourself. Resources under `resources.Resources` are merged deeply into the ones osls generates, so naming the revision there adds the connector to its `ServiceConfig`:

```yaml
resources:
  Resources:
    ApiNetworkConnector:
      Type: AWS::Lambda::NetworkConnector
      Properties:
        OperatorRole: !GetAtt ApiNetworkConnectorRole.Arn
        Configuration:
          VpcEgressConfiguration:
            SubnetIds: [subnet-0a1b2c3d4e5f60718, subnet-0f1e2d3c4b5a69788]
            SecurityGroupIds: [sg-0123456789abcdef0]
            NetworkProtocol: IPv4
            AssociatedComputeResourceTypes: [WebFunction]
    ApiWebFunctionRevision:
      Type: AWS::Lambda::WebFunctionRevision
      Properties:
        ServiceConfig:
          EgressNetworkConnectorArn: !GetAtt ApiNetworkConnector.LatestVersionArn
```

Do not use `resources.extensions` for this: it replaces a property as a whole, here the complete `ServiceConfig`. See [Configuring networking for AWS Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html) for the operator role (`ApiNetworkConnectorRole` above) and the requirements on the subnets.

## CloudFormation resources

For a web app with the key `api`, osls adds these resources to the stack. `Api` is the normalized key, as for functions (`my-app` becomes `MyDashapp`).

| Logical ID                    | Type                               | Purpose                                         |
| ----------------------------- | ---------------------------------- | ----------------------------------------------- |
| `ApiWebFunction`              | `AWS::Lambda::WebFunction`         | The web function: its name and tags             |
| `ApiWebFunctionRevision`      | `AWS::Lambda::WebFunctionRevision` | The code and settings of the current deployment |
| `ApiWebFunctionEndpoint`      | `AWS::Lambda::WebFunctionEndpoint` | The HTTPS endpoint                              |
| `ApiWebFunctionLogGroup`      | `AWS::Logs::LogGroup`              | `/aws/lambda/web/<name>`                        |
| `ApiWebFunctionLocalLogGroup` | `AWS::Logs::LogGroup`              | `/aws/lambda/web/<name>.local`                  |

The stack output `ApiWebFunctionUrl` holds the URL and is exported as `sls-<service>-<stage>-ApiWebFunctionUrl`. Elsewhere in the template, reference the URL with `!GetAtt ApiWebFunctionEndpoint.DomainName` and the ARN of the web function with `!Ref ApiWebFunction`.

To set properties that `webApps` does not cover, name the resource under `resources.Resources` with its `Type`, as the [VPC](#vpc) example does: it is merged deeply into the generated resource. [`resources.extensions`](./resources.md#override-aws-cloudformation-resource) replaces properties as a whole, which suits top-level properties only. Every property of a revision is fixed once it is created, so any change to `ApiWebFunctionRevision` replaces the revision.

Lambda Web Functions are available in a limited set of Regions. Besides the permissions that every deployment needs, the identity that deploys needs the Lambda permissions for web functions, their revisions and their endpoints (such as `lambda:CreateWebFunctionRevision`), `iam:PassRole` for the execution role, and `s3:GetBucketVersioning` on the deployment bucket (and `s3:PutBucketVersioning` when the bucket of the stack is not versioned yet). See the [AWS documentation](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html).

## Commands

| Command                                          | Web apps                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `osls package`, `osls deploy`                    | Package and deploy the web apps with the service                                   |
| `osls info`                                      | Lists the URL of each web app under `endpoints`                                    |
| `osls logs --web-app <key>`                      | Prints the logs of a web app                                                       |
| `osls rollback`, `osls remove`                   | Work as for every other resource of the stack                                      |
| `osls deploy function`, `osls rollback function` | Not supported: a revision is only created by a deployment with `osls deploy`       |
| `osls invoke`, `osls invoke local`               | Not supported: send the URL an HTTP request, or start the `entry` file with `node` |
| `osls metrics`                                   | Shows the metrics of functions only                                                |

## Differences from Serverless Framework v4

osls implements `webApps` independently, from the public documentation of AWS and of Serverless Framework v4. A `webApps` block behaves the same on both, with these exceptions:

- **No bundling.** `build` is rejected, and so is a TypeScript `entry`. osls has no esbuild integration: build first and point `entry` at JavaScript.
- **No dev mode.** `dev` is rejected.
- **No role per web app.** `iam` is rejected. Web apps use the role of the service or their `role`. A `role` that is not an ARN is the logical ID of a role in `resources`, as it is for functions in osls.
- **No VPC setting.** `vpc` is rejected and `provider.vpc` is not applied to web apps, see [VPC](#vpc).
- **No custom domains.** osls has no `provider.domains`.
- **`provider.deploymentBucket.versioning: true` is required** for the bucket of the stack, and osls does not check the policy of a bucket of your own.
- **`package.artifact` cannot be an S3 location.**
- **Names are not shortened.** A `name`, or a default name, of more than 64 characters is rejected.
- **The start file has another name**, `__osls_web_app_start.mjs`, and starts an ES module `entry` as the main script too, so `import.meta.main` is `true` there.
- **Code is stored under `web-apps/`** in the deployment bucket, not `webapps/`.
- **`osls invoke --web-app` does not exist**, and neither do the `diff` and `dev` commands.
- **Tag values are strings.** CloudFormation references are not accepted in `tags`, as for functions.
- **A service without functions is deployed every time**, see [Deploying](#deploying).
