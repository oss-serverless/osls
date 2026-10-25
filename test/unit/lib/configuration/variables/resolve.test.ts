'use strict';

const { expect } = require('chai');

const wait = require('../../../../../lib/utils/sleep');
const ServerlessError = require('../../../../../lib/serverless-error');
const resolveMeta = require('../../../../../lib/configuration/variables/resolve-meta');
const resolve = require('../../../../../lib/configuration/variables/resolve');

describe('test/unit/lib/configuration/variables/resolve.test.js', () => {
  describe('Complete resolution', () => {
    const configuration = {
      foo: {
        params: '${sourceParam(param1, param2)}',
        varParam: '${sourceParam(${sourceDirect:})}',
      },
      static: true,
      address: 'foo${sourceAddress:address-result}',
      varAddress: 'foo${sourceAddress:${sourceDirect:}}',
      direct: '${sourceDirect:}',
      property: '${sourceProperty(direct)}',
      escape:
        'e\\${sourceDirect:}n\\$${sourceProperty(address)}qe\\\\\\${sourceProperty(direct)}qn\\\\${sourceProperty(address)}',
      otherProperty: '${sourceProperty(varAddress)}',
      deepProperty: '${sourceProperty(foo)}',
      deepPropertyUnrecognized: '${sourceProperty(nestUnrecognized)}',
      deepPropertyErrored: '${sourceProperty(nestErrored)}',
      staticProperty: '${sourceProperty(static)}',
      propertyUnrecognized: '${sourceProperty(nestUnrecognized, unrecognized)}',
      propertyErrored: '${sourceProperty(nestErrored, erroredAddress)}',
      propertyCircularA: '${sourceProperty(propertyCircularB)}',
      propertyCircularB: '${sourceProperty(propertyCircularA)}',
      propertyDeepCircularA: '${sourceProperty(propertyDeepCircularB)}',
      propertyDeepCircularB: '${sourceProperty(propertyDeepCircularC)}',
      propertyDeepCircularC: '${sourceProperty(propertyDeepCircularA)}',
      propertyRoot: '${sourceProperty:}',
      withString: 'foo${sourceDirect:}',
      resolvesResultVariablesObject: '${sourceResultVariables(object)}',
      resolvesResultVariablesArray: '${sourceResultVariables(array)}',
      resolvesResultVariablesString: '${sourceResultVariables(string)}',
      resolvesResultVariablesStringInvalid: '${sourceResultVariables(stringInvalid)}',
      resolvesResultConcatInvalid: 'prefix-${sourceResultVariables(stringInvalid)}',
      resolveDeepVariablesConcat:
        '${sourceResultVariables(string)}foo${sourceResultVariables(string)}',
      resolveDeepVariablesConcatInParam:
        '${sourceParam(${sourceResultVariables(string)}foo${sourceResultVariables(string)})}',
      resolveDeepVariablesConcatInAddress:
        '${sourceAddress:${sourceResultVariables(string)}foo${sourceResultVariables(string)}}',
      infiniteDeepVariablesConcat:
        '${sourceAddress:${sourceInfiniteString:}foo${sourceResultVariables(string)}}',
      resolveVariablesInString: "${sourceResolveVariablesInString('${sourceProperty(foo)}')}",
      resolvesVariables: '${sourceResolveVariable("sourceParam(${sourceDirect:})")}',
      resolvesVariablesFallback: '${sourceResolveVariable("sourceMissing:, null"), null}',
      resolvesVariablesInvalid1: '${sourceResolveVariable("sourceDirect(")}',
      resolvesVariablesInvalid2: '${sourceResolveVariable("sourceDirect")}',
      incomplete: '${sourceDirect:}elo${sourceIncomplete:}',
      missing: '${sourceDirect:}elo${sourceMissing:}other${sourceMissing:}',
      missingFallback: '${sourceDirect:}elo${sourceMissing:, "foo"}',
      missingFallbackNull: '${sourceMissing:, null}',
      nonStringStringPart: 'elo${sourceMissing:, null}',
      notExistingProperty: "${sourceProperty(not, existing), 'notExistingFallback'}",
      nestUnrecognized: {
        unrecognized:
          '${sourceDirect:}|${sourceUnrecognized:}|${sourceDirect(${sourceUnrecognized:})}' +
          '${sourceDirect:${sourceUnrecognized:}}',
      },
      recognizedInUnrecognized: '${sourceUnrecognized(${sourceDirect:})}',
      erroredParam: '${sourceDirect(${sourceError:})}',
      nestErrored: {
        erroredAddress: '${sourceDirect:${sourceError:}}',
      },
      erroredSourceServerlessError: '${sourceError(serverless-error)}',
      erroredSourceNonServerlessError: '${sourceError:}',
      erroredSourceNonErrorException: '${sourceError(non-error-exception)}|',
      invalidResultCircular: '${sourceError(circular-ref)}',
      invalidResultNonJson: '${sourceError(non-json)}',
      invalidResultNonJsonCircular: '|${sourceError(non-json-circular)}',
      infiniteResolutionRecursion: '${sourceInfinite:}',
      invalidResultValue: '${sourceError(no-value)}',
      sharedSourceResolution1: '${sourceShared:}',
      sharedSourceResolution2: '${sourceProperty(sharedSourceResolution1, sharedFinal)}',
      sharedPropertyResolution1: '${sourceSharedProperty:}',
      sharedPropertyResolution2: '${sourceProperty(sharedPropertyResolution1, sharedFinal)}',
      sharedPropertyRaceCondition1: '${sourceSharedRaceCondition:}',
      sharedPropertyRaceCondition2:
        '${sourceDeferredNull:, sourceProperty(sharedPropertyRaceCondition1, sharedFinal)}',
      nullWithCustomErrorMessage: '${sourceDirectNull:}',
    };
    configuration.arraySource = ['one', 'two', 'three'];
    configuration.arraySourceLength = '${sourceProperty(arraySource, length)}';
    configuration.inheritedConstructorName =
      '${sourceProperty(arraySource, constructor, name), null}';
    configuration.proxyObject = new Proxy(
      { own: 'own-value' },
      {
        get(target, key) {
          if (key === 'virtual') return { nested: 'proxy-virtual' };
          if (key === 'boom') throw new Error('Proxy get trap crashed');
          return target[key];
        },
      }
    );
    configuration.proxyVirtual = '${sourceProperty(proxyObject, virtual, nested)}';
    configuration.proxyOwn = '${sourceProperty(proxyObject, own)}';
    configuration.proxyMissingFallback = "${sourceProperty(proxyObject, missing), 'fallback'}";
    configuration.proxyConstructor = '${sourceProperty(proxyObject, constructor, name), null}';
    configuration.proxyTrapErrored = '${sourceProperty(proxyObject, boom)}';
    configuration.resolvesUnsafeOwnProtoObject = '${sourceResultVariables(protoObject)}';
    Object.defineProperty(configuration, '__proto__', {
      value: '${sourceDirect:}',
      writable: true,
      enumerable: true,
      configurable: true,
    });
    let variablesMeta;
    const sources = {
      sourceParam: {
        resolve: ({ params }) => ({ value: params.join('|').split('').reverse().join('') }),
      },
      sourceAddress: {
        resolve: ({ address }) => ({
          value: typeof address === 'string' ? address.split('').reverse().join('') : address,
        }),
      },
      sourceDirect: {
        resolve: () => ({ value: 234 }),
      },
      sourceDirectNull: {
        resolve: () => ({ value: null, eventualErrorMessage: 'Custom error message from source' }),
      },
      sourceDeferredNull: {
        resolve: async () => {
          await wait(0);
          return { value: null };
        },
      },
      sourceProperty: {
        resolve: async ({ params, resolveConfigurationProperty }) => {
          const result = await resolveConfigurationProperty(params || []);
          return { value: result == null ? null : result };
        },
      },
      sourceResolveVariable: {
        resolve: async ({ params, resolveVariable }) => {
          return { value: await resolveVariable(params[0]) };
        },
      },
      sourceResolveVariablesInString: {
        resolve: async ({ params, resolveVariablesInString }) => {
          return { value: await resolveVariablesInString(params[0]) };
        },
      },
      sourceResultVariables: {
        resolve: ({ params: [type] }) => {
          switch (type) {
            case 'object':
              return { value: { foo: '${sourceDirect:}' } };
            case 'array':
              return { value: [1, '${sourceDirect:}'] };
            case 'protoObject':
              return { value: JSON.parse('{"__proto__":"${sourceDirect:}"}') };
            case 'string':
              return { value: '${sourceDirect:}' };
            case 'stringInvalid':
              return { value: 'leaked-secret-marker${sourceDirect:' };
            case 'error':
              return { value: [1, '${sourceUnrecognized:}', '${sourceError:}'] };
            default:
              throw new Error('Unexpected');
          }
        },
      },
      sourceIncomplete: {
        resolve: () => ({ value: null, isPending: true }),
      },
      sourceMissing: {
        resolve: () => ({ value: null }),
      },
      sourceError: {
        resolve: ({ params }) => {
          switch (params && params[0]) {
            case 'non-error-exception':
              throw null;
            case 'serverless-error':
              throw new ServerlessError('Stop');
            case 'circular-ref': {
              const obj = {};
              obj.obj = obj;
              return { value: obj };
            }
            case 'non-json':
              return { value: new Set() };
            case 'non-json-circular': {
              const obj = new Set();
              obj.obj = obj;
              return { value: obj };
            }
            case 'no-value':
              return {};
            default:
              throw new Error('Stop');
          }
        },
      },

      sourceInfinite: {
        resolve: () => ({ value: { nest: '${sourceInfinite:}' } }),
      },
      sourceInfiniteString: {
        resolve: () => ({ value: '${sourceInfiniteString:}' }),
      },
      sourceShared: {
        resolve: () => ({
          value: {
            sharedFinal: 'foo',
            sharedInner: '${sourceProperty(sharedSourceResolution1, sharedFinal)}',
          },
        }),
      },
      sourceSharedProperty: {
        resolve: () => ({
          value: {
            sharedFinal: 'foo',
            sharedInner: '${sourceProperty(sharedPropertyResolution2)}',
          },
        }),
      },
      sourceSharedRaceCondition: {
        resolve: () => ({
          value: {
            sharedFinal: 'foo',
            sharedInner: '${sourceProperty(sharedPropertyRaceCondition2)}',
          },
        }),
      },
    };

    before(async () => {
      variablesMeta = resolveMeta(configuration);
      await resolve({
        serviceDir: process.cwd(),
        configuration,
        variablesMeta,
        sources,
        options: {},
        fulfilledSources: new Set(),
      });
    });

    it('should resolve non-string variable', () => {
      expect(configuration.direct).to.equal(234);
    });

    it('should resolve variable concatenated with string value', () => {
      expect(configuration.withString).to.equal('foo234');
    });

    it('should pass params to source resolvers', () => {
      expect(configuration.foo.params).to.equal('2marap|1marap');
    });

    it('should pass address to source resolvers', () => {
      expect(configuration.address).to.equal('footluser-sserdda');
    });

    it('should resolve variables in params', () => {
      expect(configuration.foo.varParam).to.equal('432');
    });

    it('should resolve variables in address', () => {
      expect(configuration.varAddress).to.equal('foo234');
    });

    it('should allow sources to get values of other properties', () => {
      expect(configuration.property).to.equal(234);
      expect(configuration.otherProperty).to.equal('foo234');
      expect(configuration.static).to.equal(true);
      expect(configuration.deepProperty).to.deep.equal({
        params: '2marap|1marap',
        varParam: '432',
      });
    });

    it('should clear escapes', () => {
      expect(configuration.escape).to.equal(
        'e${sourceDirect:}n\\$footluser-sserddaqe\\${sourceProperty(direct)}qn\\footluser-sserdda'
      );
    });

    it('should support incomplete sources', () => {
      expect(variablesMeta.get('incomplete')).to.have.property('variables');
    });

    it('should mark with error missing source without fallback', () => {
      const valueMeta = variablesMeta.get('missing');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('MISSING_VARIABLE_RESULT');
    });

    it('should support fallback on missing source', () => {
      expect(configuration.missingFallback).to.equal('234elofoo');
    });

    it('should report not existing property with null', () => {
      expect(configuration.notExistingProperty).to.equal('notExistingFallback');
    });

    it('should support `null` fallback on missing source', () => {
      expect(configuration.missingFallbackNull).to.equal(null);
    });

    it('should resolve variables in returned results', () => {
      expect(configuration.resolvesResultVariablesObject).to.deep.equal({ foo: 234 });
      expect(configuration.resolvesResultVariablesArray).to.deep.equal([1, 234]);
      expect(configuration.resolvesResultVariablesString).to.equal(234);
    });

    it('should preserve own unsafe keys when resolving direct configuration properties', () => {
      expect(Object.getPrototypeOf(configuration)).to.equal(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(configuration, '__proto__').value).to.equal(234);
    });

    it('should preserve own unsafe keys when resolving returned result objects', () => {
      expect(Object.getPrototypeOf(configuration.resolvesUnsafeOwnProtoObject)).to.equal(
        Object.prototype
      );
      expect(
        Object.getOwnPropertyDescriptor(configuration.resolvesUnsafeOwnProtoObject, '__proto__')
          .value
      ).to.equal(234);
    });

    it('should resolve own array properties while ignoring inherited dependency paths', () => {
      expect(configuration.arraySourceLength).to.equal(3);
      expect(configuration.inheritedConstructorName).to.equal(null);
    });

    it('should resolve Proxy-backed virtual properties across dependency paths', () => {
      expect(configuration.proxyVirtual).to.equal('proxy-virtual');
      expect(configuration.proxyOwn).to.equal('own-value');
      expect(configuration.proxyMissingFallback).to.equal('fallback');
    });

    it('should not traverse unsafe keys on Proxy-backed dependency paths', () => {
      expect(configuration.proxyConstructor).to.equal(null);
    });

    it('should mark with error a Proxy "get" trap that crashes during dependency resolution', () => {
      const valueMeta = variablesMeta.get('proxyTrapErrored');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
      expect(valueMeta.error.message).to.include('Property access errored with');
    });

    it('should resolve variables in resolved strings which are subject to concatenation', () => {
      expect(configuration.resolveDeepVariablesConcat).to.equal('234foo234');
      expect(configuration.resolveDeepVariablesConcatInParam).to.equal('432oof432');
      expect(configuration.resolveDeepVariablesConcatInAddress).to.equal('432oof432');
    });

    it('should provide working resolveVariablesInString util', () => {
      expect(configuration.resolveVariablesInString).to.deep.equal({
        params: '2marap|1marap',
        varParam: '432',
      });
    });

    // https://github.com/serverless/serverless/issues/9016
    it('should resolve same sources across resolution batches without shared caching', () => {
      expect(configuration.sharedSourceResolution1).to.deep.equal({
        sharedFinal: 'foo',
        sharedInner: 'foo',
      });
      expect(configuration.sharedSourceResolution2).to.equal('foo');
    });

    // https://github.com/serverless/serverless/issues/9047
    it('should resolve same properties across resolution batches without shared caching', () => {
      expect(configuration.sharedPropertyResolution1).to.deep.equal({
        sharedFinal: 'foo',
        sharedInner: 'foo',
      });
      expect(configuration.sharedSourceResolution2).to.equal('foo');
    });

    // https://github.com/serverless/serverless/issues/11286
    it('should handle gentle parallel resolution of same variable via different resolution patches', () => {
      expect(configuration.sharedPropertyRaceCondition1).to.deep.equal({
        sharedFinal: 'foo',
        sharedInner: 'foo',
      });
      expect(configuration.sharedPropertyRaceCondition2).to.equal('foo');
    });

    it('should not resolve variables for unrecognized sources', () => {
      expect(variablesMeta.get('nestUnrecognized\0unrecognized')).to.have.property('variables');
    });

    it('should error or non stringifiable value as part of a string', () => {
      const valueMeta = variablesMeta.get('nonStringStringPart');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('NON_STRING_VARIABLE_RESULT');
    });

    it('should mark errored resolution in param with error', () => {
      const valueMeta = variablesMeta.get('erroredParam');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should mark errored resolution in address with error', () => {
      const valueMeta = variablesMeta.get('nestErrored\0erroredAddress');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should mark ServerlessError errored resolution with error', () => {
      const valueMeta = variablesMeta.get('erroredSourceServerlessError');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should mark non ServerlessError errored resolution with error', () => {
      const valueMeta = variablesMeta.get('erroredSourceNonServerlessError');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should mark non error exception errored resolution with error', () => {
      const valueMeta = variablesMeta.get('erroredSourceNonErrorException');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should mark json result with circular references with error', () => {
      const valueMeta = variablesMeta.get('invalidResultCircular');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should mark non json result with error', () => {
      const valueMeta = variablesMeta.get('invalidResultNonJson');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should mark circular dependency among properties with error', () => {
      const valueMeta = variablesMeta.get('propertyCircularA');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should error on infinite variables resolution recursion', () => {
      const valueMeta = variablesMeta.get('infiniteDeepVariablesConcat');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('EXCESSIVE_RESOLVED_VARIABLES_NEST_DEPTH');
    });

    it('should mark deep circular dependency among properties with error', () => {
      const valueMeta = variablesMeta.get('propertyDeepCircularA');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should mark property root reference with error', () => {
      const valueMeta = variablesMeta.get('propertyRoot');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should not resolve dependency on unresolved property', () => {
      const valueMeta = variablesMeta.get('deepPropertyUnrecognized');
      expect(valueMeta).to.have.property('variables');
    });

    it('should not resolve dependencies of unrecognized source', () => {
      const valueMeta = variablesMeta.get('recognizedInUnrecognized');
      expect(valueMeta.variables[0].sources[0].params[0]).to.have.property('variables');
    });

    it('should mark dependency on errored property with error', () => {
      const valueMeta = variablesMeta.get('deepPropertyErrored');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should error on infinite resolution recursion', () => {
      const valueMeta = variablesMeta.get(`infiniteResolutionRecursion${'\0nest'.repeat(10)}`);
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('EXCESSIVE_RESOLVED_PROPERTIES_NEST_DEPTH');
    });

    it('should error on invalid variable notation in returned result', () => {
      const valueMeta = variablesMeta.get('resolvesResultVariablesStringInvalid');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('UNTERMINATED_VARIABLE');
      expect(valueMeta.error.message).to.include('(UNTERMINATED_VARIABLE)');
      expect(valueMeta.error.message).to.not.include('leaked-secret-marker');
      expect(valueMeta.error.message).to.not.include('${sourceDirect');
    });

    it('should error on invalid variable notation in returned concatenated result', () => {
      const valueMeta = variablesMeta.get('resolvesResultConcatInvalid');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('UNTERMINATED_VARIABLE');
      expect(valueMeta.error.message).to.include('(UNTERMINATED_VARIABLE)');
      expect(valueMeta.error.message).to.not.include('leaked-secret-marker');
      expect(valueMeta.error.message).to.not.include('${sourceDirect');
    });

    it('should error on invalid source resolution resolt', () => {
      const valueMeta = variablesMeta.get('invalidResultValue');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
    });

    it('should allow to re-resolve fulfilled sources', async () => {
      await resolve({
        serviceDir: process.cwd(),
        configuration,
        variablesMeta,
        sources: { ...sources, sourceIncomplete: { resolve: () => ({ value: 'complete' }) } },
        options: {},
        fulfilledSources: new Set(),
      });
      expect(configuration.incomplete).to.equal('234elocomplete');
    });

    it('should remove from variables meta data on resolved properties', () => {
      expect(Array.from(variablesMeta.keys())).to.deep.equal([
        'deepPropertyUnrecognized',
        'deepPropertyErrored',
        'propertyUnrecognized',
        'propertyErrored',
        'propertyCircularA',
        'propertyCircularB',
        'propertyDeepCircularA',
        'propertyDeepCircularB',
        'propertyDeepCircularC',
        'propertyRoot',
        'resolvesResultVariablesStringInvalid',
        'resolvesResultConcatInvalid',
        'infiniteDeepVariablesConcat',
        'resolvesVariablesInvalid1',
        'resolvesVariablesInvalid2',
        'missing',
        'nonStringStringPart',
        'nestUnrecognized\0unrecognized',
        'recognizedInUnrecognized',
        'erroredParam',
        'nestErrored\0erroredAddress',
        'erroredSourceServerlessError',
        'erroredSourceNonServerlessError',
        'erroredSourceNonErrorException',
        'invalidResultCircular',
        'invalidResultNonJson',
        'invalidResultNonJsonCircular',
        'invalidResultValue',
        'nullWithCustomErrorMessage',
        'proxyTrapErrored',
        `infiniteResolutionRecursion${'\0nest'.repeat(10)}`,
      ]);
    });

    describe('"resolveVariable" source util', () => {
      it('should resolve variable', () => {
        expect(configuration.resolvesVariables).to.equal('432');
      });
      it('should support multiple sources', () => {
        expect(configuration.resolvesVariablesFallback).to.equal(null);
      });

      it('should error on invalid input', () => {
        let valueMeta = variablesMeta.get('resolvesVariablesInvalid1');
        expect(valueMeta).to.not.have.property('variables');
        expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');

        valueMeta = variablesMeta.get('resolvesVariablesInvalid2');
        expect(valueMeta).to.not.have.property('variables');
        expect(valueMeta.error.code).to.equal('VARIABLE_RESOLUTION_ERROR');
      });
    });

    it('should recognize custom error message for null values', () => {
      const valueMeta = variablesMeta.get('nullWithCustomErrorMessage');
      expect(valueMeta).to.not.have.property('variables');
      expect(valueMeta.error.code).to.equal('MISSING_VARIABLE_RESULT');
      expect(valueMeta.error.message).to.include('Custom error message from source');
    });
  });

  it('should memoize identical source resolutions within one batch', async () => {
    const configuration = {
      first: '${counted(foo)}',
      second: '${counted(foo)}',
    };
    const variablesMeta = resolveMeta(configuration);
    let callCount = 0;

    await resolve({
      serviceDir: process.cwd(),
      configuration,
      variablesMeta,
      sources: {
        counted: {
          resolve: ({ params }) => {
            ++callCount;
            return { value: `value:${params[0]}` };
          },
        },
      },
      options: {},
      fulfilledSources: new Set(),
    });

    expect(configuration).to.deep.equal({
      first: 'value:foo',
      second: 'value:foo',
    });
    expect(callCount).to.equal(1);
  });

  describe('Partial resolution', () => {
    const configuration = {
      static: true,
      obj: {
        child: 'marko',
      },
      behindVar: '${sourceDirect:}',
      direct: '${sourceProperty(behindVar)}',
      childParent: '${sourceProperty(obj)}',
      parent: {
        parentChild: '${sourceProperty(behindVar)}',
      },
      unresolved: '${sourceProperty(static)}',
    };
    let variablesMeta;
    const sources = {
      sourceDirect: {
        resolve: () => ({ value: 234 }),
      },
      sourceProperty: {
        resolve: async ({ params, resolveConfigurationProperty }) => {
          const result = await resolveConfigurationProperty(params || []);
          return { value: result == null ? null : result };
        },
      },
    };
    before(async () => {
      variablesMeta = resolveMeta(configuration);
      await resolve({
        serviceDir: process.cwd(),
        configuration,
        variablesMeta,
        sources,
        options: {},
        fulfilledSources: new Set(),
        propertyPathsToResolve: new Set(['direct', 'childParent\0child', 'parent']),
      });
    });

    it('should resolve directly pointed property', () => {
      expect(configuration.direct).to.equal(234);
    });
    it('should resolve dependency of pointed property', () => {
      expect(configuration.behindVar).to.equal(234);
    });
    it('should resolve parent of pointed property', () => {
      expect(configuration.childParent.child).to.equal('marko');
    });
    it('should resolve child of pointed property', () => {
      expect(configuration.parent).to.deep.equal({ parentChild: 234 });
    });
    it('should note resolve not pointed properties', () => {
      const valueMeta = variablesMeta.get('unresolved');
      expect(valueMeta).to.have.property('variables');
    });
  });

  describe('Deferred resolution ("isPropertyDeferred")', () => {
    const configuration = {
      params: {
        dev: { greeting: '${sourceDirect:}' },
        prod: {
          referenced: '${sourceCounted:}',
          nested: { deep: '${sourceCounted:}' },
        },
        staging: '${sourceCounted:}',
      },
      referencesDeferred: '${sourceProperty(params, prod, referenced)}',
    };
    let variablesMeta;
    let callCount = 0;
    const sources = {
      sourceDirect: {
        resolve: () => ({ value: 'hello' }),
      },
      sourceCounted: {
        resolve: () => {
          ++callCount;
          return { value: `counted:${callCount}` };
        },
      },
      sourceProperty: {
        resolve: async ({ params, resolveConfigurationProperty }) => {
          const result = await resolveConfigurationProperty(params || []);
          return { value: result == null ? null : result };
        },
      },
    };
    before(async () => {
      variablesMeta = resolveMeta(configuration);
      await resolve({
        serviceDir: process.cwd(),
        configuration,
        variablesMeta,
        sources,
        options: {},
        fulfilledSources: new Set(['sourceDirect', 'sourceCounted', 'sourceProperty']),
        isPropertyDeferred: (propertyPath) => {
          if (!propertyPath.startsWith('params\0')) return false;
          const stageKey = propertyPath.split('\0')[1];
          return stageKey !== 'dev' && stageKey !== 'default';
        },
      });
    });

    it('should resolve not deferred properties', () => {
      expect(configuration.params.dev.greeting).to.equal('hello');
    });
    it('should not resolve deferred properties', () => {
      expect(configuration.params.prod.nested.deep).to.equal('${sourceCounted:}');
      expect(configuration.params.staging).to.equal('${sourceCounted:}');
      expect(variablesMeta.get('params\0prod\0nested\0deep')).to.have.property('variables');
      expect(variablesMeta.get('params\0staging')).to.have.property('variables');
    });
    it('should resolve deferred properties on which other properties depend', () => {
      expect(configuration.params.prod.referenced).to.equal('counted:1');
      expect(configuration.referencesDeferred).to.equal('counted:1');
      expect(variablesMeta.has('params\0prod\0referenced')).to.be.false;
    });
    it('should not invoke sources of deferred properties', () => {
      expect(callCount).to.equal(1);
    });
  });

  describe('Deferred resolution of dynamically discovered properties', () => {
    const configuration = {
      params: {
        dev: { greeting: '${sourceDirect:}' },
        prod: '${sourceObject:}',
      },
      referencesDeferred: '${sourceProperty(params, prod, referenced)}',
    };
    let variablesMeta;
    let callCount = 0;
    const sources = {
      sourceDirect: {
        resolve: () => ({ value: 'hello' }),
      },
      sourceCounted: {
        resolve: () => {
          ++callCount;
          return { value: `counted:${callCount}` };
        },
      },
      sourceObject: {
        resolve: () => ({
          value: { referenced: '${sourceCounted:}', notReferenced: '${sourceCounted:}' },
        }),
      },
      sourceProperty: {
        resolve: async ({ params, resolveConfigurationProperty }) => {
          const result = await resolveConfigurationProperty(params || []);
          return { value: result == null ? null : result };
        },
      },
    };
    before(async () => {
      variablesMeta = resolveMeta(configuration);
      await resolve({
        serviceDir: process.cwd(),
        configuration,
        variablesMeta,
        sources,
        options: {},
        fulfilledSources: new Set([
          'sourceDirect',
          'sourceCounted',
          'sourceObject',
          'sourceProperty',
        ]),
        isPropertyDeferred: (propertyPath) => {
          if (!propertyPath.startsWith('params\0')) return false;
          const propertyPathKeys = propertyPath.split('\0');
          if (propertyPathKeys.length < 3) return false;
          return propertyPathKeys[1] !== 'dev' && propertyPathKeys[1] !== 'default';
        },
      });
    });

    it('should resolve section variables', () => {
      expect(variablesMeta.has('params\0prod')).to.be.false;
      expect(configuration.params.dev.greeting).to.equal('hello');
    });
    it('should not resolve deferred properties discovered in resolved values', () => {
      expect(configuration.params.prod.notReferenced).to.equal('${sourceCounted:}');
      expect(variablesMeta.get('params\0prod\0notReferenced')).to.have.property('variables');
    });
    it('should resolve discovered properties on which other properties depend', () => {
      expect(configuration.params.prod.referenced).to.equal('counted:1');
      expect(configuration.referencesDeferred).to.equal('counted:1');
      expect(variablesMeta.has('params\0prod\0referenced')).to.be.false;
    });
    it('should not invoke sources of deferred discovered properties', () => {
      expect(callCount).to.equal(1);
    });
  });
});
