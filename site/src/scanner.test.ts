import { describe, expect, it } from 'vitest';
import { BASE_EXAMPLE, HEAD_EXAMPLE } from './examples.js';
import {
  MAX_WORKFLOW_BYTES,
  ScannerInputError,
  analyzeText,
  compareTexts,
  sourceSizeBytes
} from './scanner.js';

describe('browser scanner boundary', () => {
  it('analyzes a workflow with the public core', () => {
    const result = analyzeText(BASE_EXAMPLE);

    expect(result.kind).toBe('analysis');
    expect(result.summary.jobs).toBe(1);
    expect(result.summary.hostedRunnerRateUsdPerWorkflowMinute).toBe(0.012);
  });

  it('compares the validated matrix and runner example', () => {
    const result = compareTexts(BASE_EXAMPLE, HEAD_EXAMPLE);

    expect(result.kind).toBe('comparison');
    expect(result.costDelta.direction).toBe('increase');
    expect(result.costDelta.baseHostedRunnerRateUsdPerWorkflowMinute).toBe(0.012);
    expect(result.costDelta.headHostedRunnerRateUsdPerWorkflowMinute).toBe(0.372);
    expect(result.costDelta.deltaUsdPerWorkflowRuntimeMinute).toBe(0.36);
    expect(result.introducedFindings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(['expensive-runner', 'large-matrix'])
    );
  });

  it('rejects empty input before parsing', () => {
    expect(() => analyzeText('  \n')).toThrow(ScannerInputError);
    expect(() => analyzeText('  \n')).toThrow('Workflow is empty');
  });

  it('measures UTF-8 bytes and enforces the browser limit', () => {
    expect(sourceSizeBytes('é')).toBe(2);
    const oversized = 'a'.repeat(MAX_WORKFLOW_BYTES + 1);
    expect(() => analyzeText(oversized)).toThrow('browser scanner limit is 250 KB');
  });

  it('preserves safe parse failures from the core', () => {
    expect(() => analyzeText('jobs: [not, a, mapping]')).toThrow(
      'workflow must contain a jobs mapping'
    );
  });
});
