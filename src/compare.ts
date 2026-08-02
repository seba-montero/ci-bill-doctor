import { analyzeWorkflow, type AnalyzeOptions } from './analyzer.js';
import { parseWorkflow } from './parser.js';
import type {
  AnalysisResult,
  ComparisonResult,
  CostDelta,
  Finding
} from './types.js';

export function compareWorkflowDocuments(
  baseText: string,
  headText: string,
  source = '<inline>',
  options: AnalyzeOptions = {}
): ComparisonResult {
  const baseDocument = parseWorkflow(baseText, source + ' (base)');
  const headDocument = parseWorkflow(headText, source + ' (head)');
  const base = analyzeWorkflow(
    baseDocument,
    source + ' (base)',
    options
  );
  const head = analyzeWorkflow(
    headDocument,
    source + ' (head)',
    options
  );

  return {
    ...compareAnalyses(base, head, source),
    triggerConfigurationChanged: !structurallyEqual(baseDocument.on, headDocument.on)
  };
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function canonicalize(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') {
    return { bigint: value.toString() };
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return '<circular-reference>';
    }
    ancestors.add(value);
    const canonical = value.map((entry) => canonicalize(entry, ancestors));
    ancestors.delete(value);
    return canonical;
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (ancestors.has(value)) {
    return '<circular-reference>';
  }
  ancestors.add(value);

  const canonical = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry, ancestors)])
  );
  ancestors.delete(value);
  return canonical;
}

export function compareAnalyses(
  base: AnalysisResult,
  head: AnalysisResult,
  source = head.source
): ComparisonResult {
  const baseById = new Map(base.findings.map((finding) => [finding.id, finding]));
  const headById = new Map(head.findings.map((finding) => [finding.id, finding]));

  const introducedFindings = head.findings.filter((finding) => !baseById.has(finding.id));
  const resolvedFindings = base.findings.filter((finding) => !headById.has(finding.id));

  return {
    kind: 'comparison',
    source,
    base,
    head,
    introducedFindings,
    resolvedFindings,
    costDelta: calculateCostDelta(base, head),
    assumptions: [
      ...head.assumptions,
      'The delta compares runner rate and static fan-out, not observed execution duration or run frequency.'
    ]
  };
}

export function findingsForAddedWorkflow(result: AnalysisResult): Finding[] {
  return result.findings;
}

function calculateCostDelta(base: AnalysisResult, head: AnalysisResult): CostDelta {
  const baseRate = base.summary.hostedRunnerRateUsdPerWorkflowMinute;
  const headRate = head.summary.hostedRunnerRateUsdPerWorkflowMinute;

  if (baseRate === null || headRate === null) {
    return {
      direction: 'unknown',
      baseHostedRunnerRateUsdPerWorkflowMinute: baseRate,
      headHostedRunnerRateUsdPerWorkflowMinute: headRate,
      deltaUsdPerWorkflowRuntimeMinute: null,
      percentageChange: null
    };
  }

  const delta = roundCurrency(headRate - baseRate);
  const direction = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'unchanged';
  const percentageChange = baseRate > 0
    ? Math.round((delta / baseRate) * 10_000) / 100
    : null;

  return {
    direction,
    baseHostedRunnerRateUsdPerWorkflowMinute: baseRate,
    headHostedRunnerRateUsdPerWorkflowMinute: headRate,
    deltaUsdPerWorkflowRuntimeMinute: delta,
    percentageChange
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
