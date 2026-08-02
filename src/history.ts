import {
  classifyRunner,
  DEFAULT_PRICING_CATALOG,
  runnerRate,
  type PricingCatalog
} from './pricing.js';
import type {
  Confidence,
  MonthlyProjection,
  ProjectionDiagnostic,
  ProjectionDiagnosticCode,
  ProjectionMonthlyScenarios,
  ProjectionRunCostDistribution
} from './types.js';

const AVERAGE_DAYS_PER_MONTH = 30.4375;
const MICRO_USD_PER_USD = 1_000_000;
const MILLISECONDS_PER_MINUTE = 60_000;

export interface HistoricalJob {
  id: string;
  runnerLabels: readonly string[];
  startedAt: string | null;
  completedAt: string | null;
  conclusion: string | null;
}

export interface HistoricalRun {
  id: string;
  jobs: readonly HistoricalJob[];
  jobsTruncated: boolean;
}

export interface HistorySnapshot {
  windowDays: number;
  totalCompletedRuns: number;
  samplingStrategy: 'time-stratified-run-weighted';
  runs: readonly HistoricalRun[];
}

export interface StaticRateComparison {
  baseUsdPerWorkflowMinute: number | null;
  headUsdPerWorkflowMinute: number | null;
  triggerConfigurationChanged?: boolean;
  staticComparisonComplete?: boolean;
}

interface MicroUsdDistribution {
  mean: number | null;
  p50: number | null;
  p95: number | null;
}

/**
 * Builds a gross-equivalent monthly estimate from completed workflow runs.
 *
 * Gross-equivalent means elapsed hosted-runner time multiplied by the pricing
 * catalog's list rates. It intentionally does not try to reproduce an invoice.
 */
export function estimateMonthlyProjection(
  snapshot: HistorySnapshot,
  staticRates: StaticRateComparison,
  pricingCatalog: PricingCatalog = DEFAULT_PRICING_CATALOG
): MonthlyProjection {
  const diagnostics: ProjectionDiagnostic[] = [];
  const validRunCostsMicros: number[] = [];

  for (const run of snapshot.runs) {
    const costMicros = calculateRunCostMicros(run, pricingCatalog, diagnostics);
    if (costMicros !== null) {
      validRunCostsMicros.push(costMicros);
    }
  }

  const windowIsValid = Number.isFinite(snapshot.windowDays) && snapshot.windowDays > 0;
  const countIsValid = Number.isInteger(snapshot.totalCompletedRuns)
    && snapshot.totalCompletedRuns >= 0;
  const countIsConsistent = countIsValid
    && snapshot.totalCompletedRuns >= snapshot.runs.length;

  if (!windowIsValid || !countIsValid) {
    diagnostics.push(makeDiagnostic(
      'invalid-history-window',
      'windowDays must be positive and totalCompletedRuns must be a non-negative integer.'
    ));
  } else if (!countIsConsistent) {
    diagnostics.push(makeDiagnostic(
      'inconsistent-run-count',
      'totalCompletedRuns is smaller than the number of supplied run samples.'
    ));
  }

  if (validRunCostsMicros.length === 0) {
    diagnostics.push(makeDiagnostic(
      'no-valid-runs',
      'No complete run sample had fully priced runners and valid job timestamps.'
    ));
  }

  const historySampleComplete = snapshot.runs.length > 0
    && validRunCostsMicros.length === snapshot.runs.length;
  if (snapshot.runs.length > 0 && !historySampleComplete) {
    diagnostics.push(makeDiagnostic(
      'incomplete-history-sample',
      'At least one sampled run was excluded, so monthly ranges are withheld instead of extrapolating a potentially biased subset.'
    ));
  }

  const rawMonthlyRunFrequency = windowIsValid
    && countIsValid
    && countIsConsistent
    ? (snapshot.totalCompletedRuns / snapshot.windowDays) * AVERAGE_DAYS_PER_MONTH
    : null;
  const monthlyRunFrequency = rawMonthlyRunFrequency === null
    ? null
    : roundDecimal(rawMonthlyRunFrequency, 6);

  const observedMicros = runCostDistribution(validRunCostsMicros);
  const baseMonthlyMicros = rawMonthlyRunFrequency === null || !historySampleComplete
    ? emptyMicroRange()
    : scaleMicroRange(observedMicros, rawMonthlyRunFrequency);

  const rawStaticRateRatio = calculateStaticRateRatio(staticRates, diagnostics);
  if (staticRates.triggerConfigurationChanged === true) {
    diagnostics.push(makeDiagnostic(
      'trigger-configuration-changed',
      'The workflow trigger configuration changed, so historical frequency cannot project the proposed monthly scenario.'
    ));
  }
  if (staticRates.staticComparisonComplete === false) {
    diagnostics.push(makeDiagnostic(
      'approximate-static-comparison',
      'At least one static matrix estimate is approximate, so the proposed monthly scenario is withheld.'
    ));
  }
  const proposedMonthlyMicros = rawStaticRateRatio === null
    || staticRates.triggerConfigurationChanged === true
    || staticRates.staticComparisonComplete === false
    ? emptyMicroRange()
    : scaleMicroRange(baseMonthlyMicros, rawStaticRateRatio);
  const monthlyDeltaMicros = subtractMicroRanges(proposedMonthlyMicros, baseMonthlyMicros);

  const hasCompleteProjection = proposedMonthlyMicros.mean !== null
    && proposedMonthlyMicros.p50 !== null
    && proposedMonthlyMicros.p95 !== null;
  const confidence = projectionConfidence(
    hasCompleteProjection,
    validRunCostsMicros.length,
    snapshot.windowDays
  );

  if (hasCompleteProjection && confidence !== 'high') {
    if (confidence === 'low') {
      diagnostics.push(makeDiagnostic(
        'insufficient-history',
        'Projection confidence is low: require at least 5 valid runs and a 7-day window.'
      ));
    } else {
      diagnostics.push(makeDiagnostic(
        'model-confidence-cap',
        'Projection confidence is capped at medium during rollout because the static-rate ratio does not validate duration changes.'
      ));
    }
  }

  const aggregatedDiagnostics = aggregateDiagnostics(diagnostics);

  return {
    basis: 'gross-equivalent',
    currency: 'USD',
    confidence,
    history: {
      windowDays: snapshot.windowDays,
      totalCompletedRuns: snapshot.totalCompletedRuns,
      sampledRuns: snapshot.runs.length,
      validRuns: validRunCostsMicros.length,
      excludedRuns: snapshot.runs.length - validRunCostsMicros.length,
      samplingStrategy: snapshot.samplingStrategy
    },
    monthlyRunFrequency,
    staticRateRatio: rawStaticRateRatio === null
      ? null
      : roundDecimal(rawStaticRateRatio, 6),
    observedRunCost: serializeRunCostDistribution(observedMicros),
    baseMonthlyCost: serializeMonthlyScenarios(baseMonthlyMicros),
    proposedMonthlyCost: serializeMonthlyScenarios(proposedMonthlyMicros),
    monthlyDelta: serializeMonthlyScenarios(monthlyDeltaMicros),
    diagnostics: aggregatedDiagnostics,
    assumptions: [
      'Estimate basis: gross-equivalent at catalog list rates, not the payable GitHub invoice.',
      'Free quotas, included minutes, discounts, credits, taxes and invoice rounding are excluded.',
      'Each executed non-skipped job uses elapsed wall-clock time multiplied by its classified hosted-runner rate.',
      'Cancelled jobs without positive observed duration contribute zero before runner classification.',
      'Job costs are accumulated as integer micro-USD, rounded to the nearest micro-USD per job.',
      'Run-cost p50 and p95 use the nearest-rank percentile method.',
      'Expected monthly cost is observed mean cost per run multiplied by monthly run frequency.',
      'Monthly at-run-p50/p95 values are sensitivity scenarios, not percentiles of the aggregate monthly bill.',
      'Run samples are distributed across time buckets in proportion to each bucket\'s completed-run count.',
      'Monthly frequency is completed runs created in the window / windowDays * 30.4375.',
      'The proposed workflow keeps observed duration and frequency constant, scaled by the head/base static workflow-rate ratio.',
      'When trigger configuration changes, the proposed monthly scenario is withheld because historical frequency is not comparable.',
      'A run is excluded in full when its job list is truncated or a non-skipped job has an unpriced runner or invalid timestamps.',
      'Monthly ranges require every sampled run to be complete and fully priced; observed percentiles remain available for diagnostics when this is not true.',
      'Confidence is low below 5 valid runs or a 7-day window; otherwise it is medium.',
      'During initial rollout confidence is capped at medium because static-rate scaling does not prove that job duration remains stable.',
      'When a static matrix estimate is approximate, the proposed monthly scenario is withheld.',
      'Pricing catalog: ' + pricingCatalog.catalogVersion + '.'
    ]
  };
}

function calculateRunCostMicros(
  run: HistoricalRun,
  pricingCatalog: PricingCatalog,
  diagnostics: ProjectionDiagnostic[]
): number | null {
  if (run.jobsTruncated) {
    diagnostics.push(makeDiagnostic(
      'truncated-run',
      'A job list was truncated; the entire run sample was excluded.'
    ));
    return null;
  }

  if (run.jobs.length === 0) {
    diagnostics.push(makeDiagnostic(
      'empty-run',
      'A complete run contained no job records and contributes zero gross-equivalent cost.'
    ));
    return 0;
  }

  const billableJobs = run.jobs.filter((job) => job.conclusion !== 'skipped');
  if (billableJobs.length === 0) {
    diagnostics.push(makeDiagnostic(
      'all-jobs-skipped',
      'All jobs in a run were skipped; the complete sample contributes zero gross-equivalent cost.'
    ));
    return 0;
  }

  let runCostMicros = 0;
  let runIsValid = true;

  for (const job of billableJobs) {
    const startedAtMs = parseTimestamp(job.startedAt);
    const completedAtMs = parseTimestamp(job.completedAt);
    if (
      job.conclusion === 'cancelled'
      && (startedAtMs === null || completedAtMs === null || completedAtMs <= startedAtMs)
    ) {
      diagnostics.push(makeDiagnostic(
        'non-executed-cancelled-job',
        'A cancelled job with no positive observed duration contributes zero gross-equivalent cost.'
      ));
      continue;
    }

    const runner = classifyRunner(job.runnerLabels, pricingCatalog);
    if (runner.family === 'unknown') {
      diagnostics.push(makeDiagnostic(
        'unknown-runner',
        'Runner labels could not be classified; the entire run sample was excluded.'
      ));
      runIsValid = false;
      continue;
    }

    const rateUsdPerMinute = runnerRate(runner.family, pricingCatalog);
    if (rateUsdPerMinute === null) {
      diagnostics.push(makeDiagnostic(
        'unpriced-runner',
        'A classified runner has no catalog rate; the entire run sample was excluded.'
      ));
      runIsValid = false;
      continue;
    }

    if (startedAtMs === null || completedAtMs === null || completedAtMs <= startedAtMs) {
      diagnostics.push(makeDiagnostic(
        'invalid-timestamps',
        'Job timestamps must be valid and completedAt must be later than startedAt; the entire run sample was excluded.'
      ));
      runIsValid = false;
      continue;
    }

    const durationMs = completedAtMs - startedAtMs;
    const unroundedJobCostMicros = (
      durationMs
      * rateUsdPerMinute
      * MICRO_USD_PER_USD
    ) / MILLISECONDS_PER_MINUTE;

    if (
      !Number.isFinite(unroundedJobCostMicros)
      || unroundedJobCostMicros < 0
      || unroundedJobCostMicros > Number.MAX_SAFE_INTEGER
    ) {
      diagnostics.push(makeDiagnostic(
        'cost-overflow',
        'Job duration and catalog rate cannot be represented safely in integer micro-USD; the entire run sample was excluded.'
      ));
      runIsValid = false;
      continue;
    }

    const jobCostMicros = Math.round(unroundedJobCostMicros);
    if (!Number.isSafeInteger(jobCostMicros + runCostMicros)) {
      diagnostics.push(makeDiagnostic(
        'cost-overflow',
        'Run cost exceeds the safe integer range in micro-USD; the entire run sample was excluded.'
      ));
      runIsValid = false;
      continue;
    }

    runCostMicros += jobCostMicros;
  }

  return runIsValid ? runCostMicros : null;
}

function calculateStaticRateRatio(
  staticRates: StaticRateComparison,
  diagnostics: ProjectionDiagnostic[]
): number | null {
  const { baseUsdPerWorkflowMinute, headUsdPerWorkflowMinute } = staticRates;
  if (baseUsdPerWorkflowMinute === null || headUsdPerWorkflowMinute === null) {
    diagnostics.push(makeDiagnostic(
      'missing-static-rate',
      'Both base and head static workflow rates are required to project the proposed workflow.'
    ));
    return null;
  }

  if (
    !Number.isFinite(baseUsdPerWorkflowMinute)
    || !Number.isFinite(headUsdPerWorkflowMinute)
    || baseUsdPerWorkflowMinute <= 0
    || headUsdPerWorkflowMinute < 0
  ) {
    diagnostics.push(makeDiagnostic(
      'invalid-static-rate',
      'Base static rate must be positive and head static rate must be non-negative.'
    ));
    return null;
  }

  const ratio = headUsdPerWorkflowMinute / baseUsdPerWorkflowMinute;
  if (!Number.isFinite(ratio)) {
    diagnostics.push(makeDiagnostic(
      'invalid-static-rate',
      'The head/base static workflow-rate ratio is not finite.'
    ));
    return null;
  }
  return ratio;
}

function runCostDistribution(values: readonly number[]): MicroUsdDistribution {
  if (values.length === 0) {
    return emptyMicroRange();
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    mean: Math.round(values.reduce((sum, value) => sum + value / values.length, 0)),
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95)
  };
}

function nearestRank(sortedValues: readonly number[], percentile: number): number {
  const rank = Math.ceil(percentile * sortedValues.length);
  return sortedValues[Math.max(0, rank - 1)] ?? 0;
}

function scaleMicroRange(
  range: MicroUsdDistribution,
  factor: number
): MicroUsdDistribution {
  return {
    mean: scaleMicros(range.mean, factor),
    p50: scaleMicros(range.p50, factor),
    p95: scaleMicros(range.p95, factor)
  };
}

function scaleMicros(value: number | null, factor: number): number | null {
  if (value === null) {
    return null;
  }
  const scaled = Math.round(value * factor);
  return Number.isSafeInteger(scaled) ? scaled : null;
}

function subtractMicroRanges(
  proposed: MicroUsdDistribution,
  base: MicroUsdDistribution
): MicroUsdDistribution {
  return {
    mean: subtractMicros(proposed.mean, base.mean),
    p50: subtractMicros(proposed.p50, base.p50),
    p95: subtractMicros(proposed.p95, base.p95)
  };
}

function subtractMicros(left: number | null, right: number | null): number | null {
  if (left === null || right === null) {
    return null;
  }
  const delta = left - right;
  return Number.isSafeInteger(delta) ? delta : null;
}

function projectionConfidence(
  hasCompleteProjection: boolean,
  validRuns: number,
  windowDays: number
): Confidence {
  if (!hasCompleteProjection) {
    return 'low';
  }

  if (validRuns < 5 || windowDays < 7) {
    return 'low';
  }
  return 'medium';
}

function serializeRunCostDistribution(
  range: MicroUsdDistribution
): ProjectionRunCostDistribution {
  return {
    meanUsd: microsToUsd(range.mean),
    p50Usd: microsToUsd(range.p50),
    p95Usd: microsToUsd(range.p95)
  };
}

function serializeMonthlyScenarios(
  range: MicroUsdDistribution
): ProjectionMonthlyScenarios {
  return {
    expectedUsd: microsToUsd(range.mean),
    atRunP50Usd: microsToUsd(range.p50),
    atRunP95Usd: microsToUsd(range.p95)
  };
}

function microsToUsd(value: number | null): number | null {
  return value === null ? null : value / MICRO_USD_PER_USD;
}

function emptyMicroRange(): MicroUsdDistribution {
  return { mean: null, p50: null, p95: null };
}

function parseTimestamp(value: string | null): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function roundDecimal(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function makeDiagnostic(
  code: ProjectionDiagnosticCode,
  message: string
): ProjectionDiagnostic {
  return { code, message };
}

function aggregateDiagnostics(
  diagnostics: readonly ProjectionDiagnostic[]
): ProjectionDiagnostic[] {
  const grouped = new Map<
    ProjectionDiagnosticCode,
    { message: string; count: number }
  >();

  for (const diagnostic of diagnostics) {
    const existing = grouped.get(diagnostic.code);
    if (existing === undefined) {
      grouped.set(diagnostic.code, { message: diagnostic.message, count: 1 });
    } else {
      existing.count += 1;
    }
  }

  return [...grouped.entries()].map(([code, group]) => ({
    code,
    message: group.count === 1
      ? group.message
      : group.message + ' Occurrences: ' + group.count + '.'
  }));
}
