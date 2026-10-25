import path from 'node:path';
import setupRunServerlessFixturesEngine from '../lib/setup-run-serverless-fixtures-engine.ts';

export default setupRunServerlessFixturesEngine({
  fixturesDir: path.resolve(import.meta.dirname, '../fixtures/programmatic'),
  serverlessDir: path.resolve(import.meta.dirname, '../../'),
});
