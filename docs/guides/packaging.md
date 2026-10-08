# Packaging

## Package CLI Command

Using the osls CLI tool, you can package your project without deploying it to AWS. This is best used with CI / CD workflows to ensure consistent deployable artifacts.

Running the following command will build and save all of the deployment artifacts in the service's .serverless directory:

```bash
osls package
```

However, you can also use the --package option to add a destination path and osls will store your deployment artifacts there (./my-artifacts in the following case):

```bash
osls package --package my-artifacts
```

The same destination can be set in configuration with the `package.path` property, so the artifact directory is consistent across runs without passing the flag every time:

```yaml
package:
  path: my-artifacts
```

A later `osls deploy --package my-artifacts` (or a deploy run with `package.path` set) skips the build step and deploys the pre-built artifacts. This `package` → `deploy --package` split is the recommended pattern for CI/CD pipelines; see the [CI/CD guide](./cicd.md) for a full walkthrough, including the requirement that the stage and region used to package match those used to deploy.

You can also pass `--minify-template` to `osls package` or `osls deploy` to strip whitespace from the generated CloudFormation template, which helps stay under CloudFormation's template-size limits for large services.

## Package Configuration

Sometimes you might like to have more control over your function artifacts and how they are packaged.

You can use the `package` and `patterns` configuration for more control over the packaging process.

### Patterns

Patterns allows you to define globs that will be excluded / included from the resulting artifact. If you wish to exclude files you can use a glob pattern prefixed with `!` such as `!exclude-me/**`.
osls will run the glob patterns in order so you can always re-include previously excluded files and directories.

By default, osls will exclude the following patterns:

- .git/\*\*
- .gitignore
- .DS_Store
- npm-debug.log
- yarn-\*.log
- .serverless/\*\*
- .serverless_plugins/\*\*

and the serverless configuration file being used (i.e. `serverless.yml`). In addition, if `useDotenv` is set, all files satisfying pattern `.env*` will be excluded as well.

### Examples

Exclude all node_modules but then re-include a specific modules (in this case node-fetch) using `exclude` exclusively

```yaml
package:
  patterns:
    - '!node_modules/**'
    - 'node_modules/node-fetch/**'
```

Exclude all files but `handler.js`

```yaml
package:
  patterns:
    - '!src/**'
    - src/function/handler.js
```

**Note:** Don't forget to use the correct glob syntax if you want to exclude directories

```yaml
package:
  patterns:
    - '!tmp/**'
    - '!.git/**'
```

### Size limit

AWS Lambda limits a function's code and layers to 250 MB once unzipped. When a package built by osls is larger than that, `osls package` and `osls deploy` fail before anything is uploaded, and list the largest files and directories of the package. Use `patterns` to exclude files that are not needed at runtime.

### Artifact

For complete control over the packaging process you can specify your own artifact zip file.
osls won't zip your service if this is configured and therefore `patterns` will be ignored. Either you use artifact or patterns.

The artifact option is especially useful in case your development environment allows you to generate a deployable artifact like Maven does for Java.

> **Security note:** Local artifact paths are trusted deployment inputs. Relative paths are resolved from the service root, and absolute paths or paths outside the service may be read and uploaded as deployment artifacts. Use artifact paths only from trusted configuration and trusted build scripts.

#### Service package

```yaml
service: my-service
package:
  artifact: path/to/my-artifact.zip
```

#### Individual function packages

You can also use this to package functions individually:

```yaml
service: my-service

package:
  individually: true

functions:
  hello:
    handler: com.serverless.Handler
    package:
      artifact: hello.jar
    events:
      - httpApi: 'GET /hello'
```

#### Artifacts hosted on S3

Artifacts can also be fetched from a remote S3 bucket. In this case you just need to provide the S3 object URI (old style or new) as the artifact value. This applies to both, service-wide and function-level artifact setups.

**Note:** At this time, only S3 URIs are supported. osls does not yet support fetching artifacts from non-S3 remote locations.

##### Service package

```yaml
service: my-service

package:
  artifact: s3://some-bucket/path/to/service-artifact.zip
```

##### Individual function packages

```yaml
service: my-service

package:
  individually: true

functions:
  hello:
    handler: com.serverless.Handler
    package:
      artifact: s3://some-bucket/path/to/service-artifact.zip
```

### Packaging functions separately

If you want even more controls over your functions for deployment you can configure them to be packaged independently. This allows you more control for optimizing your deployment. To enable individual packaging set `individually` to true in the service or function wide packaging settings.

Then for every function you can use the same `patterns` or `artifact` config options as you can service wide. The `patterns` option will be merged with the service wide options to create one `patterns` config per function during packaging.

```yaml
service: my-service
package:
  individually: true
  patterns:
    - '!excluded-by-default.json'
functions:
  hello:
    handler: handler.hello
    package:
      # We're including this file so it will be in the final package of this function only
      patterns:
        - excluded-by-default.json
  world:
    handler: handler.hello
    package:
      patterns:
        - '!some-file.js'
```

You can also select which functions to be packaged separately, and have the rest use the service package by setting the `individually` flag at the function level:

```yaml
service: my-service
functions:
  hello:
    handler: handler.hello
  world:
    handler: handler.hello
    package:
      individually: true
```

### Development dependencies

osls will auto-detect and exclude development dependencies based on the runtime your service is using.

This ensures that only the production relevant packages and modules are included in your zip file. Doing this drastically reduces the overall size of the deployment package which will be uploaded to the cloud provider.

You can opt-out of automatic dev dependency exclusion by setting the `excludeDevDependencies` package config to `false`:

```yaml
package:
  excludeDevDependencies: false
```

### Pruning previous deployment artifacts

Each deployment uploads its artifacts to the deployment bucket. To avoid that bucket growing unbounded, osls prunes older deployment artifacts after a successful deploy, keeping the 5 most recent deployments by default. You can change how many previous deployments are retained with the `maxPreviousDeploymentArtifacts` property under `provider.deploymentBucket`:

```yaml
provider:
  name: aws
  deploymentBucket:
    maxPreviousDeploymentArtifacts: 10 # default is 5
```

Set it to a higher value if you need to keep more rollback targets, or to `0` to retain only the current deployment.
