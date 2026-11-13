# AWS Lambda Web Apps

A _web app_ is an HTTP server that runs on AWS Lambda as a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html). There is no handler and there are no events: you deploy an ordinary Node.js server, such as an Express or Fastify app, and Lambda gives it an HTTPS URL, starts as many copies of it as the traffic needs and stops them when it is idle.

Web apps are configured under the top-level `webApps` property, next to `functions`. The property and its settings follow the `webApps` property that Serverless Framework v4 documents, so most v4 `webApps` blocks for a JavaScript server can be deployed with osls as they are. What osls does not support, does differently or adds is listed under [Differences from Serverless Framework v4](#differences-from-serverless-framework-v4).

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Writing the server](#writing-the-server)
- [Provider settings](#provider-settings)
- [Environment variables](#environment-variables)
- [URL](#url)
- [Multi-Region endpoints](#multi-region-endpoints)
- [Custom domains and CloudFront](#custom-domains-and-cloudfront)
- [Packaging](#packaging)
- [Deployment bucket](#deployment-bucket)
- [Deploying](#deploying)
- [IAM](#iam)
- [Logs](#logs)
- [VPC](#vpc)
- [CloudFormation resources](#cloudformation-resources)
- [Permissions to deploy](#permissions-to-deploy)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)
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

Each key under `webApps` defines one web app. A key contains letters, digits, hyphens and underscores. Only `entry` is required.

```yaml
# serverless.yml
webApps:
  api:
    # Path of the script that launches the HTTP server, from the service directory
    entry: src/server.js
    # AWS Lambda runs web functions on nodejs24.x only. Left out, provider.runtime is used if it is nodejs24.x
    # or later, and nodejs24.x if it is anything else. A later nodejsNN.x fails until Lambda supports it
    runtime: nodejs24.x
    # What the web function is called in AWS. Left out: ${service}-${stage}-${key}. See "Names"
    name: ${sls:stage}-api
    # Free text, 256 characters at most
    description: Storefront API
    # How long one request may run, in seconds, from 3 to 900.
    # Left out: provider.timeout if the service sets it, or else the 30 seconds of AWS
    timeout: 60
    # How many requests one execution environment handles in parallel, from 1 to 128. Left out: the 64 of AWS
    maxConcurrency: 32
    # Variables for this web app. They are added to provider.environment and win over it
    environment:
      TABLE_NAME: !Ref OrdersTable
    # Upper or lower case. A level that is left out comes from provider.logs.lambda, or is INFO
    logs:
      applicationLogLevel: info # trace, debug, info, warn, error or fatal
      systemLogLevel: info # debug, info or warn
    # Days to keep the logs in both log groups of the web app. Left out: provider.logRetentionInDays
    logRetentionInDays: 14
    # Data protection policy for both log groups. Left out: provider.logDataProtectionPolicy
    logDataProtectionPolicy:
      Name: data-protection-policy
      Version: '2021-06-01'
      Statement: []
    # A role of your own instead of the execution role of the service, see "IAM"
    role: arn:aws:iam::123456789012:role/my-role
    # KMS key for the environment variables and for the copy of the code that AWS Lambda prepares.
    # Left out: provider.kmsKeyArn. The key policy has to let AWS Lambda use the key, see "IAM"
    kmsKeyArn: arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab
    # Tags for this web app. They are added to provider.tags and win over them
    tags:
      team: web
    package:
      # Evaluated once the service-level package.patterns have been
      patterns:
        - '!tests/**'
      # Skip packaging and upload this zip file untouched
      artifact: build/api.zip
    # Settings of the HTTPS endpoint. Leaving url out, or url: true, gives an endpoint without them. See "URL"
    url:
      # Only let requests through that carry an AWS signature
      authorizer: aws_iam
      # Upper limit for the execution environments running at the same time, from 2 to 10000
      maxEnvironments: 50
      # Upper limit for the requests per second
      rateLimit: 2000
      # HomeRegion (when left out), MultiRegion or PerRegion, see "Multi-Region endpoints"
      type: MultiRegion
      # The Regions a MultiRegion or PerRegion endpoint serves besides the Region of the service
      regions:
        - us-west-2
      # What the endpoint is called. Left out: main
      name: global
```

### Names

The `name` of a web app is the name of its web function in AWS, `<service>-<stage>-<key>` by default. It is at most 64 characters long, contains letters, digits, hyphens and underscores, and starts and ends with a letter or digit. Two web apps of a service cannot have the same name. A function may have the name of a web app, because AWS keeps the names of functions and of web functions apart.

AWS does not accept the same web function name in two Regions of an account, so deploying one service and stage to a second Region fails with the default names (see [Troubleshooting](#troubleshooting)). Put the Region in the name, or serve several Regions from one stack with a [multi-Region endpoint](#multi-region-endpoints):

```yaml
webApps:
  api:
    entry: src/server.js
    name: ${self:service}-${sls:stage}-${aws:region}-api
```

## Writing the server

A web app is a plain Node.js HTTP server. Lambda does not call a handler: it starts your program and forwards each HTTP request to the address the server listens on. Three rules follow from that.

- **Listen on the address Lambda assigns.** The address is in the `AWS_LAMBDA_HTTP_ENDPOINT` environment variable, in the form `host:port`. Most servers and frameworks read `PORT` and `HOSTNAME` instead, so osls ships [a start file](#the-start-file) that fills those two in, and `app.listen(process.env.PORT)` is enough. A server that listens on `127.0.0.1` or `localhost` only is not reachable, and requests fail with HTTP 502.
- **Start listening within 10 seconds.** Do slow initialization after `listen`, or lazily.
- **Run on Linux arm64 with Node.js 24.** Native dependencies have to be built for that platform. Every execution environment has 2 vCPUs and 2 GB of memory, which is not configurable, so `memorySize` and `architecture` do not exist for web apps.

Requests reach the server over HTTP/1.1, and both request and response bodies are streamed, so server-sent events work. A WebSocket upgrade is refused. If browsers on other origins call the web app, the app has to send the CORS headers itself, because Lambda sends none.

### The start file

Lambda loads one file of the package, and osls makes that file `__osls_web_app_start.mjs`, which it writes to the root of the package and names in the `AWS_LAMBDA_NODEJS_ENTRYPOINT` environment variable. It exists so that a server written for `node src/server.js` needs no changes for Lambda, and does three things:

1. It splits `AWS_LAMBDA_HTTP_ENDPOINT` into `HOSTNAME` and `PORT`.
2. It puts the path of your `entry` in `process.argv[1]`.
3. It hands your `entry` to Node.js as the main script, exactly as `node <entry>` would. The usual `if (require.main === module)` guard of a CommonJS server therefore passes, and an ES module `entry` (top-level `await` included) sees `import.meta.main` as true.

Should a future Node.js runtime no longer offer the internal call that step 3 relies on, the start file imports the `entry` instead. The server still starts, but is then not the main script.

The start file is not added to a [prebuilt `package.artifact`](#prebuilt-artifact).

## Provider settings

These `provider` settings also apply to web apps. A value on the web app takes precedence.

| `provider` setting                                              | Effect on web apps                                                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `environment`                                                   | The variables of the web app are merged over it, see [Environment variables](#environment-variables) |
| `tags`                                                          | The `tags` of the web app are merged over it                                                         |
| `iam.role`                                                      | Web apps use the execution role of the service, see [IAM](#iam)                                      |
| `kmsKeyArn`, `logRetentionInDays`, `logDataProtectionPolicy`    | Used unless the web app sets its own                                                                 |
| `logs.lambda.applicationLogLevel`, `logs.lambda.systemLogLevel` | Each level is used unless the web app sets it. Web apps always log JSON, whatever `logFormat` is     |
| `timeout`                                                       | Used when it is set. A value below 3 is an error for a web app without a `timeout` of its own        |
| `runtime`                                                       | Used when it is `nodejs24.x` or newer. With any other value web apps run on `nodejs24.x`             |

Note the `timeout` row: a service that sets `provider.timeout: 10` with its functions in mind limits the requests of its web apps to 10 seconds as well.

The other `provider` settings for functions leave web apps alone: `memorySize`, `architecture`, `vpc`, `layers`, `tracing`, `runtimeManagement`, `versionFunctions`, and the `logFormat`, `logGroup` and `logGroupClass` settings of `logs.lambda`.

## Environment variables

`environment` takes the same values as for functions, including CloudFormation intrinsic functions. A few rules are specific to web apps:

- `PORT`, `HOSTNAME` and `AWS_LAMBDA_NODEJS_ENTRYPOINT` belong to osls and the start file. Setting one of them in the `environment` of a web app is an error. A value for them in `provider.environment`, where the functions of the service may need it, is ignored for web apps. The exception is a [prebuilt `package.artifact`](#prebuilt-artifact), which has no start file: there osls only sets `AWS_LAMBDA_NODEJS_ENTRYPOINT`, and `PORT` and `HOSTNAME` from `provider.environment` are passed on.
- Names that Lambda reserves for web functions, such as `AWS_REGION` or `AWS_LAMBDA_HTTP_ENDPOINT`, are rejected, in `provider.environment` too.
- For web functions Lambda only accepts names that start with a letter, values of 1 to 4,096 characters, and 32 KB in total. osls checks the names and the literal values when it packages.

## URL

A web app is reached through a single HTTPS endpoint, which osls always creates: `url: false` is an error. Unless you set an `authorizer`, Lambda lets every request through, and authentication is up to your app.

```yaml
webApps:
  admin:
    entry: src/admin.js
    url:
      authorizer: aws_iam
      maxEnvironments: 50
      rateLimit: 2000
```

- With `authorizer: aws_iam` Lambda answers HTTP 403 unless a request carries a [Signature Version 4](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html) signature for the service name `lambda`, made by an identity with the `lambda:InvokeWebFunctionEndpoint` permission on the endpoint. The `X-Amz-Content-SHA256` header has to be part of the signed request.
- `maxEnvironments` limits how many execution environments the endpoint runs at once, and `rateLimit` how many requests per second it accepts. Requests above a limit get HTTP 429. At the time of writing AWS accepts `0` (which blocks all traffic), 100 to 1,000 in steps of 100, and 2,000 to 10,000 in steps of 1,000 as `rateLimit`, and the values can differ per Region. Removing a limit from `serverless.yml` removes it from the endpoint.

The endpoint sends all traffic to the revision of the latest deployment, and its URL stays the same from one deployment to the next. The URL does change when the endpoint is replaced, which happens when you change the `name` of the web app or the `name` of the endpoint.

## Multi-Region endpoints

`url.type`, `url.regions` and `url.name` are osls additions to the `webApps` property. By default an endpoint is of the `HomeRegion` type: it runs the web app in the Region of the service only. The other two types run it in more Regions, from the same stack:

- `MultiRegion` gives one global URL (`https://<id>.lambda-web.global.on.aws`). Lambda routes each request to the Region with the lowest latency.
- `PerRegion` gives one URL per Region, and you decide how requests are routed to them.

```yaml
provider:
  name: aws
  region: us-east-1

webApps:
  api:
    entry: src/server.js
    url:
      type: MultiRegion
      regions:
        - us-east-2
        - us-west-2
      name: global
```

`regions` is required with these two types and lists at least one Region other than the Region of the service, which Lambda adds itself. It cannot be set for a `HomeRegion` endpoint.

Keep in mind:

- **The type and the Regions of an existing endpoint cannot be changed.** Change `url.name` together with them: this creates a new endpoint with a new URL and deletes the old one. Without a new name the deployment fails with `Resource "arn:aws:lambda:us-east-1:123456789012:web-function/my-service-dev-api/endpoint/global" already exists` and is rolled back.
- The stack, the web function and its revisions stay in the Region of the service, and so do all osls commands. Lambda copies the code to the other Regions when a deployment updates the endpoint.
- For a `PerRegion` endpoint, `osls info` and the stack output show the URL of the Region of the service. `aws lambda-web get-web-function-endpoint --function-name <name> --endpoint-name <endpoint>` shows the URLs of the other Regions.
- Requests served in another Region are logged to the `.local` log group of that Region, which Lambda creates there without a retention period and which `osls remove` does not delete. Lambda copies the lines to `/aws/lambda/web/<name>` in the Region of the service, and that is the log group `osls logs --web-app` reads for these endpoint types. See [Logs](#logs).
- The default execution role may write to the `.local` log groups in every Region. A [role of your own](#iam) needs that permission too, or the logs of the other Regions are lost without an error.
- With `kmsKeyArn`, the key has to be a multi-Region key with a replica in every Region of the endpoint.
- A [network connector](#vpc) cannot be used with these endpoint types.

## Custom domains and CloudFront

A web function endpoint has no custom domain setting. Put an Amazon CloudFront distribution in front of it, which also adds caching, HTTP/2 and HTTP/3 towards the browser and AWS WAF. Three resources under `resources` are needed, next to `authorizer: aws_iam` on the web app:

```yaml
webApps:
  site:
    entry: src/server.js
    url:
      authorizer: aws_iam

resources:
  Resources:
    SiteOriginAccessControl:
      Type: AWS::CloudFront::OriginAccessControl
      Properties:
        OriginAccessControlConfig:
          Name: ${self:service}-${sls:stage}-site
          OriginAccessControlOriginType: lambda
          SigningBehavior: always-amz-auth
          SigningProtocol: sigv4
    SiteDistribution:
      Type: AWS::CloudFront::Distribution
      Properties:
        DistributionConfig:
          Enabled: true
          Origins:
            - Id: site
              DomainName: !GetAtt SiteWebFunctionEndpoint.DomainName
              OriginAccessControlId: !GetAtt SiteOriginAccessControl.Id
              CustomOriginConfig:
                OriginProtocolPolicy: https-only
                OriginSSLProtocols: [TLSv1.2]
          DefaultCacheBehavior:
            TargetOriginId: site
            ViewerProtocolPolicy: redirect-to-https
            AllowedMethods: [GET, HEAD, OPTIONS, PUT, PATCH, POST, DELETE]
            # The managed "CachingDisabled" cache policy
            CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad
            # The managed "AllViewerExceptHostHeader" origin request policy
            OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac
    SiteResourcePolicy:
      Type: AWS::Lambda::ResourcePolicy
      Properties:
        ResourceArn: !Ref SiteWebFunction
        PolicyDocument:
          Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Principal:
                Service: cloudfront.amazonaws.com
              Action: lambda:InvokeWebFunctionEndpoint
              Resource: !Ref SiteWebFunctionEndpoint
              Condition:
                StringEquals:
                  aws:SourceArn: !Sub arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${SiteDistribution}
  Outputs:
    SiteDistributionDomainName:
      Value: !GetAtt SiteDistribution.DomainName
```

- **`authorizer: aws_iam` is what closes the direct route.** CloudFront signs the requests it forwards, and the resource policy lets this one distribution call the endpoint. Unsigned requests to the URL of the endpoint then get HTTP 403. Without `aws_iam` the endpoint stays public at its own URL, whatever is in front of it.
- The origin request policy forwards everything except the `Host` header. Lambda routes on `Host` and answers HTTP 404 when it is not the domain of the endpoint. The host the browser asked for is not passed on by this policy.
- A web function has a single resource-based policy, so every statement for it goes into this one `AWS::Lambda::ResourcePolicy`.
- For the global domain of a [`MultiRegion` endpoint](#multi-region-endpoints) set `SigningProtocol: sigv4a`. With `sigv4` CloudFront rejects the distribution: `This origin domain requires SigV4a signing protocol.`
- For the custom domain itself add [`Aliases` and a `ViewerCertificate`](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html) with an AWS Certificate Manager certificate from `us-east-1` to the `DistributionConfig`, and point a DNS record at the distribution.

Creating or deleting a distribution takes a few minutes.

## Packaging

osls builds a separate zip file for every web app. `package.individually` has no influence on that. The zip is built like the package of a function:

- It starts from the whole service directory, minus development dependencies and the files osls always excludes (see [Packaging](./packaging.md)).
- That file list is filtered by the service-level `package.patterns`, and the result by the `package.patterns` of the web app.
- [The start file](#the-start-file) is added last.

osls does not bundle or compile. A TypeScript `entry` is rejected: compile it first and point `entry` at the JavaScript output.

Because the whole service directory is packaged by default, a web app also ships the code of the functions and the other web apps of the service, and a change to any file changes its package. Give each web app the files it needs. Keep `package.json` among them: Node.js reads `"type": "module"` from it.

```yaml
webApps:
  api:
    entry: api/server.js
    package:
      patterns:
        - '!**'
        - 'api/**'
        - 'node_modules/**'
        - 'package.json'
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

osls refuses to package a service with web apps without it. For a service that is already deployed without versioning, `osls deploy` enables versioning on the bucket before it uploads the code. S3 can take some time to apply versioning to new uploads, so if that one deployment fails to create a revision, deploy again.

Keep the setting for as long as the service exists, also when you remove its web apps later: a bucket stays versioned, and `osls remove` only deletes the old versions of its objects, which it has to do before the bucket can be deleted, when the setting is there.

osls adds the statement that Lambda needs to the bucket policy, so `provider.deploymentBucket.skipPolicySetup` cannot be combined with web apps.

### Bucket of your own

A bucket that you name in `provider.deploymentBucket` (or `provider.deploymentBucket.name`) is never modified by osls. Before deploying web apps to it:

1. Enable versioning on the bucket, and set `provider.deploymentBucket.versioning: true` next to `name` for as long as it is versioned. Without the setting `osls remove` leaves every object of the service behind as a noncurrent version.
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

3. Do not expire objects under `<deploymentPrefix>/<service>/<stage>/web-apps/` with a lifecycle rule, neither current nor noncurrent versions. See [Where the code is stored](#where-the-code-is-stored).

`osls deploy` stops before it uploads anything when the bucket is not versioned, or when its policy has no statement that allows the Lambda service (the error contains the statement to add). It does not check the statement any further, and skips the policy check when it is not allowed to read the bucket policy, which is always the case for a bucket of another account.

When the bucket encrypts objects with a KMS key (`serverSideEncryption: aws:kms`), the key policy has to allow `lambda.amazonaws.com` to call `kms:Decrypt` as well.

### Where the code is stored

The zip of a web app is uploaded to `<deploymentPrefix>/<service>/<stage>/web-apps/<key>-<sha256>.zip`, where the last part is the SHA-256 hash of the zip file. The name depends on the content alone, so:

- `osls deploy` checks whether the object exists and uploads the zip only when it does not.
- A deployment that does not change the web app leaves its revision, and the execution environments that run it, alone.
- The zips are stored outside of the directories of the individual deployments, so the cleanup of old deployments (`maxPreviousDeploymentArtifacts`) never deletes them.

**Do not delete these zips.** A revision whose zip, or whose version of the zip, is deleted keeps working for a while and then fails for good, so the damage shows up late: its requests get HTTP 409, and uploading the same file again does not repair it. Deploying again does not repair it either, because unchanged code is not a change. To recover, change the web app so that the next deployment creates a new revision, for example its `description`.

Zips of earlier versions of a web app are kept until `osls remove` deletes them with everything else under the service prefix. On a versioned bucket the same goes for the artifacts of old deployments: the cleanup only hides them behind delete markers, and their versions keep taking up space.

## Deploying

`osls deploy` deploys web apps with the CloudFormation stack of the service. Lambda runs a web app from a _revision_: a fixed combination of its code and its settings. When a deployment finds that either has changed, CloudFormation creates another revision, points the endpoint at it as soon as Lambda reports it active, and then deletes the revision it replaces.

- Lambda does not check that the server starts. A deployment succeeds when the revision is created, also when the server crashes on startup, so send the URL a request after deploying.
- Like every deployment, one without changes is skipped only in a service with functions. A service with only web apps is deployed every time, and CloudFormation then finds nothing to change.
- With [`provider.deploymentMode: express`](./deploying.md#deployment-mode) `osls deploy` returns as soon as CloudFormation has applied the configuration. Prefer the default mode where a finished deployment has to mean that the web app is ready. Express mode with `provider.disableRollback: true` is rejected for a service with web apps: CloudFormation refuses to replace resources in that combination, and every change to a web app replaces its revision.
- `osls rollback` redeploys the template of an earlier deployment, which creates a revision from the code of that deployment. This needs no special handling because the zips of web apps are kept.
- `osls remove` deletes the web functions, their endpoints and log groups with the stack, and the uploaded code with the rest of the deployment bucket content of the service. Log groups can be left behind, without a retention period: the `.local` log groups Lambda created in the other Regions of a [multi-Region endpoint](#multi-region-endpoints), and often one or both log groups of a web app in the Region of the service, which Lambda creates again when its last log lines arrive while the stack is being deleted. Delete them by hand once the removal has finished. A leftover in the Region of the service otherwise makes the next deployment of the service fail, because the log group already exists.
- `osls deploy function` does not deploy web apps, see [Commands](#commands).

## IAM

Web apps use the execution role of the service, the same role as the functions (see [IAM](./iam.md)):

- Statements in `provider.iam.role.statements` and policies in `provider.iam.role.managedPolicies` apply to functions and web apps alike.
- The default role is created for a service that only has web apps too, and is allowed to write to the log groups of the web apps.
- When `provider.iam.role` refers to an existing role, web apps use that role.
- `role` on a web app refers to a role of your own, in the same forms as `role` on a function: an ARN, the logical ID of a role in `resources`, or a `Fn::GetAtt`, `Fn::ImportValue` or `Fn::Sub` reference. The default role is not created when every function and every web app of the service has a `role`.

A role of your own has to trust `lambda.amazonaws.com` and to allow `logs:CreateLogStream` and `logs:PutLogEvents` on both [log groups](#logs) of the web app. For a [multi-Region endpoint](#multi-region-endpoints) allow them, and `logs:CreateLogGroup`, on the `.local` log group in every Region:

```yaml
- Effect: Allow
  Action: [logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents]
  Resource: !Sub arn:${AWS::Partition}:logs:*:${AWS::AccountId}:log-group:/aws/lambda/web/my-service-dev-api.local:*
```

### KMS key

Lambda uses the key of `kmsKeyArn` through the key policy, not through the execution role, so osls adds nothing to the role for it. The key policy has to allow the `lambda.amazonaws.com` service principal to call `kms:Decrypt`, and the identity that deploys needs `kms:DescribeKey`, `kms:GenerateDataKey` and `kms:Decrypt` on the key. A web app inherits `provider.kmsKeyArn`, so a key that was set up for the functions of the service needs that key policy statement before a web app is added. The value has to be the ARN of a key; AWS does not accept an alias for a web function. See [Encryption at rest for Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-encryption.html).

## Logs

A web app writes JSON log lines to two CloudWatch log groups:

- `/aws/lambda/web/<name>.local` in the Region that served the request, which Lambda writes to directly,
- `/aws/lambda/web/<name>` in the Region of the service, which receives a copy of every line with some delay.

`<name>` is the `name` of the web app, `<service>-<stage>-<key>` by default. osls creates both log groups in the stack with the `logRetentionInDays` and `logDataProtectionPolicy` of the web app, and they are deleted with the stack. The settings `disableLogs`, `logs.logFormat`, `logs.logGroup` and `logs.logGroupClass` of functions do not exist for web apps.

`osls logs --web-app <key>` reads the `.local` log group, or `/aws/lambda/web/<name>` for a [multi-Region endpoint](#multi-region-endpoints), where the lines of all Regions come together a little later:

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

The stack output `ApiWebFunctionUrl` holds the URL and is exported as `sls-<service>-<stage>-ApiWebFunctionUrl`. Elsewhere in the template, reference the host name with `!GetAtt ApiWebFunctionEndpoint.DomainName`, the URL with `!Sub https://${ApiWebFunctionEndpoint.DomainName}` and the ARN of the web function with `!Ref ApiWebFunction`.

A function whose key gives its log group one of the two log group IDs above (`apiWebFunction` or `apiWebFunctionLocal` here) cannot be combined with the web app.

To set properties that `webApps` does not cover, name the resource under `resources.Resources` with its `Type`, as the [VPC](#vpc) example does: it is merged deeply into the generated resource. [`resources.extensions`](./resources.md#override-aws-cloudformation-resource) replaces properties as a whole, which suits top-level properties only. Every property of a revision is fixed once it is created, so any change to `ApiWebFunctionRevision` replaces the revision.

## Permissions to deploy

Lambda Web Functions are available in a limited set of Regions. Besides the permissions every deployment needs, the identity that deploys a service with web apps needs:

- `lambda:CreateWebFunction`, `lambda:GetWebFunction`, `lambda:DeleteWebFunction`, `lambda:TagResource`, `lambda:UntagResource` and `lambda:ListTags`,
- `lambda:CreateWebFunctionRevision`, `lambda:GetWebFunctionRevision` and `lambda:DeleteWebFunctionRevision`,
- `lambda:CreateWebFunctionEndpoint`, `lambda:GetWebFunctionEndpoint`, `lambda:UpdateWebFunctionEndpoint` and `lambda:DeleteWebFunctionEndpoint`,
- `iam:PassRole` for the execution role,
- `s3:GetObject` and `s3:GetObjectVersion` on the code in the deployment bucket: osls looks for the zip before it uploads it, and Lambda checks that the identity that creates a revision can read its code,
- `s3:GetBucketVersioning` on the deployment bucket, `s3:PutBucketVersioning` when the bucket of the stack is not versioned yet, and optionally `s3:GetBucketPolicy` on a bucket of your own,
- with `kmsKeyArn`: `kms:DescribeKey`, `kms:GenerateDataKey` and `kms:Decrypt` on the key,
- for the [VPC](#vpc) example: `lambda:PassNetworkConnector` and the permissions to manage the network connector,
- for the [CloudFront](#custom-domains-and-cloudfront) example: `lambda:PutResourcePolicy`, `lambda:GetResourcePolicy` and `lambda:DeleteResourcePolicy`, and the permissions to manage the distribution and the origin access control.

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

## Troubleshooting

- **HTTP 502 for every request, although the deployment succeeded.** The server did not start, or does not listen where Lambda expects it. Read the logs with `osls logs --web-app <key>`, and check the three rules under [Writing the server](#writing-the-server). An error thrown while the `entry` loads is in the logs as well: the response has the header `lambda-web-error-type: Application.InitCodeError` for a CommonJS `entry`, and `Runtime.ExitError` for an ES module `entry`, which is loaded asynchronously, so that the error ends the process.
- **`The function arn:aws:lambda:<region>:<account>:web-function/<name> does not exist. (Service: Lambda Web; Operation: CreateWebFunctionRevision; Status Code: 404; Error Code: ResourceNotFoundException ...)`** when a revision is created. A web function with this name exists in another Region of the account. See [Names](#names).
- **`Resource "...:web-function/<name>/endpoint/<endpoint>" already exists`.** The type or the Regions of an endpoint changed without a new `url.name`. See [Multi-Region endpoints](#multi-region-endpoints).
- **`Lambda service principal lambda.amazonaws.com does not have s3:GetObject and s3:GetObjectVersion permission on s3://...`** when a revision is created. The policy of a [bucket of your own](#bucket-of-your-own) has a statement for Lambda that does not cover the code of this web app.
- **HTTP 409 for every request of a web app that used to work.** The zip of its revision is gone. See [Where the code is stored](#where-the-code-is-stored).

## Differences from Serverless Framework v4

What osls does not support:

- **Bundling.** `build: esbuild` and a TypeScript `entry` are rejected: build first and point `entry` at JavaScript. `build: false` is accepted and changes nothing, because osls never bundles.
- **Dev mode.** `dev` is rejected, and there is no `dev` command.
- **A role per web app.** `iam` is rejected. Web apps use the role of the service or their `role`.
- **A VPC setting.** `vpc` is rejected and `provider.vpc` is not applied to web apps, see [VPC](#vpc).
- **Custom domains as a setting.** osls has no `provider.domains`; see [Custom domains and CloudFront](#custom-domains-and-cloudfront).
- **`package.artifact` in S3.**
- **`osls invoke --web-app`** and the `diff` command.
- **Taking over a stack that Serverless Framework v4 deployed.** This is untested, and the two do not store the code under the same S3 key.

What osls does differently:

- `provider.deploymentBucket.versioning: true` is required for the bucket of the stack.
- A `role` that is not an ARN is the logical ID of a role in `resources`, as it is for functions in osls.
- Tag values are strings. CloudFormation references are not accepted in `tags`, as for functions.
- A `name`, or a default name, of more than 64 characters is rejected instead of shortened.
- The start file is named `__osls_web_app_start.mjs`.
- The code is stored under `web-apps/` in the deployment bucket.
- `osls remove` does not delete the log groups a second time after the stack is gone, so some can come back, see [Deploying](#deploying).
- A service without functions is deployed every time, see [Deploying](#deploying).

What osls adds: `url.type`, `url.regions` and `url.name`, see [Multi-Region endpoints](#multi-region-endpoints).
