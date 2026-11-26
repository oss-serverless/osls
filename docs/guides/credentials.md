# AWS Credentials

osls needs access to your cloud provider account so that it can create and manage resources on your behalf.

This guide is for the Amazon Web Services (AWS) provider, so we'll step through the process of setting up credentials for AWS and using them with osls.

## Sign up for an AWS account

If you already have an AWS account, skip to the next step to [create an IAM User and Access Key](#create-an-iam-user-and-access-key)

To create an AWS account:

1. Open https://aws.amazon.com/, and then choose Create an AWS Account.
2. Follow the online instructions.

- Part of the sign-up procedure involves receiving a phone call and entering a PIN using the phone keypad.

Note your AWS account ID, because you'll need it for the next task.

All AWS users get access to the Free Tier for [AWS Lambda](https://aws.amazon.com/lambda/pricing/). AWS Lambda is part of the non-expiring [AWS Free Tier](https://aws.amazon.com/free/#AWS_FREE_TIER). While in the AWS Free Tier, you can build an entire application on AWS Lambda, AWS API Gateway, and more, without getting charged for one year or longer, in some cases, as long as you don't exceed the resources in the free tier.

If you're new to Amazon Web Services, make sure you put in a credit card. If you don't have a credit card set up, you may not be able to deploy your resources and you may run into this error:

```text
AWS Access Key Id needs a subscription for the service
```

## Create an IAM User and Access Key

Now that you have an AWS account, you need to configure AWS credentials so that `osls` can deploy to AWS. For that, you can create AWS access keys and configure them on your machine.

### Creating AWS Access Keys

Follow these steps to create new AWS access keys:

1. Login to your AWS account and go to the Identity & Access Management (IAM) page.

2. Click on **Users** and then **Add user**. Enter a name in the first field to remind you this user is related to osls, like `serverless-admin`. Enable **Programmatic access** by clicking the checkbox. Click **Next** to go through to the Permissions page. Click on **Attach existing policies directly**. Search for and select **AdministratorAccess** then click **Next: Review**. Check to make sure everything looks good and click **Create user**.

3. View and copy the **API Key** & **Secret** to a temporary place. These are your AWS access keys.

Note that the above steps grant osls administrative access to your account. While this makes things simple when starting out, we recommend that you create and use more fine-grained permissions once you determine the scope of your serverless applications and move them into production.

To limit the access osls has to your AWS account, follow these steps to **create an IAM User** and attach a custom JSON file policy to your new IAM User. This IAM User will have its own set of AWS Access Keys.

1. Login to your AWS Account and go to the Identity & Access Management (IAM) page.

2. Click on **Users** and then **Add user**. Enter a name in the first field to remind you this User is related to the Service you are deploying with osls, like `serverless-servicename-agent`. Enable **Programmatic access** by clicking the checkbox. Click **Next** to go through to the Permissions page. Click on **Create policy**. Select the **JSON** tab, and add a JSON file. You can use [this gist](https://gist.github.com/ServerlessBot/7618156b8671840a539f405dea2704c8) as a guide.

   When you are finished, select **Review policy**. You can assign this policy a **Name** and **Description**, then choose **Create Policy**. Check to make sure everything looks good and click **Create user**. Later, you can create different IAM Users for different apps and different stages of those apps. That is, if you don't use separate AWS accounts for stages/apps, which is most common.

3. View and copy the **API Key** & **Secret** to a temporary place. These are your AWS access keys.

### Using AWS Access Keys

You can configure osls to use your AWS access keys in two ways:

#### Quick Setup

As a quick setup to get started you can export them as environment variables so they would be accessible to osls and the AWS SDK in your shell:

```bash
export AWS_ACCESS_KEY_ID=<your-key-here>
export AWS_SECRET_ACCESS_KEY=<your-secret-key-here>
# AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are now available for osls to use
osls deploy

# 'export' command is valid only for unix shells
# In Windows use 'set' instead of 'export'
```

**Please note:** _If you are using a self-signed certificate you'll need to do one of the following:_

```bash
# String example:
# if using the 'ca' variable, your certificate contents should replace the newline character with '\n'
export ca="-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----"
# or multiple, comma separated
export ca="-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----,-----BEGIN CERTIFICATE-----...-----END CERTIFICATE-----"

# File example:
# if using the 'cafile' variable, your certificate contents should not contain '\n'
export cafile="/path/to/cafile.pem"
# or multiple, comma separated
export cafile="/path/to/cafile1.pem,/path/to/cafile2.pem"

# 'export' command is valid only for unix shells
# In Windows use 'set' instead of 'export'
```

#### Using AWS Profiles

For a more permanent solution you can also set up credentials through AWS profiles. Here are different methods you can use to do so.

##### Setup with `osls config credentials` command

osls provides a convenient way to configure AWS profiles with the help of the `osls config credentials` command.

Here's an example how you can configure the `default` AWS profile:

```bash
osls config credentials \
  --provider aws \
  --key AKIAIOSFODNN7EXAMPLE \
  --secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

Take a look at the [`config` CLI reference](../cli-reference/config-credentials.md) for more information about credential configuration.

##### Setup with the `aws-cli`

To set them up through the `aws-cli` [install it first](http://docs.aws.amazon.com/cli/latest/userguide/installing.html) then run `aws configure` [to configure the aws-cli and credentials](http://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html):

```bash
$ aws configure
AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name [None]: us-west-2
Default output format [None]: ENTER
```

Credentials are stored in INI format in `~/.aws/credentials`, which you can edit directly if needed. You can change the path to the credentials file via the AWS_SHARED_CREDENTIALS_FILE environment variable. Read more about that file in the [AWS documentation](http://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html#cli-config-files)

You can even set up different profiles for different accounts, which can be used by osls as well. To specify a default profile to use, you can add a `profile` setting to your `provider` configuration in `serverless.yml`:

```yaml
service: new-service
provider:
  name: aws
  runtime: nodejs26.x
  stage: dev
  profile: devProfile
```

##### Use an existing AWS Profile

To easily switch between projects without the need to do `aws configure` every time you can use environment variables.
For example you define different profiles in `~/.aws/credentials`

```ini
[profileName1]
aws_access_key_id=***************
aws_secret_access_key=***************

[profileName2]
aws_access_key_id=***************
aws_secret_access_key=***************
```

Now you can switch per project (/ API) by executing once when you start your project:

`export AWS_PROFILE="profileName2"`.

in the Terminal. Now everything is set to execute all the `osls` CLI options like `osls deploy`.

##### Using the `aws-profile` option

You can always specify the profile which should be used via the `aws-profile` option like this:

```bash
osls deploy --aws-profile devProfile
```

##### Using web identity token

To use web identity token authentication the `AWS_WEB_IDENTITY_TOKEN_FILE` and `AWS_ROLE_ARN` environment need to be set. It is automatically set if you specify a service account in AWS EKS.

##### IAM Identity Center (SSO) profiles

Profiles that authenticate through IAM Identity Center work out of the box, whether they use a modern `sso-session` section, a legacy `sso_*` configuration, or reach the SSO configuration through `role_arn`/`source_profile` chaining. When the SSO session is missing or expired, osls starts the standard device authorization flow automatically: it prints a verification URL and user code, waits for the browser approval, and retries credential resolution. Tokens are cached in `~/.aws/sso/cache` in the same format the AWS CLI uses, so osls and `aws sso login` share sessions in both directions.

The automatic login requires an interactive terminal. In non-interactive environments (for example CI) the command fails fast with an `AWS_SSO_LOGIN_UNAVAILABLE` error instead of hanging; run `aws sso login --profile <profile>` beforehand or supply credentials another way.

#### Per Stage Profiles

As an advanced use-case, you can deploy different stages to different accounts by using different profiles per stage. In order to use different profiles per stage, you must leverage [variables](./variables.md) and the provider profile setting.

This example `serverless.yml` snippet will load the profile depending upon the stage specified in the command line options (or default to 'dev' if unspecified);

```yaml
service: new-service
provider:
  name: aws
  runtime: nodejs26.x
  profile: ${self:custom.profiles.${sls:stage}}
custom:
  profiles:
    dev: devProfile
    prod: prodProfile
```

#### Profile in place with the 'invoke local' command

**Be aware!** Due to the way AWS IAM and the local environment works, if you invoke your lambda functions locally using the CLI command `osls invoke local -f ...` the IAM role/profile could be (and probably is) different from the one set in the `serverless.yml` configuration file.
Thus, most likely, a different set of permissions will be in place, altering the interaction between your lambda functions and other AWS resources.

_Please, refer to the [`invoke local`](../cli-reference/invoke-local.md#aws---invoke-local) CLI command documentation for more details._

## Assuming a role when deploying

It is possible to use local AWS credentials to _assume_ another AWS role.

That allows the deployment (and all other CLI commands) to be performed under a different role. To achieve this, [follow this documentation from AWS](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-role.html).

Note that `serverless.yml` also offers the `provider.iam.deploymentRole` option. This lets us force CloudFormation to use a different role when deploying:

```yaml
provider:
  iam:
    deploymentRole: arn:aws:iam::123456789012:role/deploy-role
```

It is important to understand that `deploymentRole` only affects the role CloudFormation will assume. All other interactions from the `osls` CLI with AWS will not use that `deploymentRole`.

This is why we usually recommend using the "assume role" method described above instead of `deploymentRole`.

## Running behind a proxy

osls routes its HTTP traffic — AWS API calls, credential resolution (including IAM Identity Center / SSO), and template, plugin registry, layer, and rollback code downloads — through the proxy configured in the standard environment variables:

```bash
export HTTPS_PROXY=http://proxy.example.com:8080
```

AWS API calls and credential resolution use the first defined of `proxy`, `HTTP_PROXY`, `http_proxy`, `HTTPS_PROXY`, or `https_proxy`. Other downloads follow standard proxy semantics: `HTTPS_PROXY` for `https` URLs, `HTTP_PROXY` for `http` URLs, and `NO_PROXY` exclusions are honored.

If your proxy intercepts TLS with its own certificate authority, provide it via the `ca` or `cafile` environment variables described in the [self-signed certificate note](#quick-setup) above. The certificates apply to AWS API calls and downloads alike.

AWS requests time out after 120 seconds of socket inactivity. Slow or unreliable proxy connections can be accommodated with a higher limit in milliseconds:

```bash
export AWS_CLIENT_TIMEOUT=300000
```
