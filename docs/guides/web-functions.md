# AWS Lambda Web Functions

[AWS Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html) run a Node.js HTTP server on AWS Lambda. Instead of exporting a handler that receives events, your code starts a server and Lambda sends HTTPS requests to it through an endpoint with its own URL. No API Gateway, function URL or adapter is involved.

Web functions are configured under the top-level `webFunctions` property.

## Contents

- [Configuration](#configuration)
- [The server](#the-server)
- [Endpoint](#endpoint)
- [Multi-Region endpoints](#multi-region-endpoints)
- [Custom domains and CloudFront](#custom-domains-and-cloudfront)
- [Deployment bucket](#deployment-bucket)
- [Packaging](#packaging)
- [Permissions](#permissions)
- [Encryption](#encryption)
- [Environment variables](#environment-variables)
- [Logs](#logs)
- [Provider settings](#provider-settings)
- [Deploying, rolling back and removing](#deploying-rolling-back-and-removing)
- [Commands](#commands)
- [Generated resources](#generated-resources)
- [VPC access](#vpc-access)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)

## Configuration

A web function needs no settings when the server is the `index.js` file at the root of the service, so `api:` without a value or `api: {}` is a complete web function. When osls creates the deployment bucket, it has to be versioned, see [Deployment bucket](#deployment-bucket).

```yaml
# serverless.yml
service: myService

provider:
  name: aws
  deploymentBucket:
    versioning: true # required when osls creates the bucket and the service has web functions

webFunctions:
  api:
    entryPoint: src/server.js # optional, the file that starts the server (default: index.js)
    name: ${sls:stage}-api # optional, deployed name (default: <service>-<stage>-<key>)
    description: Storefront API # optional, up to 256 characters
    runtime: nodejs24.x # optional (default: nodejs24.x)
    timeout: 30 # optional, in seconds, between 3 and 900 (Lambda's default: 30)
    maxConcurrencyPerEnvironment: 64 # optional, between 1 and 128 (Lambda's default: 64)
    environment: # optional, merged over provider.environment
      TABLE_NAME: !Ref OrdersTable
    role: myCustomRole # optional, same forms as the role of a function
    kmsKeyArn: arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab # optional (default: a key owned by AWS)
    tags: # optional, merged over provider.tags
      team: web
    logs: # optional
      applicationLogLevel: INFO # TRACE, DEBUG, INFO, WARN, ERROR or FATAL
      systemLogLevel: INFO # DEBUG, INFO or WARN
    logRetentionInDays: 14 # optional (default: provider.logRetentionInDays)
    logDataProtectionPolicy: # optional (default: provider.logDataProtectionPolicy)
      Name: data-protection-policy
      Version: '2021-06-01'
      Statement: []
    package: # optional
      patterns: # applied after the service-wide package.patterns
        - '!test/**'
    endpoint: # optional
      authorizer: aws_iam # optional (default: public endpoint, the application authenticates)
      maxEnvironments: 50 # optional, between 2 and 10000
      rateLimit: 2000 # optional, requests per second
      name: main # optional, name of the endpoint (default: main)
      type: HomeRegion # optional, HomeRegion, MultiRegion or PerRegion (default: HomeRegion)
      # regions: [us-east-2, us-west-2] # required with MultiRegion and PerRegion
```

The keys under `webFunctions` follow the rules of the keys under `functions`. A web function cannot use the key of a function of the same service, because the `--function` option of commands takes either.

The deployed name can have up to 64 letters, digits, hyphens and underscores, and has to start and end with a letter or a digit. Two web functions of a service cannot have the same name, while a web function and a function can. Lambda keeps the names of web functions unique in an account across all regions, not per region as it does for functions. Deploying the same service and stage to a second region therefore fails with the default name, see [Troubleshooting](#troubleshooting). Set a `name` that contains the region, for example `${self:service}-${sls:stage}-${aws:region}-api`, or serve several regions from one stack with a [multi-Region endpoint](#multi-region-endpoints).

Properties of functions such as `handler`, `events`, `memorySize`, `layers` or `architecture` do not exist on web functions and are rejected. Lambda runs every web function with 2 vCPUs and 2 GB of memory on arm64.

## The server

Lambda sets the `AWS_LAMBDA_HTTP_ENDPOINT` environment variable to the `host:port` the server has to listen on, and the server has to be listening there within 10 seconds of its start. When it listens somewhere else, for example on `localhost` or on `PORT`, or starts listening too late, requests to the endpoint fail with status 502.

```js
// index.js
const http = require('http');

const [host, port] = process.env.AWS_LAMBDA_HTTP_ENDPOINT.split(':');

http
  .createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'Hello from a web function' }));
  })
  .listen(Number(port), host);
```

Requests reach the server over HTTP/1.1, and request and response bodies are streamed. WebSocket upgrades are not supported. Lambda adds no CORS headers, so a server called from browsers on other origins has to send them itself.

osls deploys your code as it is. It adds no file to the package and sets no environment variable besides the one for `entryPoint`.

Lambda loads the `index.js` file at the root of the package. Set `entryPoint` to load another file. It is a path relative to the root of the package, written with forward slashes. It can start with `./`, and cannot contain other `.` or `..` segments:

```yaml
webFunctions:
  api:
    entryPoint: dist/server.js
```

`entryPoint` is the only way to name the entry file. osls passes it to Lambda in the `AWS_LAMBDA_NODEJS_ENTRYPOINT` environment variable, and rejects that variable in `environment` and in `provider.environment`. Lambda does not read the entry file from `package.json`, and it reports a deployment as successful even when the entry file is missing. For that reason `osls package` and `osls deploy` fail when the package does not contain the entry file, also when it is a [zip you built yourself](#packaging).

## Endpoint

Every web function gets one endpoint, named `main` unless `endpoint.name` says otherwise, in the region of the service. Its URL is printed at the end of `osls deploy` and by `osls info`. It is also the `<Key>WebFunctionUrl` output of the stack, which other stacks import as `sls-<service>-<stage>-<Key>WebFunctionUrl` (`sls-myService-dev-ApiWebFunctionUrl` for the `api` web function above).

By default the endpoint is public: Lambda forwards every request and the application is responsible for authentication. To let Lambda accept only requests signed with AWS Signature Version 4 by a principal allowed to call `lambda:InvokeWebFunctionEndpoint`, set the authorizer:

```yaml
webFunctions:
  api:
    endpoint:
      authorizer: aws_iam
```

Callers sign their requests for the `lambda` service and have to send the `X-Amz-Content-SHA256` header with every request. A [`MultiRegion` endpoint](#multi-region-endpoints) needs SigV4a signatures.

`maxEnvironments` caps the number of execution environments Lambda starts for the endpoint, and `rateLimit` the requests per second, in each region the endpoint serves. Requests beyond either limit get status 429. At the time of writing Lambda accepts a `rateLimit` of `0` (every request gets status 503), `100` to `1000` in steps of 100 and `2000` to `10000` in steps of 1000, but the supported values can vary by region, and the deployment fails with the list of values the region supports when another one is set. Removing either setting from the configuration removes the limit from the deployed endpoint.

The URL belongs to the endpoint. It stays the same across deployments, but it is retired for good when the endpoint is deleted. Removing the service, removing the web function from the configuration or changing its `name` or its `endpoint.name` all delete the endpoint, and a later deployment gets a new URL.

## Multi-Region endpoints

An endpoint serves the region of the service only, unless `endpoint.type` says otherwise:

- `MultiRegion` serves several regions behind one global URL. Lambda routes each request to the region with the lowest latency.
- `PerRegion` serves several regions with one URL per region, and leaves the routing to you.

With both types, list the other regions in `endpoint.regions`, each once. Lambda adds the region of the service itself, so the list has to contain at least one other region, and it is not allowed with the default `HomeRegion` type.

```yaml
webFunctions:
  api:
    endpoint:
      name: global
      type: MultiRegion
      regions:
        - us-east-2
        - us-west-2
```

Keep in mind:

- The stack, the revision and all management stay in the region of the service. Lambda copies the code to the other regions when it creates or updates the endpoint, and no deployment bucket is needed there.
- Lambda cannot change the type or the regions of an existing endpoint. Change `endpoint.name` together with `endpoint.type` or `endpoint.regions`, which creates a new endpoint with a new URL and deletes the old one. Otherwise the deployment fails and is rolled back, with an error of this form on the endpoint:

  ```text
  UPDATE_FAILED: ApiWebFunctionEndpoint (AWS::Lambda::WebFunctionEndpoint)
  Resource handler returned message: "Resource "arn:aws:lambda:us-east-1:123456789012:web-function/myService-dev-api/endpoint/global" already exists" (RequestToken: ..., HandlerErrorCode: AlreadyExists)
  ```

- For a `PerRegion` endpoint, the URL osls shows and exports is the one of the region of the service. `aws lambda-web get-web-function-endpoint --function-name <name> --endpoint-name <endpoint name>` shows the URLs of the other regions.
- A request is logged in the region that served it, to a `/aws/lambda/web/<name>.local` log group that Lambda creates there without a retention period, and Lambda copies the lines to the `/aws/lambda/web/<name>` log group in the region of the service. [`osls logs`](#logs) reads that log group for these endpoints. `osls remove` does not delete the `.local` log groups of the other regions.
- The default role is allowed to write to the `.local` log groups in every region. A role you supply yourself needs the same permission in every region of the endpoint, or the lines of the other regions are lost without an error, see [Permissions](#permissions).
- With `kmsKeyArn`, the key has to be a multi-Region key with a replica in every region of the endpoint, see [Encryption](#encryption).

## Custom domains and CloudFront

An endpoint has no setting for a domain of your own. To serve a web function from your domain, put an Amazon CloudFront distribution in front of the endpoint, in the `resources` of the same service:

```yaml
webFunctions:
  site:
    endpoint:
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
            # The managed CachingDisabled cache policy
            CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad
            # The managed AllViewerExceptHostHeader origin request policy
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

- The endpoint has to use `authorizer: aws_iam`. CloudFront signs its requests through the origin access control, and the resource-based policy lets it invoke the endpoint. An endpoint without the authorizer stays reachable by anyone at its own URL, also behind CloudFront.
- A web function has a single resource-based policy. Put every statement in one `AWS::Lambda::ResourcePolicy` resource.
- The origin request policy must not forward the `Host` header of the viewer, which the managed `AllViewerExceptHostHeader` policy takes care of.
- For the global URL of a `MultiRegion` endpoint, set `SigningProtocol` to `sigv4a`. CloudFront rejects the distribution otherwise: "This origin domain requires SigV4a signing protocol."
- Add the domain itself the usual way, with `Aliases` and a `ViewerCertificate` in the `DistributionConfig`.

The snippet relies on the logical IDs of the [generated resources](#generated-resources). The resource-based policy needs [more permissions to deploy](#permissions-to-deploy).

## Deployment bucket

Lambda keeps a reference to the exact version of the zip of a revision in the deployment bucket, and keeps checking that it may read it, for as long as the revision exists. That sets two requirements on the deployment bucket that functions do not have: the bucket has to be versioned, and its policy has to let the Lambda service read the code.

### Bucket created by osls

Packaging fails with instructions when versioning is not enabled in the configuration:

```yaml
provider:
  deploymentBucket:
    versioning: true
```

osls adds the statement Lambda needs to the bucket policy it manages, so `provider.deploymentBucket.skipPolicySetup` cannot be used together with web functions.

`osls deploy` checks that the bucket is versioned before it uploads the code. When web functions are added to a service that is already deployed, it enables versioning on the bucket itself, because the stack update that declares the same setting only runs after the upload. S3 can take a short time to apply versioning once it is enabled.

### Existing bucket

A bucket set with `provider.deploymentBucket` or `provider.deploymentBucket.name` is never changed by osls. Before deploying web functions to it:

- Enable versioning on the bucket, and set `versioning: true` next to `name`. Keep the setting for as long as the bucket is versioned, also after the last web function is removed from the service. Without it `osls remove` leaves every artifact of the service behind as a noncurrent version.
- Add the following statement to the bucket policy, with the name of the bucket, the region and the account ID filled in. The `*` stands for the name of the web function, so that Lambda keeps its access when a web function is renamed and one statement serves every web function and service that uses the bucket.

```json
{
  "Effect": "Allow",
  "Principal": { "Service": "lambda.amazonaws.com" },
  "Action": ["s3:GetObject", "s3:GetObjectVersion"],
  "Resource": "arn:aws:s3:::my-deployment-bucket/*",
  "Condition": {
    "ArnLike": {
      "aws:SourceArn": "arn:aws:lambda:us-east-1:123456789012:web-function/*/revision/*"
    }
  }
}
```

`osls deploy` checks the bucket before it uploads anything. It fails when the bucket is not versioned. It also fails, and prints the statement to add, when the bucket has no policy or when the policy has no `Allow` statement for the `lambda.amazonaws.com` service or for all principals. When the policy only has an `Allow` statement for all principals, osls cannot tell whether its conditions let Lambda in, so it prints a warning with the statement and continues. It skips a check when it is not allowed to read the versioning state or the policy, for example for a bucket of another account.

When the bucket encrypts objects with a KMS key (`serverSideEncryption: aws:kms`), the policy of that key has to allow `lambda.amazonaws.com` to call `kms:Decrypt`, whoever created the bucket. See [Deploying Web Function code from Amazon S3](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html) for the details.

### Where the code is stored

osls uploads the zip of a web function to `<deploymentPrefix>/<service>/<stage>/web-functions/<key>-<hash>.zip`, where `<hash>` is the SHA-256 hash of the zip, and only when the bucket does not have that object yet. The zips are kept outside the directories of the individual deployments, so:

- A revision is replaced only when the zip or the settings of its web function change. A deployment that changes only other parts of the service leaves the revision and the running server alone, also with `osls deploy --force`. To keep the zip of a web function from changing with every other file of the service, see [Packaging](#packaging).
- The cleanup of [previous deployments](./packaging.md#pruning-previous-deployment-artifacts) and `osls deploy list` do not see these zips. One zip per distinct build accumulates until `osls remove` deletes them.

Do not delete these zips, and do not add a lifecycle rule that expires objects or noncurrent versions under the prefix of the service. A revision whose zip is gone keeps serving for a while and then fails for good: every request gets status 409 with the header `lambda-web-error-type: Platform.RevisionNotActive`. Deploying again does not repair it, because the same build gives the same key and therefore the same template. Change the web function, for example its `description`, so that the next deployment creates a new revision.

On a versioned bucket, pruning previous deployments only adds delete markers: the old versions of the pruned artifacts stay in the bucket until the service is removed.

## Packaging

Every web function is packaged into its own zip, whatever `package.individually` says. The zip is built like the [package of a function](./packaging.md): from the directory of the service, with the service-wide `package.patterns` applied first and the patterns of the web function after them, and without development dependencies.

By default the zip therefore contains the whole service directory, and editing any file changes the zip of every web function, which gives each of them a new revision on the next deployment. Limit a web function to its own files to keep its revision when other code changes:

```yaml
package:
  patterns:
    - '!web/**' # keep the web application out of the packages of the functions

functions:
  worker:
    handler: worker.handler

webFunctions:
  site:
    entryPoint: web/server.js
    package:
      patterns:
        - '!**'
        - web/**
        - node_modules/**
        - package.json
```

An entry file that is an ES module needs the `package.json` with `"type": "module"` in the zip, so keep it when patterns exclude everything else.

The package has to contain everything the server needs at runtime, including `node_modules`. osls does not bundle or compile code. Native modules have to be built for Linux on arm64. A package can be up to 512 MiB once unzipped.

To deploy a zip built by another tool, set `package.artifact` of the web function to its local path, instead of `patterns`. The zip is deployed as it is and `patterns` are ignored. Packaging fails when the file is not a zip or does not contain the entry file. An artifact hosted on S3 is not supported.

```yaml
webFunctions:
  api:
    package:
      artifact: build/api.zip
```

The service-wide `package.artifact` is the package of the functions and is not used for web functions. When that zip is inside the directory of the service, exclude it from the packages of the web functions with a pattern.

A package built with `osls package` is deployed with `osls deploy --package` as usual: the zips of the web functions are part of the package directory.

## Permissions

Web functions use the [IAM role](./iam.md) of the service like functions do: the default role, with the statements and managed policies of `provider.iam.role`, the role referenced by `provider.iam.role`, or their own `role`. The default role is allowed to write to the log groups of the web functions.

A role you supply yourself needs `lambda.amazonaws.com` as trusted service, and `logs:CreateLogGroup`, `logs:CreateLogStream` and `logs:PutLogEvents` on both log groups of the web function, see [Logs](#logs). For a [multi-Region endpoint](#multi-region-endpoints) it needs them on the `.local` log group in every region of the endpoint, which a `*` in place of the region covers:

```yaml
- Effect: Allow
  Action:
    - logs:CreateLogGroup
    - logs:CreateLogStream
    - logs:PutLogEvents
  Resource:
    - !Sub arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/web/myService-dev-api:*
    - !Sub arn:${AWS::Partition}:logs:*:${AWS::AccountId}:log-group:/aws/lambda/web/myService-dev-api.local:*
```

### Permissions to deploy

Besides the permissions every deployment needs, the identity that deploys a service with web functions needs:

- `lambda:CreateWebFunction`, `lambda:GetWebFunction`, `lambda:DeleteWebFunction`, `lambda:TagResource`, `lambda:UntagResource`, `lambda:ListTags`, `lambda:CreateWebFunctionRevision`, `lambda:GetWebFunctionRevision`, `lambda:DeleteWebFunctionRevision`, `lambda:CreateWebFunctionEndpoint`, `lambda:GetWebFunctionEndpoint`, `lambda:UpdateWebFunctionEndpoint` and `lambda:DeleteWebFunctionEndpoint`.
- `iam:PassRole` on the role of the web functions.
- `s3:GetObject` and `s3:GetObjectVersion` on the zips in the deployment bucket, because Lambda checks that the identity that creates a revision can read its code.
- `s3:GetBucketVersioning` on the [deployment bucket](#deployment-bucket) osls creates, and `s3:PutBucketVersioning` when osls has to enable versioning on it. On a bucket of your own, `s3:GetBucketVersioning` and `s3:GetBucketPolicy` are optional: osls checks the bucket with them before the upload, and skips a check it is not allowed to make.
- With `kmsKeyArn`: `kms:DescribeKey`, `kms:GenerateDataKey` and `kms:Decrypt` on the key. The CloudFormation resource type also lists `kms:CreateGrant` among the permissions it uses.
- With a [network connector](#vpc-access): `lambda:PassNetworkConnector` on the connector, `iam:PassRole` on its operator role, and the permissions to manage the connector.
- With [CloudFront](#custom-domains-and-cloudfront): `lambda:PutResourcePolicy`, `lambda:GetResourcePolicy` and `lambda:DeleteResourcePolicy`, and the permissions to manage the distribution and the origin access control.

When a [`provider.iam.deploymentRole`](./credentials.md) is set, CloudFormation creates the resources with that role, so the role needs these permissions apart from the ones on the bucket itself, which osls uses with the identity that deploys.

## Encryption

Lambda encrypts the code and the environment variables of a web function with a key it owns. Set `kmsKeyArn` on the web function to use a key of your own. `provider.kmsKeyArn` is the key of the functions and does not apply to web functions, because Lambda uses the key of a web function differently:

- Lambda decrypts through the key policy, not through the role of the web function. The key policy has to allow the `lambda.amazonaws.com` service to call `kms:Decrypt`, and osls adds no statement to the role.
- The identity that deploys needs [permissions on the key](#permissions-to-deploy) as well.
- The value has to be the ARN of a key. An alias ARN is rejected.
- For a [multi-Region endpoint](#multi-region-endpoints) it has to be a multi-Region key with a replica in every region of the endpoint, each with a key policy of its own.

See [Encryption at rest for Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-encryption.html) for the statements of the key policy.

## Environment variables

`environment` works like the [environment of a function](./functions.md#environment-variables) and is merged over `provider.environment`. Lambda is stricter with web functions, and osls reports each of the following when packaging:

- The following names are reserved: `AWS_ACCESS_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SECRET_KEY`, `AWS_SECURITY_TOKEN`, `AWS_SESSION_TOKEN`, `AWS_DEFAULT_REGION`, `AWS_REGION`, `AWS_LAMBDA_HTTP_ENDPOINT`, `AWS_LAMBDA_RUNTIME_API`, `AWS_LAMBDA_INITIALIZATION_TYPE`, `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`, `AWS_LAMBDA_METADATA_API` and `AWS_LAMBDA_METADATA_TOKEN`.
- `AWS_LAMBDA_NODEJS_ENTRYPOINT` is set with [`entryPoint`](#the-server).
- A name has to start with a letter.
- A value cannot be an empty string or have more than 4,096 characters, and all names and values together cannot exceed 32 KB.

A variable of `provider.environment` that breaks one of these rules has to be moved to the functions that use it.

## Logs

Lambda writes the output of a web function to two CloudWatch log groups: `/aws/lambda/web/<name>.local`, where every line arrives first, and `/aws/lambda/web/<name>`, to which the lines are copied afterwards. osls creates both in the stack, so that they are removed with the service and get the retention and data protection policy set with `logRetentionInDays` and `logDataProtectionPolicy`, on the web function or on the provider.

`logs.applicationLogLevel` and `logs.systemLogLevel` set the level from which Lambda keeps the lines of the application and its own lines. Lines are always JSON objects.

```bash
osls logs --function api --tail
```

[`osls logs`](../cli-reference/logs.md) reads the `.local` log group, or the other one when the endpoint is a [multi-Region endpoint](#multi-region-endpoints), because only that one has the lines of every region.

## Provider settings

The following provider settings also apply to web functions: `environment`, `tags`, `logRetentionInDays`, `logDataProtectionPolicy` and `iam.role`.

Other settings that provide defaults for functions, such as `runtime`, `timeout`, `memorySize`, `architecture`, `layers`, `vpc`, `kmsKeyArn`, `tracing` and `logs.lambda`, do not apply to web functions.

## Deploying, rolling back and removing

Web functions are deployed with [`osls deploy`](../cli-reference/deploy.md), together with the rest of the service. Lambda keeps the code and most settings of a web function in an immutable revision. When the zip of a web function or a setting of its revision changes, the deployment creates a new revision, moves the endpoint to it once it is ready and deletes the previous one, which also restarts the server, see [Where the code is stored](#where-the-code-is-stored). `tags`, `logRetentionInDays`, `logDataProtectionPolicy` and the `authorizer`, `maxEnvironments` and `rateLimit` of the endpoint are not part of the revision and are updated in place.

When nothing changed since the last deployment, osls skips the deployment of a service that has functions ("No changes to deploy"). A service with only web functions is not skipped: it reaches CloudFormation, which finds no changes and replaces nothing, as for any service without functions.

Lambda considers a revision ready without starting the server. A server that crashes on startup is deployed successfully and then fails every request, so send a request to the URL after deploying.

Prefer the default [deployment mode](./deploying.md#deployment-mode) where a successful deployment must mean that the web function is ready to serve. Express mode works with web functions, except together with `disableRollback: true`: CloudFormation then rejects every update that replaces a resource, which a change to the code or most settings of a web function does to its revision, so `osls package`, `osls deploy` and `osls rollback` fail for that combination.

[`osls rollback --timestamp`](../cli-reference/rollback.md) re-applies the template of an earlier deployment, which gives every web function whose zip or revision settings changed since then a new revision from the zip of that deployment. The zips are never pruned, so the pruning of the [deployment artifacts](./packaging.md#pruning-previous-deployment-artifacts) alone limits how far back it goes. Right after a rollback, `osls deploy` with unchanged files reports that there is nothing to deploy when the service also has functions: run `osls deploy --force` to deploy the current code again. A service with only web functions is deployed again in any case.

[`osls remove`](../cli-reference/remove.md) deletes the web functions, their endpoints, the log groups of the stack and the zips, together with the rest of the service. Log groups without a retention period can remain:

- The `.local` log groups that Lambda created in the other regions of a [multi-Region endpoint](#multi-region-endpoints).
- Occasionally the `/aws/lambda/web/<name>` log group or its `.local` companion in the region of the service, which Lambda creates again when lines arrive while the stack is being deleted. Delete such a log group before deploying the service again, or the deployment fails because the log group already exists.

`osls remove` empties the deployment bucket before it deletes the stack. If the deletion of the stack then fails, the web functions that are still there have lost their code, see [Where the code is stored](#where-the-code-is-stored). Run `osls remove` again, or change the web functions and deploy to keep the service.

## Commands

| Command                                                                                      | Web functions                                               |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`osls deploy`](../cli-reference/deploy.md), [`osls package`](../cli-reference/package.md)   | Supported                                                   |
| [`osls info`](../cli-reference/info.md)                                                      | Lists the name and the URL of every web function            |
| [`osls logs`](../cli-reference/logs.md)                                                      | Supported, pass the key of the web function to `--function` |
| [`osls rollback`](../cli-reference/rollback.md), [`osls remove`](../cli-reference/remove.md) | Supported                                                   |
| [`osls deploy function`](../cli-reference/deploy-function.md)                                | Not supported, use `osls deploy`                            |
| [`osls rollback function`](../cli-reference/rollback-function.md)                            | Not supported, use `osls rollback`                          |
| [`osls invoke`](../cli-reference/invoke.md)                                                  | Not supported, send a request to the URL                    |
| [`osls invoke local`](../cli-reference/invoke-local.md)                                      | Not supported, start the server with Node.js                |
| [`osls metrics`](../cli-reference/metrics.md)                                                | Not supported, web functions are left out                   |

## Generated resources

For a web function with the key `api`, osls adds the following resources to the CloudFormation template. They can be changed like the [other generated resources](./resources.md#override-aws-cloudformation-resource).

| Resource                           | Logical ID                    |
| ---------------------------------- | ----------------------------- |
| `AWS::Lambda::WebFunction`         | `ApiWebFunction`              |
| `AWS::Lambda::WebFunctionRevision` | `ApiWebFunctionRevision`      |
| `AWS::Lambda::WebFunctionEndpoint` | `ApiWebFunctionEndpoint`      |
| `AWS::Logs::LogGroup`              | `ApiWebFunctionLogGroup`      |
| `AWS::Logs::LogGroup` (`.local`)   | `ApiWebFunctionLocalLogGroup` |

A function with the key `apiWebFunction` or `apiWebFunctionLocal` would give its log group the logical ID of one of these log groups, and is rejected unless it sets `disableLogs`.

## VPC access

Web functions reach resources in a VPC through a network connector, which osls does not create. `vpc` is not a property of web functions, and `provider.vpc` does not apply to them, nor does it add the VPC access policy to the role of a service that has only web functions. Declare the connector, the operator role it creates network interfaces with, and the connector of the generated revision under `resources`:

```yaml
resources:
  Resources:
    NetworkConnectorRole:
      Type: AWS::IAM::Role
      Properties:
        AssumeRolePolicyDocument:
          Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Principal:
                Service: lambda.amazonaws.com
              Action: sts:AssumeRole
        Policies:
          - PolicyName: network-interfaces
            PolicyDocument:
              Version: '2012-10-17'
              Statement:
                - Effect: Allow
                  Action: ec2:CreateNetworkInterface
                  Resource:
                    - arn:aws:ec2:*:*:network-interface/*
                    - arn:aws:ec2:*:*:subnet/*
                    - arn:aws:ec2:*:*:security-group/*
                - Effect: Allow
                  Action: ec2:CreateTags
                  Resource: arn:aws:ec2:*:*:network-interface/*
                  Condition:
                    StringEquals:
                      ec2:ManagedResourceOperator: network-connectors.lambda.amazonaws.com
    NetworkConnector:
      Type: AWS::Lambda::NetworkConnector
      Properties:
        Name: ${self:service}-${sls:stage}-connector
        OperatorRole: !GetAtt NetworkConnectorRole.Arn
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
          EgressNetworkConnectorArn: !GetAtt NetworkConnector.LatestVersionArn
```

Declared like this the property is merged into the `ServiceConfig` osls generates. The same under `resources.extensions` would replace the whole `ServiceConfig`.

- The operator role is required. Without it CloudFormation fails with `NetworkConnectorOperatorRole is required for VPC_EGRESS connector type`.
- Creating the connector takes several minutes.
- Once the connector is attached, all outbound traffic of the web function goes through the VPC. It reaches private resources there, and loses direct internet access unless the subnets route through a NAT gateway.
- A connector cannot be used with `MultiRegion` or `PerRegion` endpoints.
- `osls remove` deletes the connector and its network interfaces with the stack.

The identity that deploys needs [more permissions](#permissions-to-deploy) for the connector. See [Configuring networking for AWS Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html) for the requirements on the subnets.

## Troubleshooting

**The second region of a service fails with "does not exist".** Lambda keeps the names of web functions unique in an account across all regions, see [Configuration](#configuration). With the default names, the stack of the second region fails on the revision and is rolled back:

```text
The function arn:aws:lambda:us-east-2:123456789012:web-function/myService-dev-api does not exist. (Service: Lambda Web; Operation: CreateWebFunctionRevision; Status Code: 404; Error Code: ResourceNotFoundException)
```

**An endpoint "already exists" after changing its type or regions.** Lambda cannot change these on an existing endpoint. Change `endpoint.name` in the same deployment, see [Multi-Region endpoints](#multi-region-endpoints).

**The deployment fails on the revision with "does not have s3:GetObject and s3:GetObjectVersion permission".** The policy of an existing deployment bucket does not let Lambda read the code, see [Existing bucket](#existing-bucket). If this was the first deployment of the service, the stack can be left in the `ROLLBACK_COMPLETE` state: run `osls remove` before deploying again.

**Every request fails with status 502 after a successful deployment.** The server did not start, or does not listen on the `host:port` of `AWS_LAMBDA_HTTP_ENDPOINT`, see [The server](#the-server). `osls logs` shows the error.

**Every request fails with status 409 and the header `lambda-web-error-type: Platform.RevisionNotActive`.** The zip of the revision is gone from the deployment bucket, see [Where the code is stored](#where-the-code-is-stored).

## Limitations

- Lambda offers web functions with the `nodejs24.x` runtime only, and not in every region.
- One endpoint per web function. Several endpoints and shifting traffic gradually between revisions are not supported.
- No local emulation. The server is a plain Node.js HTTP server, so run it with `AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:3000 node index.js`.
