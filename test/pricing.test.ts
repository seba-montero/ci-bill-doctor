import { describe, expect, it } from 'vitest';
import {
  analyzeWorkflow,
  classifyRunner,
  DEFAULT_PRICING_CATALOG,
  HOSTED_RUNNER_USD_PER_MINUTE,
  parseWorkflow,
  runnerRate,
  validatePricingCatalog,
  type PricingCatalog
} from '../src/index.js';

describe('pricing snapshot', () => {
  it('keeps runner prices explicit and versionable', () => {
    expect(HOSTED_RUNNER_USD_PER_MINUTE).toEqual({
      linux: 0.006,
      windows: 0.01,
      macos: 0.062
    });
    expect(runnerRate('self-hosted')).toBeNull();
    expect(runnerRate('unknown')).toBeNull();
    expect(DEFAULT_PRICING_CATALOG.catalogVersion).toBe('github-hosted-standard-2026-08-01');
    expect(DEFAULT_PRICING_CATALOG.sourceUrl).toMatch(/^https:\/\/docs\.github\.com\//);
  });

  it('classifies only supported standard labels', () => {
    expect(classifyRunner('ubuntu-24.04').family).toBe('linux');
    expect(classifyRunner('windows-2025').family).toBe('windows');
    expect(classifyRunner('macos-15').family).toBe('macos');
    expect(classifyRunner(['self-hosted', 'linux', 'x64']).family).toBe('self-hosted');
    expect(classifyRunner('ubuntu-latest-8-cores').family).toBe('unknown');
  });

  it('rejects malformed or unofficial catalogs', () => {
    expect(() => validatePricingCatalog({ schemaVersion: 2 })).toThrow(/schemaVersion/);
    expect(() => validatePricingCatalog({
      ...structuredClone(DEFAULT_PRICING_CATALOG),
      sourceUrl: 'https://example.com/pricing'
    })).toThrow(/official GitHub/);
  });

  it('allows an explicit validated catalog override', () => {
    const mutable = structuredClone(DEFAULT_PRICING_CATALOG) as PricingCatalog;
    mutable.catalogVersion = 'test-catalog';
    mutable.runnerFamilies.linux.pricePerMinute = 0.5;
    const catalog = validatePricingCatalog(mutable);
    const workflow = parseWorkflow([
      'name: Custom price',
      'on: workflow_dispatch',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    timeout-minutes: 10',
      '    strategy:',
      '      matrix:',
      '        node: [20, 22]',
      '    steps:',
      '      - run: npm test'
    ].join('\n'));
    const result = analyzeWorkflow(workflow, 'custom.yml', { pricingCatalog: catalog });

    expect(result.summary.hostedRunnerRateUsdPerWorkflowMinute).toBe(1);
    expect(result.assumptions.join(' ')).toContain('test-catalog');
  });
});
