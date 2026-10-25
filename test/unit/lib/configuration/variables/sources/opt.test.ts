import { expect } from 'chai';
import resolveMeta from '../../../../../../lib/configuration/variables/resolve-meta.ts';
import resolve from '../../../../../../lib/configuration/variables/resolve.ts';
import selfSource from '../../../../../../lib/configuration/variables/sources/self.ts';
import optSource from '../../../../../../lib/configuration/variables/sources/opt.ts';

describe('test/unit/lib/configuration/variables/sources/opt.test.ts', () => {
  let configuration;
  let variablesMeta;

  describe('fulfilled', () => {
    before(async () => {
      configuration = {
        opt: '${opt:foobar}',
        optBool: '${opt:bool}',
        optMissing: "${opt:missing, 'fallback'}",
        noAddress: '${opt:}',
        nonStringAddress: '${opt:${self:someObject}}',
        someObject: {},
      };
      variablesMeta = resolveMeta(configuration);
      await resolve({
        serviceDir: process.cwd(),
        configuration,
        variablesMeta,
        sources: { opt: optSource, self: selfSource },
        options: { foobar: 'elo', bool: false },
        fulfilledSources: new Set(['opt']),
      });
    });

    it('should resolve string option', () => expect(configuration.opt).to.equal('elo'));
    it('should resolve bool option', () => expect(configuration.optBool).to.equal(false));
    it('should resolve null on missing option', () =>
      expect(configuration.optMissing).to.equal('fallback'));

    it('should expose all options when no address is providerd', () =>
      expect(configuration.noAddress).to.deep.equal({ foobar: 'elo', bool: false }));

    it('should report with an error a non-string address argument', () =>
      expect(variablesMeta.get('nonStringAddress').error.code).to.equal(
        'VARIABLE_RESOLUTION_ERROR'
      ));
  });
  describe('pending', () => {
    before(async () => {
      configuration = {
        opt: '${opt:foobar}',
        optBool: '${opt:bool}',
        optMissing: "${opt:missing, 'fallback'}",
        noAddress: '${opt:}',
        someObject: {},
      };
      variablesMeta = resolveMeta(configuration);
      await resolve({
        serviceDir: process.cwd(),
        configuration,
        variablesMeta,
        sources: { opt: optSource, self: selfSource },
        options: { foobar: 'elo', bool: false },
        fulfilledSources: new Set([]),
      });
    });

    it('should resolve string option', () => expect(configuration.opt).to.equal('elo'));
    it('should resolve bool option', () => expect(configuration.optBool).to.equal(false));
    it('should not resolve missing option', () =>
      expect(variablesMeta.has('optMissing')).to.be.true);

    it('should not resolve when no address is provided', () =>
      expect(variablesMeta.has('noAddress')).to.be.true);
  });
});
