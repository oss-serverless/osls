# AWS Lambda Functions

If you are using AWS as a provider, all _functions_ inside the service are AWS Lambda functions.

## Contents

- [Configuration](#configuration)
- [Supported runtimes](#supported-runtimes)
- [Permissions](#permissions)
- [Lambda Function URLs](#lambda-function-urls)
- [Referencing container image as a target](#referencing-container-image-as-a-target)
- [Instruction set architecture](#instruction-set-architecture)
- [Runtime Management](#runtime-management)
- [SnapStart](#snapstart)
- [AWS Lambda Durable Functions](#aws-lambda-durable-functions)
- [Recursive Loop Detection](#recursive-loop-detection)
- [VPC Configuration](#vpc-configuration)
- [Environment Variables](#environment-variables)
- [Tags](#tags)
- [Layers](#layers)
- [Log Group Resources](#log-group-resources)
- [Versioning Deployed Functions](#versioning-deployed-functions)
- [Conditional deployment & explicit dependencies](#conditional-deployment--explicit-dependencies)
- [Dead Letter Queue (DLQ)](#dead-letter-queue-dlq)
- [KMS Keys](#kms-keys)
- [AWS X-Ray Tracing](#aws-x-ray-tracing)
- [Asynchronous invocation](#asynchronous-invocation)
- [EFS Configuration](#efs-configuration)
- [Ephemeral storage](#ephemeral-storage)
- [Logging Configuration](#logging-configuration)

## Configuration

All of the Lambda functions in your serverless service can be found in `serverless.yml` under the `functions` property.

```yaml
# serverless.yml
service: myService

provider:
  name: aws
  runtime: nodejs24.x
  runtimeManagement: auto # optional, set how Lambda controls all functions runtime. AWS default is auto; this can either be 'auto' or 'onFunctionUpdate'. For 'manual', see example in hello function below (syntax for both is identical)
  memorySize: 512 # optional, in MB, default is 1024
  timeout: 10 # optional, in seconds, default is 6
  versionFunctions: false # optional, default is true
  tracing:
    lambda: true # optional, enables tracing for all functions (can be true (true equals 'Active') 'Active' or 'PassThrough')

functions:
  hello:
    handler: handler.hello # required, handler set in AWS Lambda
    name: ${sls:stage}-lambdaName # optional, Deployed Lambda name
    description: Description of what the lambda function does # optional, Description to publish to AWS
    runtime: python3.14 # optional overwrite, default is provider runtime
    runtimeManagement:
      mode: manual # syntax required for manual, mode property also supports 'auto' or 'onFunctionUpdate' (see provider.runtimeManagement)
      arn: <aws runtime arn> # required when mode is manual
    memorySize: 512 # optional, in MB, default is 1024
    timeout: 10 # optional, in seconds, default is 6
    provisionedConcurrency: 3 # optional, Count of provisioned lambda instances
    reservedConcurrency: 5 # optional, reserved concurrency limit for this function. By default, AWS uses account concurrency limit
    tracing: PassThrough # optional, overwrite, can be 'Active' or 'PassThrough'
```

If `provider.runtime` is omitted for AWS services, osls defaults to the latest generally available Node.js Lambda runtime. Today that is `nodejs24.x`.

We still recommend explicitly setting the runtime you want to deploy, either at `provider.runtime` or per function, so your service does not change runtimes when that default advances.

For new services, prefer `nodejs24.x`, `python3.14`, `java25`, `dotnet10`, `ruby4.0`, and `provided.al2023` for custom runtimes.

The `handler` property points to the file and module containing the code you want to run in your function.

```javascript
// handler.js
module.exports.functionOne = async (event) => {};
```

You can add as many functions as you want within this property.

```yaml
# serverless.yml

service: myService

provider:
  name: aws
  runtime: nodejs24.x

functions:
  functionOne:
    handler: handler.functionOne
    description: optional description for your Lambda
  functionTwo:
    handler: handler.functionTwo
  functionThree:
    handler: handler.functionThree
```

Your functions can either inherit their settings from the `provider` property.

```yaml
# serverless.yml
service: myService

provider:
  name: aws
  runtime: nodejs24.x
  memorySize: 512 # will be inherited by all functions

functions:
  functionOne:
    handler: handler.functionOne
```

Or you can specify properties at the function level.

```yaml
# serverless.yml
service: myService

provider:
  name: aws
  runtime: nodejs24.x

functions:
  functionOne:
    handler: handler.functionOne
    memorySize: 512 # function specific
```

You can specify an array of functions, which is useful if you separate your functions in to different files:

```yaml
# serverless.yml
---
functions:
  - ${file(./foo-functions.yml)}
  - ${file(./bar-functions.yml)}
```

```yaml
# foo-functions.yml
getFoo:
  handler: handler.foo
deleteFoo:
  handler: handler.foo
```

## Supported runtimes

The `runtime` property (set at `provider.runtime` or per function) accepts a fixed set of identifiers that map to the [AWS Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html). The supported identifiers, grouped by language, are:

- **Node.js:** `nodejs20.x`, `nodejs22.x`, `nodejs24.x`, `nodejs26.x`
- **Python:** `python3.10`, `python3.11`, `python3.12`, `python3.13`, `python3.14`, `python3.15`
- **Java:** `java8.al2`, `java8.al2023`, `java11`, `java11.al2023`, `java17`, `java17.al2023`, `java21`, `java25`
- **Ruby:** `ruby3.3`, `ruby3.4`, `ruby4.0`
- **.NET:** `dotnet8`, `dotnet9`, `dotnet10`
- **Custom (OS-only):** `provided.al2`, `provided.al2023`

Use `provided.al2` or `provided.al2023` together with [Lambda Layers](#layers) to ship your own custom runtime. Any other value is rejected during schema validation.

`nodejs26.x` and `python3.15` are AWS public preview runtimes. They are not covered by the Lambda SLA or AWS Support, and AWS recommends against using them for production workloads. When AWS makes them generally available, functions using them move over automatically because the identifiers stay the same.

## Permissions

Every AWS Lambda function needs permission to interact with other AWS infrastructure resources within your account. These permissions are set via an AWS IAM Role. You can set permission policy statements within this role via the `provider.iam.role.statements` property.

```yaml
# serverless.yml
service: myService

provider:
  name: aws
  runtime: nodejs24.x
  iam:
    role:
      statements: # permissions for all of your functions can be set here
        - Effect: Allow
          Action: # Gives permission to DynamoDB tables in a specific region
            - dynamodb:DescribeTable
            - dynamodb:Query
            - dynamodb:Scan
            - dynamodb:GetItem
            - dynamodb:PutItem
            - dynamodb:UpdateItem
            - dynamodb:DeleteItem
          Resource: 'arn:aws:dynamodb:us-east-1:*:*'

functions:
  functionOne:
    handler: handler.functionOne
    memorySize: 512
```

Another example:

```yaml
# serverless.yml
service: myService
provider:
  name: aws
  iam:
    role:
      statements:
        - Effect: 'Allow'
          Action:
            - 's3:ListBucket'
          # You can put CloudFormation syntax in here.  No one will judge you.
          # Remember, this all gets translated to CloudFormation.
          Resource: { 'Fn::Join': ['', ['arn:aws:s3:::', { 'Ref': 'ServerlessDeploymentBucket' }]] }
        - Effect: 'Allow'
          Action:
            - 's3:PutObject'
          Resource:
            Fn::Join:
              - ''
              - - 'arn:aws:s3:::'
                - 'Ref': 'ServerlessDeploymentBucket'
                - '/*'

functions:
  functionOne:
    handler: handler.functionOne
    memorySize: 512
```

You can also use an existing IAM role by adding your IAM Role ARN in the `iam.role` property. For example:

```yaml
# serverless.yml
service: new-service
provider:
  name: aws
  iam:
    role: arn:aws:iam::YourAccountNumber:role/YourIamRole
```

See the documentation about [IAM](./iam.md) for function level IAM roles.

## Lambda Function URLs

A [Lambda Function URL](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-urls.html) is a simple solution to create HTTP endpoints with AWS Lambda. Function URLs are ideal for getting started with AWS Lambda, or for single-function applications like webhooks or APIs built with web frameworks.

You can create a function URL via the `url` property in the function configuration in `serverless.yml`. By setting `url` to `true`, as shown below, the URL will be public without CORS configuration.

```yaml
functions:
  func:
    handler: index.handler
    url: true
```

Alternatively, you can configure it as an object, and provide values for `authorizer`, `cors` and `invokeMode` options.

The `authorizer` property can be set to `aws_iam` to enable AWS IAM authorization on your function URL.

```yaml
functions:
  func:
    handler: index.handler
    url:
      authorizer: aws_iam
```

When using IAM authorization, the URL will only accept HTTP requests with AWS credentials allowing `lambda:InvokeFunctionUrl` (similar to [API Gateway IAM authentication](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html)).

You can also configure [CORS headers](https://developer.mozilla.org/docs/Web/HTTP/CORS) so that your function URL can be called from other domains in browsers. Setting `cors` to `true` will allow all domains via the following CORS headers:

```yaml
functions:
  func:
    handler: index.handler
    url:
      cors: true
```

| Header                       | Value                                                                    |
| :--------------------------- | :----------------------------------------------------------------------- |
| Access-Control-Allow-Origin  | \*                                                                       |
| Access-Control-Allow-Headers | Content-Type, X-Amz-Date, Authorization, X-Api-Key, X-Amz-Security-Token |
| Access-Control-Allow-Methods | \*                                                                       |

You can also additionally adjust your CORS configuration by setting `allowedOrigins`, `allowedHeaders`, `allowedMethods`, `allowCredentials`, `exposedResponseHeaders`, and `maxAge` properties as shown in example below.

```yaml
functions:
  func:
    handler: index.handler
    url:
      cors:
        allowedOrigins:
          - https://url1.com
          - https://url2.com
        allowedHeaders:
          - Content-Type
          - Authorization
        allowedMethods:
          - GET
        allowCredentials: true
        exposedResponseHeaders:
          - Special-Response-Header
        maxAge: 6000 # In seconds
```

In the table below you can find how the `cors` properties map to CORS headers

| Configuration property | CORS Header                      |
| :--------------------- | :------------------------------- |
| allowedOrigins         | Access-Control-Allow-Origin      |
| allowedHeaders         | Access-Control-Allow-Headers     |
| allowedMethods         | Access-Control-Allow-Methods     |
| allowCredentials       | Access-Control-Allow-Credentials |
| exposedResponseHeaders | Access-Control-Expose-Headers    |
| maxAge                 | Access-Control-Max-Age           |

It is also possible to remove the values in CORS configuration that are set by default by setting them to `null` instead.

```yaml
functions:
  func:
    handler: index.handler
    url:
      cors:
        allowedHeaders: null
```

The `invokeMode` property can be set to `RESPONSE_STREAM` to enable streaming response. If not specified, `BUFFERED` invoke mode is assumed.

```yaml
functions:
  func:
    handler: index.handler
    url:
      invokeMode: RESPONSE_STREAM
```

## Referencing container image as a target

Alternatively lambda environment can be configured through docker images. Image published to AWS ECR registry can be referenced as lambda source (check [AWS Lambda – Container Image Support](https://aws.amazon.com/blogs/aws/new-for-aws-lambda-container-image-support/)). In addition, you can also define your own images that will be built locally and uploaded to AWS ECR registry.

osls will create an ECR repository for your image, but it currently does not manage updates to it. An ECR repository is created only for new services or the first time that a function configured with an `image` is deployed. In service configuration, you can configure the ECR repository to scan for CVEs via the `provider.ecr.scanOnPush` property, which is `false` by default. (See [documentation](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html))

You can also configure an ECR lifecycle policy to automatically clean up old images by setting `provider.ecr.maxImageCount` to a positive integer. When set, images exceeding this count will be expired. (See [documentation](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html))

In service configuration, images can be configured via `provider.ecr.images`. To define an image that will be built locally, you need to specify `path` property, which should point to valid docker context directory. Optionally, you can also set `file` to specify Dockerfile that should be used when building an image. It is also possible to define images that already exist in AWS ECR repository. In order to do that, you need to define `uri` property, which should follow `<account>.dkr.ecr.<region>.amazonaws.com/<repository>@<digest>` or `<account>.dkr.ecr.<region>.amazonaws.com/<repository>:<tag>` format.

Additionally, you can define arguments that will be passed to the `docker build` command via the following properties:

- `buildArgs`: With the `buildArgs` property, you can define arguments that will be passed to `docker build` command with `--build-arg` flag. They might be later referenced via `ARG` within your `Dockerfile`. (See [Documentation](https://docs.docker.com/engine/reference/builder/#arg))
- `buildOptions`: With the `buildOptions` property, you can define options that will be passed directly to the `docker build` command. Treat `buildOptions` as trusted input. Options such as `--ssh`, `--secret`, `--network`, `--add-host`, and additional build contexts can expose local resources or alter Docker build isolation. Do not run deployments or packaging for untrusted projects, templates, or pull requests that define Docker build options, and avoid placing secret values directly in `buildOptions` or `buildArgs` because command arguments may appear in local logs or error output. (See [Documentation](https://docs.docker.com/engine/reference/commandline/image_build/#options))
- `cacheFrom`: The `cacheFrom` property can be used to specify which images to use as a source for layer caching in the `docker build` command with `--cache-from` flag. (See [Documentation](https://docs.docker.com/engine/reference/builder/#usage))
- `platform`: The `platform` property can be used to specify the architecture target in the `docker build` command with the `--platform` flag. If not specified, Docker will build for your computer's architecture by default. AWS Lambda typically uses `x86` architecture unless otherwise specified in the Lambda's runtime settings. In order to avoid runtime errors when building on an ARM-based machine (e.g. Apple M1 Mac), `linux/amd64` must be used here. The options for this flag are `linux/amd64` (`x86`-based Lambdas), `linux/arm64` (`arm`-based Lambdas), or `windows/amd64`. (See [Documentation](https://docs.docker.com/engine/reference/builder/#from))
- `provenance` Use the `provenance` property to disable multi-architecture manifest generated from BuildKit or `docker buildx`, allows the architecture specified in `platform` to be recognized by AWS Lambda during deployment.

When `uri` is defined for an image, `buildArgs`, `buildOptions`, `cacheFrom`, and `platform` cannot be defined.

Example configuration

```yaml
service: service-name
provider:
  name: aws
  ecr:
    scanOnPush: true
    maxImageCount: 10
    images:
      baseimage:
        path: ./path/to/context
        file: Dockerfile.dev
        buildArgs:
          STAGE: ${opt:stage}
        cacheFrom:
          - my-image:latest
        platform: linux/amd64
        provenance: false
      anotherimage:
        uri: 000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38
```

When configuring functions, images should be referenced via `image` property, which can point to an image already defined in `provider.ecr.images` or directly to an existing AWS ECR image, following the same format as `uri` above.
Both `handler` and `runtime` properties are not supported when `image` is used.

Example configuration:

```yaml
service: service-name
provider:
  name: aws
  ecr:
    images:
      baseimage:
        path: ./path/to/context

functions:
  hello:
    image: 000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38
  world:
    image: baseimage
```

It is also possible to provide additional image configuration via `workingDirectory`, `entryPoint` and `command` properties of to `functions[].image`. The `workingDirectory` accepts path in form of string, where both `entryPoint` and `command` needs to be defined as a list of strings, following "exec form" format. In order to provide additional image config properties, `functions[].image` has to be defined as an object, and needs to define either `uri` pointing to an existing AWS ECR image or `name` property, which references image already defined in `provider.ecr.images`.

Example configuration:

```yaml
service: service-name
provider:
  name: aws
  ecr:
    images:
      baseimage:
        path: ./path/to/context

functions:
  hello:
    image:
      uri: 000000000000.dkr.ecr.sa-east-1.amazonaws.com/test-lambda-docker@sha256:6bb600b4d6e1d7cf521097177dd0c4e9ea373edb91984a505333be8ac9455d38
      workingDirectory: /workdir
      command:
        - executable
        - flag
      entryPoint:
        - executable
        - flag
  world:
    image:
      name: baseimage
      command:
        - command
      entryPoint:
        - executable
        - flag
```

During the first deployment when locally built images are used, the CLI will automatically create a dedicated ECR repository to store these images, with name `serverless-<service>-<stage>`. By default, older versions of images uploaded to ECR are not removed as they still might be in use by versioned functions. To automatically expire old images, set `provider.ecr.maxImageCount` to limit the number of images retained in the repository. During `osls remove`, the created ECR repository will be removed. During deployment, the CLI will attempt to `docker login` to ECR if needed. Depending on your local configuration, docker authorization token might be stored unencrypted. Please refer to documentation for more details: https://docs.docker.com/engine/reference/commandline/login/#credentials-store

## Instruction set architecture

By default, Lambda functions are run by 64-bit x86 architecture CPUs. However, [using arm64 architecture](https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html) (AWS Graviton2 processor) may result in better pricing and performance.

To switch all functions to AWS Graviton2 processor, configure `architecture` at `provider` level as follows:

```yaml
provider:
  ...
  architecture: arm64
```

To toggle instruction set architecture per function individually, set it directly at `functions[]` context:

```yaml
functions:
  hello:
    ...
    architecture: arm64
```

## Runtime Management

[Runtime Management](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-update.html) allows for fine-grained control of the runtime being used for a lambda function in the rare event of compatibility issues with a function.

If you wish to keep `runtimeManagement` set to `auto`, that's the default so you don't need to specify it explicitly. If you wish for the runtime to only be updated when the function is redeployed, set it to `onFunctionUpdate`.

To configure runtime management for all functions, configure `runtimeManagement` at `provider` level as follows:

```yaml
provider:
  ...
  runtimeManagement: onFunctionUpdate
```

To toggle instruction set architecture per function individually, set it directly at `functions[]` context:

```yaml
functions:
  hello:
    ...
    runtimeManagement:
      mode: manual
      arn: <aws runtime arn>
```

Finally, `auto` and `onFunctionUpdate` can be set as the `mode` property as well for completeness (and to allow for the scenario where this value comes from another variable source, for example).

## SnapStart

[Lambda SnapStart](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html) can improve startup performance for latency-sensitive applications on supported runtimes.

To enable SnapStart for your lambda function you can add the `snapStart` object property in the function configuration which can be put to true and will result in the value `PublishedVersions` for this function.

```yaml
functions:
  hello:
    ...
    runtime: java25
    snapStart: true
```

**Note:** SnapStart support and limitations are defined by AWS and may change over time. See the [AWS SnapStart documentation](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html) for the current supported runtimes and restrictions.

## AWS Lambda Durable Functions

AWS Lambda Durable Functions enable long-running, fault-tolerant workflows without custom chaining or external state management. Durable functions use checkpoint-and-replay mechanisms to reliably execute workflows that can run for up to one year.

To configure a durable function, add `durableConfig` to the function configuration:

```yaml
functions:
  orderProcessor:
    handler: handler.processOrder
    runtime: nodejs24.x
    durableConfig:
      executionTimeout: 3600
      retentionPeriodInDays: 30
```

`executionTimeout` is required and accepts a value from 1 to 31,622,400 seconds. `retentionPeriodInDays` is optional and accepts a value from 1 to 90 days.

Durable functions require qualified Lambda invocations. When `durableConfig` is configured, osls automatically publishes a function version even when function versioning is otherwise disabled. osls also creates a stable `durable` alias for generated event targets and Lambda Function URLs so invocations are qualified. `provisionedConcurrency` remains supported for durable functions; osls attaches the provisioned concurrency configuration to the generated `durable` alias instead of creating a separate `provisioned` alias.

CloudFormation marks the top-level `AWS::Lambda::Function.DurableConfig` property as a replacement property: adding `durableConfig` to an already deployed function, or removing it, requires CloudFormation to replace the Lambda function. osls gives Lambda functions explicit names, so CloudFormation cannot perform the replacement invisibly; a replacement-requiring update of a custom-named resource fails and forces an explicit migration. Changing `executionTimeout` or `retentionPeriodInDays` values on an existing durable function updates with no interruption; osls publishes a new version and retargets the `durable` alias. Plan enable or disable migrations carefully, for example by deploying a new function name, shifting event sources, or recreating the stack when appropriate.

When using Lambda event source mappings, durable execution timeout must be 900 seconds or less. Event source mappings invoke durable functions synchronously through the generated `durable` alias. AWS Lambda Durable Functions support dead-letter queues and event source mapping destinations, but do not support Lambda asynchronous destinations configured through `functions[].destinations`. Functions configured with `durableConfig` also cannot declare `cloudFront` (Lambda@Edge) events.

Event source mappings do not support durable execution-name idempotency at launch. If retries must not start duplicate durable executions, implement idempotency in your function code or use an intermediary standard Lambda function that invokes the durable function with a `DurableExecutionName`.

The top-level `functions[].maximumRetryAttempts` Lambda asynchronous invocation setting is not supported with `durableConfig`; configure durable step retries in the AWS Durable Execution SDK instead. Event source mapping retry settings, such as `stream.maximumRetryAttempts`, remain supported where AWS supports them for that event source. `maximumEventAge` is still deployed for durable functions via the durable alias; AWS has not documented whether it is honored for durable executions.

When you configure a function with `durableConfig`, osls automatically adds inline `lambda:CheckpointDurableExecution` and `lambda:GetDurableExecutionState` permissions to the generated Lambda execution role. If you configure a custom function or provider IAM role, you must attach equivalent durable execution permissions yourself. For least privilege, scope the permissions to durable execution ARNs for the function, for example `arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:my-service-dev-orderProcessor:*/durable-execution/*/*`.

Lambda Function URLs for durable functions are configured on the generated `durable` alias. Function URLs are synchronous HTTP invoke endpoints, so use asynchronous invocation for durable executions that may run longer than a synchronous request can wait.

You can provide an execution name when invoking a durable function:

```bash
osls invoke --function orderProcessor --qualifier durable --durable-execution-name order-12345
```

If you invoke a function with an execution name that already exists, Lambda handles the invocation idempotently only when the payload matches. A matching running execution returns existing execution information, and a matching closed execution returns the closed result. A different payload for the same execution name returns an error. Execution names must be 1-64 characters and can contain alphanumeric characters, hyphens, or underscores.

Use `osls deploy` after code or durable configuration changes so CloudFormation can publish a new function version and update generated aliases and event targets. Adding or removing `durableConfig` may still require Lambda function replacement as described above. `osls deploy function` and `osls rollback function` are not supported for functions configured with `durableConfig` locally or already deployed with durable configuration because they update `$LATEST` without publishing and retargeting the durable alias.

Functions currently configured with `durableConfig` are skipped by osls function pruning because durable executions may depend on retained versions for replay.

osls supports durable functions for managed runtimes `nodejs22.x`, `nodejs24.x`, `python3.13`, `python3.14`, `java17`, `java21`, and `java25`, plus compatible container images. Durable functions with `snapStart: true` are limited to the runtime intersection supported by both features: `python3.13`, `python3.14`, `java17`, `java21`, and `java25`. Durable functions with SnapStart cannot use container images, EFS, provisioned concurrency, or ephemeral storage larger than 512 MB.

## Recursive Loop Detection

By default, AWS Lambda [detects and stops recursive invocation loops](https://docs.aws.amazon.com/lambda/latest/dg/invocation-recursion.html) between supported AWS services. To allow recursive loops for a function, set `recursiveLoop` to `Allow`. To explicitly enforce termination (the default behavior), set it to `Terminate`.

```yaml
functions:
  hello:
    handler: handler.hello
    recursiveLoop: Allow
```

## VPC Configuration

You can add VPC configuration to a specific function in `serverless.yml` by adding a `vpc` object property in the function configuration. This object should contain the `securityGroupIds` and `subnetIds` array properties needed to construct VPC for this function. Here's an example configuration:

```yaml
# serverless.yml
service: service-name
provider: aws

functions:
  hello:
    handler: handler.hello
    vpc:
      securityGroupIds:
        - securityGroupId1
        - securityGroupId2
      subnetIds:
        - subnetId1
        - subnetId2
```

Or if you want to apply VPC configuration to all functions in your service, you can add the configuration to the higher level `provider` object, and overwrite these service level config at the function level. For example:

```yaml
# serverless.yml
service: service-name
provider:
  name: aws
  vpc:
    securityGroupIds:
      - securityGroupId1
      - securityGroupId2
    subnetIds:
      - subnetId1
      - subnetId2

functions:
  hello: # this function will overwrite the service level vpc config above
    handler: handler.hello
    vpc:
      securityGroupIds:
        - securityGroupId1
        - securityGroupId2
      subnetIds:
        - subnetId1
        - subnetId2
  users: # this function will inherit the service level vpc config above
    handler: handler.users
```

Then, when you run `osls deploy`, VPC configuration will be deployed along with your lambda function.

If you have a provider VPC set but wish to have specific functions with no VPC, you can set the `vpc` value for these functions to `~` (null) or `false`. For example:

```yaml
# serverless.yml
service: service-name
provider:
  name: aws
  vpc:
    securityGroupIds:
      - securityGroupId1
      - securityGroupId2
    subnetIds:
      - subnetId1
      - subnetId2

functions:
  hello: # this function will have no vpc configured
    handler: handler.hello
    vpc: ~
  users: # this function will inherit the service level vpc config above
    handler: handler.users
```

**VPC IAM permissions**

The Lambda function execution role must have permissions to create, describe and delete [Elastic Network Interfaces](http://docs.aws.amazon.com/AmazonVPC/latest/UserGuide/VPC_ElasticNetworkInterfaces.html) (ENI). When VPC configuration is provided the default AWS `AWSLambdaVPCAccessExecutionRole` will be associated with your Lambda execution role. In case custom roles are provided be sure to include the proper [ManagedPolicyArns](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-iam-role.html#cfn-iam-role-managepolicyarns). For more information please check [configuring a Lambda Function for Amazon VPC Access](http://docs.aws.amazon.com/lambda/latest/dg/vpc.html)

**VPC Lambda Internet Access**

By default, when a Lambda function is executed inside a VPC, it loses internet access and some resources inside AWS may become unavailable. In order for S3 resources and DynamoDB resources to be available for your Lambda function running inside the VPC, a VPC end point needs to be created. For more information please check [VPC Endpoint for Amazon S3](https://aws.amazon.com/blogs/aws/new-vpc-endpoint-for-amazon-s3/).
In order for other services such as Kinesis streams to be made available, a NAT Gateway needs to be configured inside the subnets that are being used to run the Lambda, for the VPC used to execute the Lambda. For more information, please check [Enable Outgoing Internet Access within VPC](https://medium.com/@philippholly/aws-lambda-enable-outgoing-internet-access-within-vpc-8dd250e11e12)

**VPC Lambda Internet IPv6 Access**

Alternatively to setting up a NAT Gateway, you can also use an [egress-only internet gateway](https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html) and allow your functions in a VPC to access the internet or other AWS services via IPv6. This eliminates the need for a NAT Gateway, reducing costs and simplifying architecture. In this case, VPC-configured Lambda functions can be allowed to access the internet using egress-only internet gateway by adding a `ipv6AllowedForDualStack` option to either the functions VPC specification:

```yaml
# serverless.yml
service: service-name
provider: aws

functions:
  hello:
    handler: handler.hello
    vpc:
      ipv6AllowedForDualStack: true
      securityGroupIds:
        - securityGroupId1
        - securityGroupId2
      subnetIds:
        - subnetId1
        - subnetId2
```

Or if you want to apply VPC configuration to all functions in your service, you can add the configuration to the higher level `provider` object, and overwrite these service level config at the function level. For example:

```yaml
# serverless.yml
service: service-name
provider:
  name: aws
  vpc:
    ipv6AllowedForDualStack: true
    securityGroupIds:
      - securityGroupId1
      - securityGroupId2
    subnetIds:
      - subnetId1
      - subnetId2

functions: ...
```

For more information, please check [Announcing AWS Lambda’s support for Internet Protocol Version 6 (IPv6) for outbound connections in VPC](https://aws.amazon.com/about-aws/whats-new/2023/10/aws-lambda-ipv6-outbound-connections-vpc/)

## Environment Variables

You can add environment variable configuration to a specific function in `serverless.yml` by adding an `environment` object property in the function configuration. This object should contain a key-value pairs of string to string:

```yaml
# serverless.yml
service: service-name
provider: aws

functions:
  hello:
    handler: handler.hello
    environment:
      TABLE_NAME: tableName
```

Or if you want to apply environment variable configuration to all functions in your service, you can add the configuration to the higher level `provider` object. Environment variables configured at the function level are merged with those at the provider level, so your function with specific environment variables will also have access to the environment variables defined at the provider level. If an environment variable with the same key is defined at both the function and provider levels, the function-specific value overrides the provider-level default value. For example:

```yaml
# serverless.yml
service: service-name
provider:
  name: aws
  environment:
    SYSTEM_NAME: mySystem
    TABLE_NAME: tableName1

functions:
  hello:
    # this function will have SYSTEM_NAME=mySystem and TABLE_NAME=tableName1 from the provider-level environment config above
    handler: handler.hello
  users:
    # this function will have SYSTEM_NAME=mySystem from the provider-level environment config above
    # but TABLE_NAME will be tableName2 because this more specific config will override the default above
    handler: handler.users
    environment:
      TABLE_NAME: tableName2
```

If you want your function's environment variables to have the same values from your machine's environment variables, please read the documentation about [Referencing Environment Variables](./variables.md).

## Tags

Using the `tags` configuration makes it possible to add `key` / `value` tags to your functions.

Those tags will appear in your AWS console and make it easier for you to group functions by tag or find functions with a common tag.

```yaml
functions:
  hello:
    handler: handler.hello
    tags:
      foo: bar
```

Or if you want to apply tags configuration to all functions in your service, you can add the configuration to the higher level `provider` object. Tags configured at the function level are merged with those at the provider level, so your function with specific tags will get the tags defined at the provider level. If a tag with the same key is defined at both the function and provider levels, the function-specific value overrides the provider-level default value. For example:

```yaml
# serverless.yml
service: service-name
provider:
  name: aws
  tags:
    foo: bar
    baz: qux

functions:
  hello:
    # this function will inherit the service level tags config above
    handler: handler.hello
  users:
    # this function will overwrite the foo tag and inherit the baz tag
    handler: handler.users
    tags:
      foo: quux
```

Real-world use cases where tagging your functions is helpful include:

- Cost estimations (tag functions with an environment tag: `environment: Production`)
- Keeping track of legacy code (e.g. tag functions which use outdated runtimes: `runtime: legacy`)
- ...

## Layers

Using the `layers` configuration makes it possible for your function to use
[Lambda Layers](https://aws.amazon.com/blogs/aws/new-for-aws-lambda-use-any-programming-language-and-share-common-components/)

```yaml
functions:
  hello:
    handler: handler.hello
    layers:
      - arn:aws:lambda:region:XXXXXX:layer:LayerName:Y
```

Layers can be used in combination with `runtime: provided.al2023` to implement your own custom runtime on
AWS Lambda.

To publish Lambda Layers, check out the [Layers](./layers.md) documentation.

## Log Group Resources

By default, osls will create LogGroups for your Lambdas. This makes it easy to clean up your log groups in the case you remove your service, and make the lambda IAM permissions much more specific and secure.

You can opt out of the default behavior by setting `disableLogs: true`

You can also specify the duration for CloudWatch log retention by setting `logRetentionInDays`.

You can specify the DataProtectionPolicy for the LogGroup by setting `logDataProtectionPolicy`. On how to define the policy consult the [aws docs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/mask-sensitive-log-data-start.html).

```yaml
functions:
  hello:
    handler: handler.hello
    disableLogs: true
  goodBye:
    handler: handler.goodBye
    logRetentionInDays: 14
    logDataProtectionPolicy:
      Name: data-protection-policy
```

## Versioning Deployed Functions

By default, osls creates function versions for every deploy. This behavior is optional, and can be turned off in cases where you don't invoke past versions by their qualifier. If you would like to do this, you can invoke your functions as `arn:aws:lambda:....:function/myFunc:3` to invoke version 3 for example.

Older versions are not removed automatically unless you enable `provider.pruneFunctionVersions`. When enabled, osls deletes function and layer versions beyond the configured limit after a full service deploy (`osls deploy`), keeping the newest versions. Function versions referenced by an alias are never deleted; layer versions are pruned purely by recency. `osls deploy function` does not publish new versions and does not prune.

To turn off function versioning, set the provider-level option `versionFunctions`. `pruneFunctionVersions` cannot be used when `versionFunctions` is `false`, unless the only functions publishing versions are durable: at least one function configures `durableConfig` and no other function sets `versionFunction: true`. Functions configured with `durableConfig` are always skipped by function pruning, so in this configuration only layer versions are pruned.

```yaml
provider:
  versionFunctions: false
```

You can also override this on a per-function basis with the function-level `versionFunction` property (note the singular form). This is useful when you have disabled versioning at the provider level but still want versions published for a specific function:

```yaml
provider:
  versionFunctions: false

functions:
  hello:
    handler: handler.hello
    versionFunction: true # publish versions for this function only
```

Enable automatic pruning after deploy:

```yaml
provider:
  pruneFunctionVersions: true # keeps 10 versions (default)
  # pruneFunctionVersions:
  #   number: 20
```

`number` is how many of the newest versions to keep; the currently-deployed version is always retained. Replicated Lambda@Edge versions that AWS will not delete are skipped with a warning rather than failing the deploy.

## Conditional deployment & explicit dependencies

You can attach a CloudFormation [Condition](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/conditions-section-structure.html) to a function with the `condition` property, and declare explicit CloudFormation [DependsOn](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-attribute-dependson.html) relationships with the `dependsOn` property.

```yaml
functions:
  hello:
    handler: handler.hello
    # References a condition defined under resources.Conditions
    condition: ShouldDeployHello
    # Force CloudFormation to create these resources first
    dependsOn:
      - MyThing
      - MyOtherThing

resources:
  Conditions:
    ShouldDeployHello:
      Fn::Equals:
        - ${sls:stage}
        - prod
```

The `condition` is applied to the function and the companion resources generated by the core functions compiler (the function version, alias, function URL, and event invoke config) as well as the function's log group.

> **Warning:** When the condition evaluates to `false` on an update, CloudFormation deletes the function's log group **including all retained log events** — the same behavior as removing the function from the configuration. To preserve logs across condition flips, override the generated log group with a `Retain` deletion policy:
>
> ```yaml
> resources:
>   Resources:
>     HelloLogGroup:
>       DeletionPolicy: Retain
> ```
>
> A retained physical log group must be manually deleted or imported before the condition can flip back to `true`. Note also that resources generated for `events` (Lambda permissions, subscriptions, rules, API Gateway resources, etc.) do **not** inherit this condition, so combining `condition` with `events` can fail to deploy when the condition is false.

## Dead Letter Queue (DLQ)

When AWS lambda functions fail, they are [retried](http://docs.aws.amazon.com/lambda/latest/dg/retries-on-errors.html). If the retries also fail, AWS has a feature to send information about the failed request to a SNS topic or SQS queue, called the [Dead Letter Queue](http://docs.aws.amazon.com/lambda/latest/dg/dlq.html), which you can use to track and diagnose and react to lambda failures.

You can setup a dead letter queue for your serverless functions with the help of a SNS topic and the `onError` config parameter.

**Note:** You can only provide one `onError` config per function.

### DLQ with SNS

The SNS topic needs to be created beforehand and provided as an `arn` on the function level.

```yaml
service: service

provider:
  name: aws
  runtime: nodejs24.x

functions:
  hello:
    handler: handler.hello
    onError: arn:aws:sns:us-east-1:XXXXXX:test # Ref, Fn::GetAtt and Fn::ImportValue are supported as well
```

### DLQ with SQS

Although Dead Letter Queues support both SNS topics and SQS queues, the `onError` config currently only supports SNS topic arns due to a race condition when using SQS queue arns and updating the IAM role.

We're working on a fix so that SQS queue arns will be supported in the future.

## KMS Keys

AWS Lambda uses [AWS Key Management Service (KMS)](https://aws.amazon.com/kms/) to encrypt your environment variables at rest.

The `kmsKeyArn` config variable enables you a way to define your own KMS key which should be used for encryption.

```yaml
service:
  name: service-name

provider:
  name: aws
  kmsKeyArn: arn:aws:kms:us-east-1:XXXXXX:key/some-hash
  environment:
    TABLE_NAME: tableName1

functions:
  hello: # this function will OVERWRITE the service level environment config above
    handler: handler.hello
    kmsKeyArn: arn:aws:kms:us-east-1:XXXXXX:key/some-hash
    environment:
      TABLE_NAME: tableName2
  goodbye: # this function will INHERIT the service level environment config above
    handler: handler.goodbye
```

### Secrets using environment variables and KMS

When storing secrets in environment variables, AWS [strongly suggests](http://docs.aws.amazon.com/lambda/latest/dg/env_variables.html#env-storing-sensitive-data) encrypting sensitive information. AWS provides a [tutorial](http://docs.aws.amazon.com/lambda/latest/dg/tutorial-env_console.html) on using KMS for this purpose.

For more on handling secrets safely — including resolving values from SSM Parameter Store and AWS Secrets Manager at deploy time — see the [Security guide](./security.md) and the [`${ssm:}` / `${aws:}` variable sources](./variables.md).

## AWS X-Ray Tracing

You can enable [AWS X-Ray Tracing](https://docs.aws.amazon.com/xray/latest/devguide/aws-xray.html) on your Lambda functions through the optional `tracing` config variable:

```yaml
service: myService

provider:
  name: aws
  runtime: nodejs24.x
  tracing:
    lambda: true
```

You can also set this variable on a per-function basis. This will override the provider level setting if present:

```yaml
functions:
  hello:
    handler: handler.hello
    tracing: Active
  goodbye:
    handler: handler.goodbye
    tracing: PassThrough
```

## Asynchronous invocation

When intention is to invoke function asynchronously you may want to configure following additional settings:

### Destinations

[destination targets](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html#invocation-async-destinations)

Target can be the other lambdas you also deploy with a service or other qualified target (externally managed lambda, EventBridge event bus, SQS queue or SNS topic) which you can address via its ARN or reference

```yaml
functions:
  asyncHello:
    handler: handler.asyncHello
    destinations:
      onSuccess: otherFunctionInService
      onFailure: arn:aws:sns:us-east-1:xxxx:some-topic-name
  asyncGoodBye:
    handler: handler.asyncGoodBye
    destinations:
      onFailure:
        # For the case using CF intrinsic function for `arn`, to ensure target execution permission exactly, you have to specify `type` from 'sns', 'sqs', 'eventBus', 'function'.
        type: sns
        arn:
          Ref: SomeTopicName
```

### Maximum Event Age and Maximum Retry Attempts

`maximumEventAge` accepts values between 60 seconds and 6 hours, provided in seconds.
`maximumRetryAttempts` accepts values between 0 and 2.

The top-level `functions[].maximumRetryAttempts` setting is not supported for durable functions because Lambda asynchronous retry attempts do not apply to durable executions. Use retry strategies in the AWS Durable Execution SDK for durable workflow steps. Event source mapping retry settings are separate and remain available where AWS supports them.

```yaml
functions:
  asyncHello:
    handler: handler.asyncHello
    maximumEventAge: 7200
    maximumRetryAttempts: 1
```

## EFS Configuration

You can use [Amazon EFS with Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-efs.html) by adding a `fileSystemConfig` property in the function configuration in `serverless.yml`. `fileSystemConfig` should be an object that contains the `arn` and `localMountPath` properties. The `arn` property should reference an existing EFS Access Point, where the `localMountPath` should specify the absolute path under which the file system will be mounted. Here's an example configuration:

```yaml
# serverless.yml
service: service-name
provider: aws

functions:
  hello:
    handler: handler.hello
    fileSystemConfig:
      localMountPath: /mnt/example
      arn: arn:aws:elasticfilesystem:us-east-1:111111111111:access-point/fsap-0d0d0d0d0d0d0d0d0
    vpc:
      securityGroupIds:
        - securityGroupId1
      subnetIds:
        - subnetId1
```

## Ephemeral storage

By default, Lambda [allocates 512 MB of ephemeral storage](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-common.html#configuration-ephemeral-storage) in functions under the `/tmp` directory.

You can increase its size via the `ephemeralStorageSize` property. It should be a numerical value in MBs, between 512 and 10240.

```yaml
functions:
  helloEphemeral:
    handler: handler.handler
    ephemeralStorageSize: 1024
```

## Logging Configuration

[Configuring Lambda advanced logging options](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs.html#monitoring-cloudwatchlogs-advanced)

This can be configured at the provider level (applies to all functions) or individually per function:

```yaml
# Provider-level configuration (applies to all functions)
provider:
  logs:
    lambda:
      logFormat: JSON
      applicationLogLevel: INFO
      systemLogLevel: WARN
      logGroup: /aws/lambda/global-log-group

# Function-level configuration (overrides provider settings)
functions:
  helloLogging:
    handler: handler.handler
    logs:
      applicationLogLevel: DEBUG
      logFormat: JSON
      logGroup: helloLoggingLogGroup
      systemLogLevel: DEBUG
```
