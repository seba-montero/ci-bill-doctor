export type Severity = 'info' | 'low' | 'medium' | 'high';
export type Confidence = 'low' | 'medium' | 'high';
export type RunnerFamily = 'linux' | 'windows' | 'macos' | 'self-hosted' | 'unknown';

export interface MatrixEstimate {
  copies: number | null;
  confidence: Confidence;
  explanation: string;
}

export interface JobCostSignal {
  jobId: string;
  runnerLabel: string;
  runnerFamily: RunnerFamily;
  matrix: MatrixEstimate;
  hostedRateUsdPerMinute: number | null;
  fleetRateUsdPerRuntimeMinute: number | null;
}

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  message: string;
  evidence: string;
  recommendation: string;
  location?: string;
}

export interface FindingCounts {
  info: number;
  low: number;
  medium: number;
  high: number;
}

export interface AnalysisSummary {
  jobs: number;
  findings: FindingCounts;
  hostedRunnerRateUsdPerWorkflowMinute: number | null;
  pricedJobs: number;
  unknownPriceJobs: number;
}

export interface AnalysisResult {
  kind: 'analysis';
  source: string;
  workflowName: string;
  findings: Finding[];
  jobs: JobCostSignal[];
  summary: AnalysisSummary;
  assumptions: string[];
}

export type CostDirection = 'increase' | 'decrease' | 'unchanged' | 'unknown';

export interface CostDelta {
  direction: CostDirection;
  baseHostedRunnerRateUsdPerWorkflowMinute: number | null;
  headHostedRunnerRateUsdPerWorkflowMinute: number | null;
  deltaUsdPerWorkflowRuntimeMinute: number | null;
  percentageChange: number | null;
}

export interface ProjectionRunCostDistribution {
  meanUsd: number | null;
  p50Usd: number | null;
  p95Usd: number | null;
}

export interface ProjectionMonthlyScenarios {
  expectedUsd: number | null;
  atRunP50Usd: number | null;
  atRunP95Usd: number | null;
}

export type ProjectionDiagnosticCode =
  | 'invalid-history-window'
  | 'inconsistent-run-count'
  | 'truncated-run'
  | 'empty-run'
  | 'all-jobs-skipped'
  | 'non-executed-cancelled-job'
  | 'unknown-runner'
  | 'unpriced-runner'
  | 'invalid-timestamps'
  | 'cost-overflow'
  | 'no-valid-runs'
  | 'incomplete-history-sample'
  | 'missing-static-rate'
  | 'invalid-static-rate'
  | 'trigger-configuration-changed'
  | 'approximate-static-comparison'
  | 'insufficient-history'
  | 'model-confidence-cap';

export interface ProjectionDiagnostic {
  code: ProjectionDiagnosticCode;
  message: string;
}

export interface MonthlyProjection {
  basis: 'gross-equivalent';
  currency: 'USD';
  confidence: Confidence;
  history: {
    windowDays: number;
    totalCompletedRuns: number;
    sampledRuns: number;
    validRuns: number;
    excludedRuns: number;
    samplingStrategy: 'time-stratified-run-weighted';
  };
  monthlyRunFrequency: number | null;
  staticRateRatio: number | null;
  observedRunCost: ProjectionRunCostDistribution;
  baseMonthlyCost: ProjectionMonthlyScenarios;
  proposedMonthlyCost: ProjectionMonthlyScenarios;
  monthlyDelta: ProjectionMonthlyScenarios;
  diagnostics: ProjectionDiagnostic[];
  assumptions: string[];
}

export interface HistoryCollectionStatus {
  status: 'unavailable';
  reason: string;
}

export interface ComparisonResult {
  kind: 'comparison';
  source: string;
  base: AnalysisResult;
  head: AnalysisResult;
  introducedFindings: Finding[];
  resolvedFindings: Finding[];
  costDelta: CostDelta;
  triggerConfigurationChanged?: boolean;
  historyCollection?: HistoryCollectionStatus;
  monthlyProjection?: MonthlyProjection;
  assumptions: string[];
}

export interface WorkflowDocument {
  name?: unknown;
  on?: unknown;
  concurrency?: unknown;
  jobs?: unknown;
  [key: string]: unknown;
}
