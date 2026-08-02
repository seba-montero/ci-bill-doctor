export { analyzeWorkflow, type AnalyzeOptions } from './analyzer.js';
export { compareAnalyses, compareWorkflowDocuments } from './compare.js';
export {
  formatAnalysisMarkdown,
  formatComparisonMarkdown,
  formatFindingSummary
} from './format.js';
export {
  collectWorkflowHistory,
  type ActionsHistoryApi,
  type CollectWorkflowHistoryOptions
} from './github-history.js';
export {
  estimateMonthlyProjection,
  type HistoricalJob,
  type HistoricalRun,
  type HistorySnapshot,
  type StaticRateComparison
} from './history.js';
export { parseWorkflow, WorkflowParseError } from './parser.js';
export {
  classifyRunner,
  DEFAULT_PRICING_CATALOG,
  HOSTED_RUNNER_USD_PER_MINUTE,
  PRICING_SNAPSHOT_DATE,
  runnerRate,
  validatePricingCatalog
} from './pricing.js';
export type { PricingCatalog, RunnerFamilyPricing } from './pricing.js';
export type {
  AnalysisResult,
  ComparisonResult,
  Confidence,
  CostDelta,
  Finding,
  HistoryCollectionStatus,
  JobCostSignal,
  MatrixEstimate,
  MonthlyProjection,
  ProjectionDiagnostic,
  ProjectionDiagnosticCode,
  ProjectionMonthlyScenarios,
  ProjectionRunCostDistribution,
  RunnerFamily,
  Severity,
  WorkflowDocument
} from './types.js';
