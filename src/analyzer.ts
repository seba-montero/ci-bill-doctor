import {
  classifyRunner,
  DEFAULT_PRICING_CATALOG,
  runnerRate,
  type PricingCatalog
} from './pricing.js';
import { isRecord } from './parser.js';
import type {
  AnalysisResult,
  Confidence,
  Finding,
  FindingCounts,
  JobCostSignal,
  MatrixEstimate,
  RunnerFamily,
  Severity,
  WorkflowDocument
} from './types.js';

const INSTALL_COMMANDS = /\b(npm ci|npm install|pnpm install|yarn install|pip install|poetry install|mvn (?:install|package)|gradle(?:w)? build)\b/i;

export interface AnalyzeOptions {
  pricingCatalog?: PricingCatalog;
}

export function analyzeWorkflow(
  workflow: WorkflowDocument,
  source = '<inline>',
  options: AnalyzeOptions = {}
): AnalysisResult {
  const pricingCatalog = options.pricingCatalog ?? DEFAULT_PRICING_CATALOG;
  const jobsRecord = isRecord(workflow.jobs) ? workflow.jobs : {};
  const findings: Finding[] = [];
  const jobs: JobCostSignal[] = [];

  for (const [jobId, rawJob] of Object.entries(jobsRecord)) {
    if (!isRecord(rawJob)) {
      findings.push(makeFinding({
        ruleId: 'invalid-job',
        discriminator: jobId,
        title: 'Job definition cannot be analyzed',
        severity: 'medium',
        confidence: 'high',
        message: 'The job is not a YAML mapping.',
        evidence: 'jobs.' + jobId,
        recommendation: 'Use a standard job mapping or a reusable workflow reference.',
        location: 'jobs.' + jobId
      }));
      continue;
    }

    if (typeof rawJob.uses === 'string') {
      const matrix = estimateMatrix(rawJob.strategy);
      jobs.push({
        jobId,
        runnerLabel: 'reusable workflow: ' + rawJob.uses,
        runnerFamily: 'unknown',
        matrix,
        hostedRateUsdPerMinute: null,
        fleetRateUsdPerRuntimeMinute: null
      });
      findings.push(makeFinding({
        ruleId: 'reusable-workflow-unknown-cost',
        discriminator: jobId,
        title: 'Reusable workflow cost is not visible in this file',
        severity: 'info',
        confidence: 'high',
        message: 'The called workflow owns its runners, steps and timeouts.',
        evidence: 'jobs.' + jobId + '.uses = ' + rawJob.uses,
        recommendation: 'Analyze the called workflow separately or provide a trusted cost snapshot.',
        location: 'jobs.' + jobId + '.uses'
      }));
      findings.push(...matrixFindings(jobId, matrix));
      continue;
    }

    const runner = classifyRunner(rawJob['runs-on'], pricingCatalog);
    const matrix = estimateMatrix(rawJob.strategy);
    const rate = runnerRate(runner.family, pricingCatalog);
    const fleetRate = rate !== null && matrix.copies !== null
      ? roundCurrency(rate * matrix.copies)
      : null;

    jobs.push({
      jobId,
      runnerLabel: runner.label,
      runnerFamily: runner.family,
      matrix,
      hostedRateUsdPerMinute: rate,
      fleetRateUsdPerRuntimeMinute: fleetRate
    });

    findings.push(...runnerFindings(jobId, runner.family, runner.label));
    findings.push(...timeoutFindings(jobId, rawJob));
    findings.push(...matrixFindings(jobId, matrix));
    findings.push(...cacheFindings(jobId, rawJob));
  }

  findings.push(...triggerFindings(workflow));
  findings.push(...concurrencyFindings(workflow));

  const sortedFindings = sortFindings(findings);
  const unknownPriceJobs = jobs.filter((job) => job.fleetRateUsdPerRuntimeMinute === null).length;
  const pricedJobs = jobs.length - unknownPriceJobs;
  const knownRate = jobs.reduce(
    (total, job) => total + (job.fleetRateUsdPerRuntimeMinute ?? 0),
    0
  );

  return {
    kind: 'analysis',
    source,
    workflowName: typeof workflow.name === 'string' ? workflow.name : source,
    findings: sortedFindings,
    jobs,
    summary: {
      jobs: jobs.length,
      findings: countFindings(sortedFindings),
      hostedRunnerRateUsdPerWorkflowMinute:
        jobs.length > 0 && unknownPriceJobs === 0 ? roundCurrency(knownRate) : null,
      pricedJobs,
      unknownPriceJobs
    },
    assumptions: [
      'Pricing catalog: ' + pricingCatalog.catalogVersion + '.',
      'Effective from ' + pricingCatalog.effectiveFrom
        + '; reviewed ' + pricingCatalog.reviewedAt + '.',
      'Pricing source: ' + pricingCatalog.sourceUrl + '.',
      'The cost signal covers standard GitHub-hosted runner rates only.',
      'It excludes free quotas, discounts, larger runners, duration, frequency, cache hit rate and retries.',
      'A workflow-minute assumes every expanded job runs for one minute; it is not a monthly forecast.'
    ]
  };
}

interface FindingInput extends Omit<Finding, 'id'> {
  discriminator: string;
}

function makeFinding(input: FindingInput): Finding {
  const { discriminator, ...finding } = input;
  return {
    id: input.ruleId + ':' + discriminator,
    ...finding
  };
}

function estimateMatrix(rawStrategy: unknown): MatrixEstimate {
  if (!isRecord(rawStrategy) || rawStrategy.matrix === undefined) {
    return {
      copies: 1,
      confidence: 'high',
      explanation: 'No matrix expansion.'
    };
  }

  if (!isRecord(rawStrategy.matrix)) {
    return {
      copies: null,
      confidence: 'low',
      explanation: 'The matrix is dynamic or expression-based.'
    };
  }

  const matrix = rawStrategy.matrix;
  const dimensions = Object.entries(matrix).filter(
    ([key]) => key !== 'include' && key !== 'exclude'
  );
  const include = Array.isArray(matrix.include) ? matrix.include : [];
  const exclude = Array.isArray(matrix.exclude) ? matrix.exclude : [];

  if (dimensions.length === 0 && include.length > 0) {
    return {
      copies: include.length,
      confidence: 'medium',
      explanation: 'Estimated from matrix.include entries.'
    };
  }

  let copies = 1;
  for (const [, value] of dimensions) {
    if (!Array.isArray(value)) {
      return {
        copies: null,
        confidence: 'low',
        explanation: 'At least one matrix dimension is dynamic.'
      };
    }
    copies *= value.length;
  }

  if (include.length > 0 || exclude.length > 0) {
    return {
      copies,
      confidence: 'low',
      explanation: 'Base Cartesian product; include/exclude can change the final count.'
    };
  }

  return {
    copies,
    confidence: 'high',
    explanation: 'Exact Cartesian product of static matrix dimensions.'
  };
}

function runnerFindings(
  jobId: string,
  family: RunnerFamily,
  label: string
): Finding[] {
  if (family === 'macos') {
    return [makeFinding({
      ruleId: 'expensive-runner',
      discriminator: jobId + ':macos',
      title: 'macOS runner has a high per-minute rate',
      severity: 'high',
      confidence: 'high',
      message: 'This job uses a standard macOS-hosted runner.',
      evidence: 'jobs.' + jobId + '.runs-on = ' + label,
      recommendation: 'Keep macOS only for steps that require Apple tooling; move portable checks to Linux.',
      location: 'jobs.' + jobId + '.runs-on'
    })];
  }

  if (family === 'windows') {
    return [makeFinding({
      ruleId: 'expensive-runner',
      discriminator: jobId + ':windows',
      title: 'Windows runner costs more than Linux',
      severity: 'medium',
      confidence: 'high',
      message: 'This job uses a standard Windows-hosted runner.',
      evidence: 'jobs.' + jobId + '.runs-on = ' + label,
      recommendation: 'Confirm the job needs Windows; move portable linting and tests to Linux.',
      location: 'jobs.' + jobId + '.runs-on'
    })];
  }

  return [];
}

function timeoutFindings(jobId: string, job: Record<string, unknown>): Finding[] {
  if (
    typeof job['timeout-minutes'] === 'number'
    || typeof job['timeout-minutes'] === 'string'
  ) {
    return [];
  }

  return [makeFinding({
    ruleId: 'missing-timeout',
    discriminator: jobId,
    title: 'Job has no explicit timeout',
    severity: 'medium',
    confidence: 'high',
    message: 'A hung process can consume runner time until GitHub applies its platform limit.',
    evidence: 'jobs.' + jobId + ' has no timeout-minutes',
    recommendation: 'Set timeout-minutes from measured p95 duration plus a small safety margin.',
    location: 'jobs.' + jobId
  })];
}

function matrixFindings(jobId: string, matrix: MatrixEstimate): Finding[] {
  if (matrix.copies === null || matrix.copies < 6) {
    return [];
  }

  const severity: Severity = matrix.copies >= 12 ? 'high' : 'medium';
  return [makeFinding({
    ruleId: 'large-matrix',
    discriminator: jobId,
    title: 'Matrix expands to many job copies',
    severity,
    confidence: matrix.confidence,
    message: 'The static matrix expands to approximately ' + matrix.copies + ' copies.',
    evidence: 'jobs.' + jobId + '.strategy.matrix; ' + matrix.explanation,
    recommendation: 'Remove unsupported combinations, split required checks from nightly coverage, or constrain the matrix.',
    location: 'jobs.' + jobId + '.strategy.matrix'
  })];
}

function cacheFindings(jobId: string, job: Record<string, unknown>): Finding[] {
  if (!Array.isArray(job.steps)) {
    return [];
  }

  const steps = job.steps.filter(isRecord);
  const hasExplicitCache = steps.some((step) => {
    const uses = typeof step.uses === 'string' ? step.uses.toLowerCase() : '';
    return uses.startsWith('actions/cache@');
  });

  if (hasExplicitCache) {
    return [];
  }

  const installCommands = steps
    .map((step) => typeof step.run === 'string' ? step.run : '')
    .filter((command) => INSTALL_COMMANDS.test(command));

  if (installCommands.length === 0) {
    return [];
  }

  const setupWithoutCache = steps.find((step) => {
    const uses = typeof step.uses === 'string' ? step.uses.toLowerCase() : '';
    if (
      !uses.startsWith('actions/setup-node@')
      && !uses.startsWith('actions/setup-python@')
      && !uses.startsWith('actions/setup-java@')
    ) {
      return false;
    }

    return !isRecord(step.with) || step.with.cache === undefined;
  });

  if (!setupWithoutCache) {
    return [];
  }

  const firstInstallCommand = installCommands[0] ?? '';
  return [makeFinding({
    ruleId: 'cache-opportunity',
    discriminator: jobId,
    title: 'Dependency installation may be uncached',
    severity: 'low',
    confidence: 'medium',
    message: 'The workflow installs dependencies after a setup action without visible cache configuration.',
    evidence: 'jobs.' + jobId + ' contains: ' + (firstInstallCommand.split('\n')[0] ?? firstInstallCommand),
    recommendation: 'Measure install time, then enable the setup action cache if the lockfile is stable.',
    location: 'jobs.' + jobId + '.steps'
  })];
}

function triggerFindings(workflow: WorkflowDocument): Finding[] {
  const triggers = normalizeTriggers(workflow.on);
  if (!triggers.has('push') || !triggers.has('pull_request')) {
    return [];
  }

  const pushConfig = triggers.get('push');
  const pullRequestConfig = triggers.get('pull_request');
  if (
    hasPathFilter(pushConfig)
    || hasPathFilter(pullRequestConfig)
    || hasBranchFilter(pushConfig)
  ) {
    return [];
  }

  return [makeFinding({
    ruleId: 'duplicate-branch-triggers',
    discriminator: 'workflow',
    title: 'Push and pull_request may run the same commit twice',
    severity: 'medium',
    confidence: 'medium',
    message: 'Both triggers are enabled without path filters; branches with open pull requests can produce duplicate work.',
    evidence: 'on includes push and pull_request',
    recommendation: 'Restrict push to protected branches, or separate required PR checks from post-merge work.',
    location: 'on'
  })];
}

function concurrencyFindings(workflow: WorkflowDocument): Finding[] {
  const triggers = normalizeTriggers(workflow.on);
  const isCommitDriven = triggers.has('push') || triggers.has('pull_request');
  if (!isCommitDriven) {
    return [];
  }

  if (workflow.concurrency === undefined || workflow.concurrency === null) {
    return [makeFinding({
      ruleId: 'missing-concurrency-cancellation',
      discriminator: 'workflow',
      title: 'Superseded runs are not cancelled',
      severity: 'medium',
      confidence: 'high',
      message: 'No workflow-level concurrency group is configured.',
      evidence: 'concurrency is absent',
      recommendation: 'Group runs by workflow and ref, and enable cancel-in-progress for branch updates.',
      location: 'concurrency'
    })];
  }

  if (typeof workflow.concurrency === 'string') {
    return [makeFinding({
      ruleId: 'missing-concurrency-cancellation',
      discriminator: 'workflow',
      title: 'Concurrency is grouped but old runs are not cancelled',
      severity: 'low',
      confidence: 'high',
      message: 'String concurrency syntax does not enable cancel-in-progress.',
      evidence: 'concurrency = ' + workflow.concurrency,
      recommendation: 'Use the mapping form and set cancel-in-progress to true when safe.',
      location: 'concurrency'
    })];
  }

  if (
    isRecord(workflow.concurrency)
    && workflow.concurrency['cancel-in-progress'] !== true
    && typeof workflow.concurrency['cancel-in-progress'] !== 'string'
  ) {
    return [makeFinding({
      ruleId: 'missing-concurrency-cancellation',
      discriminator: 'workflow',
      title: 'Concurrency does not cancel superseded runs',
      severity: 'low',
      confidence: 'high',
      message: 'A concurrency group exists, but cancel-in-progress is not enabled.',
      evidence: 'concurrency.cancel-in-progress is not true',
      recommendation: 'Enable cancellation for branch and pull-request workflows when jobs are safe to interrupt.',
      location: 'concurrency.cancel-in-progress'
    })];
  }

  return [];
}

function normalizeTriggers(raw: unknown): Map<string, unknown> {
  if (typeof raw === 'string') {
    return new Map([[raw, null]]);
  }
  if (Array.isArray(raw)) {
    return new Map(
      raw
        .filter((value): value is string => typeof value === 'string')
        .map((value) => [value, null] as const)
    );
  }
  if (isRecord(raw)) {
    return new Map(Object.entries(raw));
  }
  return new Map();
}

function hasPathFilter(config: unknown): boolean {
  return isRecord(config)
    && (Array.isArray(config.paths) || Array.isArray(config['paths-ignore']));
}

function hasBranchFilter(config: unknown): boolean {
  return isRecord(config)
    && (Array.isArray(config.branches) || Array.isArray(config['branches-ignore']));
}

function countFindings(findings: Finding[]): FindingCounts {
  const counts: FindingCounts = { info: 0, low: 0, medium: 0, high: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

function sortFindings(findings: Finding[]): Finding[] {
  const weights: Record<Severity, number> = {
    high: 4,
    medium: 3,
    low: 2,
    info: 1
  };

  return [...findings].sort((left, right) => {
    const bySeverity = weights[right.severity] - weights[left.severity];
    return bySeverity !== 0 ? bySeverity : left.id.localeCompare(right.id);
  });
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
