import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeWorkflow,
  compareWorkflowDocuments,
  formatAnalysisMarkdown,
  formatComparisonMarkdown,
  parseWorkflow,
  WorkflowParseError
} from '../src/index.js';

const fixtures = join(import.meta.dirname, 'fixtures');

describe('workflow analysis', () => {
  it('keeps a bounded Linux workflow free of findings', async () => {
    const text = await fixture('base.yml');
    const result = analyzeWorkflow(parseWorkflow(text, 'base.yml'), 'base.yml');

    expect(result.findings).toEqual([]);
    expect(result.summary.hostedRunnerRateUsdPerWorkflowMinute).toBe(0.012);
    expect(result.summary.unknownPriceJobs).toBe(0);
  });

  it('finds deterministic cost risks without claiming a monthly bill', async () => {
    const text = await fixture('head.yml');
    const result = analyzeWorkflow(parseWorkflow(text, 'head.yml'), 'head.yml');
    const rules = result.findings.map((finding) => finding.ruleId);

    expect(rules).toContain('expensive-runner');
    expect(rules).toContain('missing-timeout');
    expect(rules).toContain('large-matrix');
    expect(rules).toContain('duplicate-branch-triggers');
    expect(rules).toContain('missing-concurrency-cancellation');
    expect(rules).toContain('cache-opportunity');
    expect(result.summary.hostedRunnerRateUsdPerWorkflowMinute).toBe(0.382);
    expect(result.assumptions.join(' ')).toContain('not a monthly forecast');
  });

  it('returns an unknown rate for expression-based matrices and runners', async () => {
    const text = await fixture('dynamic.yml');
    const result = analyzeWorkflow(parseWorkflow(text, 'dynamic.yml'), 'dynamic.yml');

    expect(result.summary.hostedRunnerRateUsdPerWorkflowMinute).toBeNull();
    expect(result.summary.unknownPriceJobs).toBe(1);
    expect(result.jobs[0]?.matrix.copies).toBeNull();
  });

  it('reports introduced findings and a transparent cost-rate delta', async () => {
    const [base, head] = await Promise.all([
      fixture('base.yml'),
      fixture('head.yml')
    ]);
    const result = compareWorkflowDocuments(base, head, 'ci.yml');

    expect(result.costDelta.direction).toBe('increase');
    expect(result.triggerConfigurationChanged).toBe(true);
    expect(result.costDelta.deltaUsdPerWorkflowRuntimeMinute).toBe(0.37);
    expect(result.introducedFindings.length).toBeGreaterThan(5);
    expect(result.resolvedFindings).toEqual([]);

    const markdown = formatComparisonMarkdown(result);
    expect(markdown).toContain('not a monthly bill');
    expect(markdown).toContain('Introduced findings');
  });

  it('rejects malformed workflows with the source name', () => {
    expect(() => parseWorkflow('jobs: [', 'broken.yml'))
      .toThrowError(WorkflowParseError);
    expect(() => parseWorkflow('name: missing-jobs', 'missing.yml'))
      .toThrowError(/missing\.yml/);
  });

  it('does not treat trigger mapping key order as a frequency change', () => {
    const base = [
      'on:',
      '  push:',
      '  pull_request:',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    timeout-minutes: 10',
      '    steps:',
      '      - run: npm test'
    ].join('\n');
    const head = base.replace('  push:\n  pull_request:', '  pull_request:\n  push:');

    expect(compareWorkflowDocuments(base, head).triggerConfigurationChanged).toBe(false);
  });

  it('treats reusable workflows as unknown instead of inventing job costs', async () => {
    const text = await fixture('reusable.yml');
    const result = analyzeWorkflow(parseWorkflow(text, 'reusable.yml'), 'reusable.yml');

    expect(result.summary.hostedRunnerRateUsdPerWorkflowMinute).toBeNull();
    expect(result.findings.map((finding) => finding.ruleId))
      .toEqual(['reusable-workflow-unknown-cost']);
    expect(result.findings.some((finding) => finding.ruleId === 'missing-timeout')).toBe(false);
  });

  it('does not price a custom larger runner as standard Linux', async () => {
    const text = await fixture('custom-runner.yml');
    const result = analyzeWorkflow(parseWorkflow(text, 'custom-runner.yml'), 'custom-runner.yml');

    expect(result.jobs[0]?.runnerFamily).toBe('unknown');
    expect(result.summary.hostedRunnerRateUsdPerWorkflowMinute).toBeNull();
    expect(result.findings).toEqual([]);
  });

  it('recognizes composite self-hosted labels without assigning a public rate', async () => {
    const text = await fixture('self-hosted.yml');
    const result = analyzeWorkflow(parseWorkflow(text, 'self-hosted.yml'), 'self-hosted.yml');

    expect(result.jobs[0]?.runnerFamily).toBe('self-hosted');
    expect(result.summary.hostedRunnerRateUsdPerWorkflowMinute).toBeNull();
    expect(result.findings).toEqual([]);
  });

  it('does not flag duplicate triggers when push is branch-filtered', async () => {
    const text = await fixture('filtered-triggers.yml');
    const result = analyzeWorkflow(parseWorkflow(text, 'filtered-triggers.yml'), 'filtered-triggers.yml');

    expect(result.findings).toEqual([]);
    expect(result.summary.hostedRunnerRateUsdPerWorkflowMinute).toBe(0.006);
  });

  it('does not suggest setup caching when actions/cache is explicit', async () => {
    const text = await fixture('explicit-cache.yml');
    const result = analyzeWorkflow(parseWorkflow(text, 'explicit-cache.yml'), 'explicit-cache.yml');

    expect(result.findings.some((finding) => finding.ruleId === 'cache-opportunity')).toBe(false);
  });

  it('marks include/exclude matrix counts as low-confidence approximations', async () => {
    const text = await fixture('matrix-include-exclude.yml');
    const result = analyzeWorkflow(
      parseWorkflow(text, 'matrix-include-exclude.yml'),
      'matrix-include-exclude.yml'
    );
    const matrixFinding = result.findings.find((finding) => finding.ruleId === 'large-matrix');

    expect(result.jobs[0]?.matrix).toMatchObject({ copies: 6, confidence: 'low' });
    expect(matrixFinding?.confidence).toBe('low');
  });

  it('accepts expression-based timeout values as explicitly bounded', () => {
    const text = [
      'name: Expression timeout',
      'on: workflow_dispatch',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    timeout-minutes: ${{ inputs.timeout }}',
      '    steps:',
      '      - run: npm test'
    ].join('\n');
    const result = analyzeWorkflow(parseWorkflow(text, 'expression.yml'), 'expression.yml');

    expect(result.findings.some((finding) => finding.ruleId === 'missing-timeout')).toBe(false);
  });

  it('escapes workflow-controlled HTML, Markdown and mentions in output', () => {
    const text = [
      'name: "<img src=x>@maintainer ![x](https://example.invalid/pixel) `trusted`"',
      'on: workflow_dispatch',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    timeout-minutes: 10',
      '    steps:',
      '      - run: npm test'
    ].join('\n');
    const report = analyzeWorkflow(parseWorkflow(text, 'unsafe.yml'), 'unsafe.yml');
    const markdown = formatAnalysisMarkdown(report);

    expect(markdown).toContain('&lt;img src=x&gt;');
    expect(markdown).not.toContain('<img src=x>');
    expect(markdown).toContain('@\u200bmaintainer');
    expect(markdown).not.toContain('![x](https://example.invalid/pixel)');
    expect(markdown).toContain('\\!\\[x\\]\\(https:\u200b//example.invalid/pixel\\)');
    expect(markdown).toContain('\\`trusted\\`');
  });

  it('rejects duplicate YAML keys', () => {
    const text = 'jobs:\n  test:\n    runs-on: ubuntu-latest\n    runs-on: macos-latest';
    expect(() => parseWorkflow(text, 'duplicate.yml')).toThrowError(/duplicate/i);
  });
});

async function fixture(name: string): Promise<string> {
  return readFile(join(fixtures, name), 'utf8');
}
