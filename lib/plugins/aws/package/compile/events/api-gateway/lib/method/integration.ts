'use strict';

const { safeSet, safeShallowAssign } = require('../../../../../../../../utils/safe-object');

const DEFAULT_COMMON_TEMPLATE = `
  #define( $loop )
    {
    #foreach($key in $map.keySet())
        #set( $k = $util.escapeJavaScript($key) )
        #set( $v = $util.escapeJavaScript($map.get($key)).replaceAll("\\\\'", "'") )
        "$k":
          "$v"
          #if( $foreach.hasNext ) , #end
    #end
    }
  #end

  {
    "body": $body,
    "method": "$context.httpMethod",
    "principalId": "$context.authorizer.principalId",
    "stage": "$context.stage",

    "cognitoPoolClaims" : {
       extraCognitoPoolClaims
       "sub": "$context.authorizer.claims.sub"
    },

    #set( $map = $context.authorizer )
    "enhancedAuthContext": $loop,

    #set( $map = $input.params().header )
    "headers": $loop,

    #set( $map = $input.params().querystring )
    "query": $loop,

    #set( $map = $input.params().path )
    "path": $loop,

    #set( $map = $context.identity )
    "identity": $loop,

    #set( $map = $stageVariables )
    "stageVariables": $loop,

    "requestPath": "$context.resourcePath"
  }
`;

module.exports = {
  getMethodIntegration(http, { lambdaLogicalId, lambdaAliasName }) {
    const type = http.integration || 'AWS_PROXY';
    const globalApiTimeout =
      this.serverless.service &&
      this.serverless.service.provider &&
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.timeoutInMillis;

    const integration = {
      IntegrationHttpMethod: 'POST',
      Type: type,
      TimeoutInMillis: http.timeoutInMillis || globalApiTimeout || undefined,
    };

    // Valid integrations are:
    // * `HTTP` for integrating with an HTTP back end,
    // * `AWS` for any AWS service endpoints,
    // * `MOCK` for testing without actually invoking the back end,
    // * `HTTP_PROXY` for integrating with the HTTP proxy integration, or
    // * `AWS_PROXY` for integrating with the Lambda proxy integration type (the default)
    if (type === 'AWS' || type === 'AWS_PROXY') {
      const responseTransferMode = http.response && http.response.transferMode;
      const isStreaming =
        responseTransferMode &&
        responseTransferMode.toUpperCase() === 'STREAM' &&
        type === 'AWS_PROXY';
      const lambdaPathVersion = isStreaming ? '2021-11-15' : '2015-03-31';
      const invocationPath = isStreaming ? '/response-streaming-invocations' : '/invocations';

      Object.assign(integration, {
        Uri: {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':apigateway:',
              { Ref: 'AWS::Region' },
              `:lambda:path/${lambdaPathVersion}/functions/`,
              ...[],
              { 'Fn::GetAtt': [lambdaLogicalId, 'Arn'] },
              ...(lambdaAliasName ? [':', lambdaAliasName] : []),
              invocationPath,
            ],
          ],
        },
      });
    } else if (type === 'HTTP' || type === 'HTTP_PROXY') {
      const integrationHttpMethod = (http.request && http.request.method) || http.method;
      Object.assign(integration, {
        Uri: http.request && http.request.uri,
        IntegrationHttpMethod: integrationHttpMethod.toUpperCase(),
      });
      if (http.connectionType) {
        Object.assign(integration, {
          ConnectionType: http.connectionType,
          ConnectionId: http.connectionId,
        });
      }
    } else if (type === 'MOCK') {
      // nothing to do but kept here for reference
    }

    if (type === 'AWS' || type === 'HTTP' || type === 'MOCK') {
      Object.assign(integration, {
        PassthroughBehavior: http.request && http.request.passThrough,
        ContentHandling: http.request && http.request.contentHandling,
        RequestTemplates: this.getIntegrationRequestTemplates(http, type === 'AWS'),
        IntegrationResponses: this.getIntegrationResponses(http),
      });
    }
    if (
      ((type === 'AWS' || type === 'HTTP' || type === 'HTTP_PROXY') &&
        http.request &&
        http.request.parameters &&
        Object.keys(http.request.parameters).length) ||
      http.async
    ) {
      Object.assign(integration, {
        RequestParameters: this.getIntegrationRequestParameters(http),
      });
    }

    const responseTransferMode = http.response && http.response.transferMode;
    const supportsResponseTransferMode =
      !!responseTransferMode && (type === 'AWS_PROXY' || type === 'HTTP_PROXY');
    if (supportsResponseTransferMode) {
      Object.assign(integration, { ResponseTransferMode: responseTransferMode });
    }

    return {
      Properties: {
        Integration: integration,
      },
    };
  },

  getIntegrationResponses(http) {
    const integrationResponses = [];
    const mapHeaders = (headers) =>
      Object.fromEntries(
        Object.entries(headers).map(([header, value]) => [
          `method.response.header.${header}`,
          value,
        ])
      );

    if (http.response) {
      const integrationResponseHeaders = {};

      if (http.cors) {
        let origin = http.cors.origin;

        // TODO remove once "origins" config is deprecated
        if (http.cors.origins && http.cors.origins.length) {
          origin = http.cors.origins.join(',');
        }

        Object.assign(integrationResponseHeaders, {
          'Access-Control-Allow-Origin': `'${origin}'`,
        });

        // Only set Access-Control-Allow-Credentials when explicitly allowed (omit if false)
        if (http.cors.allowCredentials) {
          integrationResponseHeaders['Access-Control-Allow-Credentials'] = 'true';
        }
      }

      if (http.response.headers) {
        safeShallowAssign(integrationResponseHeaders, http.response.headers);
      }

      Object.entries(http.response.statusCodes).forEach(([statusCode, config]) => {
        const responseParameters = mapHeaders(integrationResponseHeaders);

        const integrationResponse = {
          StatusCode: statusCode,
          SelectionPattern: config.pattern || '',
          ResponseParameters: responseParameters,
          ResponseTemplates: {},
          ContentHandling: statusCode.startsWith('2') ? http.response.contentHandling : undefined,
        };

        if (config.headers) {
          Object.assign(integrationResponse.ResponseParameters, mapHeaders(config.headers));
        }

        if (http.response.template) {
          Object.assign(integrationResponse.ResponseTemplates, {
            'application/json': http.response.template,
          });
        }

        if (config.template) {
          const template =
            typeof config.template === 'string'
              ? { 'application/json': config.template }
              : config.template;

          safeShallowAssign(integrationResponse.ResponseTemplates, template);
        }

        integrationResponses.push(integrationResponse);
      });
    }

    return integrationResponses;
  },

  getIntegrationRequestTemplates(http, useDefaults) {
    // default request templates
    const integrationRequestTemplates = {};

    // Only set defaults for AWS (lambda) integration
    if (useDefaults) {
      Object.assign(integrationRequestTemplates, {
        'application/json': this.DEFAULT_JSON_REQUEST_TEMPLATE,
        'application/x-www-form-urlencoded': this.DEFAULT_FORM_URL_ENCODED_REQUEST_TEMPLATE,
      });
    }

    // set custom request templates if provided
    if (http.request && typeof http.request.template === 'object') {
      Object.entries(http.request.template).forEach(([contentType, template]) => {
        if (template === null) {
          delete integrationRequestTemplates[contentType];
        } else {
          safeSet(integrationRequestTemplates, contentType, template);
        }
      });
    }

    return Object.keys(integrationRequestTemplates).length
      ? integrationRequestTemplates
      : undefined;
  },
  getIntegrationRequestParameters(http) {
    const parameters = {};
    if (http.request && http.request.parameters) {
      Object.entries(http.request.parameters).forEach(([key, value]) => {
        parameters[`integration.${key.substring('method.'.length)}`] = value.mappedValue || key;
      });
    }

    if (http.async) {
      parameters['integration.request.header.X-Amz-Invocation-Type'] = "'Event'";
    }

    return parameters;
  },

  DEFAULT_JSON_REQUEST_TEMPLATE: `
    #set( $body = $input.json("$") )

    ${DEFAULT_COMMON_TEMPLATE}
  `,

  DEFAULT_FORM_URL_ENCODED_REQUEST_TEMPLATE: `
    #define( $body )
      {
      #foreach( $token in $input.path('$').split('&') )
        #set( $keyVal = $token.split('=') )
        #set( $keyValSize = $keyVal.size() )
        #if( $keyValSize >= 1 )
          #set( $key = $util.escapeJavaScript($util.urlDecode($keyVal[0])) )
          #if( $keyValSize >= 2 )
            #set($val = $util.escapeJavaScript($util.urlDecode($keyVal[1])).replaceAll("\\\\'","'"))
          #else
            #set( $val = '' )
          #end
          "$key": "$val"#if($foreach.hasNext),#end
        #end
      #end
      }
    #end

    ${DEFAULT_COMMON_TEMPLATE}
  `,
};
