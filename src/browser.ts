import { analyzeWorkflow } from './analyzer.js';
import { parseWorkflow } from './parser.js';

export { analyzeWorkflow, type AnalyzeOptions } from './analyzer.js';
export { compareAnalyses, compareWorkflowDocuments } from './compare.js';
export { parseWorkflow, WorkflowParseError } from './parser.js';
export {
  classifyRunner,
  DEFAULT_PRICING_CATALOG,
  HOSTED_RUNNER_USD_PER_MINUTE,
  PRICING_SNAPSHOT_DATE,
  runnerRate
} from './pricing.js';
export type {
  AnalysisResult,
  ComparisonResult,
  Confidence,
  CostDelta,
  Finding,
  FindingCounts,
  JobCostSignal,
  MatrixEstimate,
  RunnerFamily,
  Severity,
  WorkflowDocument
} from './types.js';

export function analyzeWorkflowText(sourceText: string, source = '<browser>') {
  return analyzeWorkflow(parseWorkflow(sourceText, source), source);
}
