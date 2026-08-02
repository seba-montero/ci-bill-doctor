import { describe, expect, it } from 'vitest';
import {
  estimateMonthlyProjection,
  type HistoricalJob,
  type HistoricalRun,
  type HistorySnapshot
} from '../src/history.js';
import { compareWorkflowDocuments } from '../src/compare.js';
import { formatComparisonMarkdown } from '../src/format.js';
import {
  DEFAULT_PRICING_CATALOG,
  validatePricingCatalog,
  type PricingCatalog
} from '../src/pricing.js';

describe('history projection', () => {
  it('sums catalog-priced job duration and uses nearest-rank p50/p95', () => {
    const snapshot = history([
      run('run-1', [job('job-1', ['ubuntu-latest'], 1)]),
      run('run-2', [job('job-2', ['ubuntu-latest'], 2)]),
      run('run-3', [job('job-3', ['windows-latest'], 3)]),
      run('run-4', [job('job-4', ['macos-latest'], 1)])
    ], 4, 30.4375);

    const projection = estimateMonthlyProjection(snapshot, {
      baseUsdPerWorkflowMinute: 0.006,
      headUsdPerWorkflowMinute: 0.012
    });

    expect(projection.basis).toBe('gross-equivalent');
    expect(projection.monthlyRunFrequency).toBe(4);
    expect(projection.staticRateRatio).toBe(2);
    expect(projection.observedRunCost).toEqual({
      meanUsd: 0.0275,
      p50Usd: 0.012,
      p95Usd: 0.062
    });
    expect(projection.baseMonthlyCost).toEqual({
      expectedUsd: 0.11,
      atRunP50Usd: 0.048,
      atRunP95Usd: 0.248
    });
    expect(projection.proposedMonthlyCost).toEqual({
      expectedUsd: 0.22,
      atRunP50Usd: 0.096,
      atRunP95Usd: 0.496
    });
    expect(projection.monthlyDelta).toEqual({
      expectedUsd: 0.11,
      atRunP50Usd: 0.048,
      atRunP95Usd: 0.248
    });
    expect(projection.confidence).toBe('low');
    expect(projection.assumptions.join(' ')).toContain('nearest-rank');
    expect(projection.assumptions.join(' ')).toContain('gross-equivalent');
  });

  it('omits skipped jobs but excludes an entire run for incomplete or unpriced data', () => {
    const validWithSkipped = run('valid', [
      job('paid', ['ubuntu-latest'], 1),
      {
        id: 'skipped',
        runnerLabels: [],
        startedAt: null,
        completedAt: null,
        conclusion: 'skipped'
      }
    ]);
    const unknownRunner = run('unknown', [
      job('unknown-job', ['ubuntu-latest-8-cores'], 1)
    ]);
    const selfHosted = run('self-hosted', [
      job('self-hosted-job', ['self-hosted', 'linux', 'x64'], 1)
    ]);
    const truncated = run('truncated', [
      job('hidden-tail', ['ubuntu-latest'], 1)
    ], true);
    const invalidTimestamps = run('bad-time', [{
      id: 'bad-time-job',
      runnerLabels: ['ubuntu-latest'],
      startedAt: '2026-07-01T01:00:00.000Z',
      completedAt: '2026-07-01T01:00:00.000Z',
      conclusion: 'success'
    }]);
    const allSkipped = run('all-skipped', [{
      id: 'skipped-only',
      runnerLabels: [],
      startedAt: null,
      completedAt: null,
      conclusion: 'skipped'
    }]);

    const projection = estimateMonthlyProjection(
      history([
        validWithSkipped,
        unknownRunner,
        selfHosted,
        truncated,
        invalidTimestamps,
        allSkipped
      ], 6, 30.4375),
      {
        baseUsdPerWorkflowMinute: 0.006,
        headUsdPerWorkflowMinute: 0.006
      }
    );

    expect(projection.history).toMatchObject({
      sampledRuns: 6,
      validRuns: 2,
      excludedRuns: 4
    });
    expect(projection.observedRunCost).toEqual({
      meanUsd: 0.003,
      p50Usd: 0,
      p95Usd: 0.006
    });
    expect(projection.baseMonthlyCost).toEqual({
      expectedUsd: null,
      atRunP50Usd: null,
      atRunP95Usd: null
    });
    expect(projection.proposedMonthlyCost).toEqual({
      expectedUsd: null,
      atRunP50Usd: null,
      atRunP95Usd: null
    });
    expect(projection.monthlyDelta).toEqual({
      expectedUsd: null,
      atRunP50Usd: null,
      atRunP95Usd: null
    });
    expect(projection.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'all-jobs-skipped',
      'unknown-runner',
      'unpriced-runner',
      'truncated-run',
      'invalid-timestamps',
      'incomplete-history-sample'
    ]));
    expect(projection.diagnostics.find(({ code }) => code === 'unknown-runner')).toEqual({
      code: 'unknown-runner',
      message: expect.not.stringContaining('ubuntu-latest-8-cores')
    });
  });

  it('counts a complete zero-job run as zero gross-equivalent cost', () => {
    const projection = estimateMonthlyProjection(
      history([
        run('no-jobs', []),
        run('paid', [job('job', ['ubuntu-latest'], 1)])
      ], 2, 30.4375),
      {
        baseUsdPerWorkflowMinute: 0.006,
        headUsdPerWorkflowMinute: 0.006
      }
    );

    expect(projection.history).toMatchObject({ validRuns: 2, excludedRuns: 0 });
    expect(projection.observedRunCost).toEqual({
      meanUsd: 0.003,
      p50Usd: 0,
      p95Usd: 0.006
    });
    expect(projection.baseMonthlyCost).toEqual({
      expectedUsd: 0.006,
      atRunP50Usd: 0,
      atRunP95Usd: 0.012
    });
    expect(projection.diagnostics).toContainEqual(expect.objectContaining({ code: 'empty-run' }));
  });

  it('counts cancelled jobs with no positive duration as zero before runner pricing', () => {
    const cancelled = (id: string, completedAt: string | null): HistoricalJob => ({
      id,
      runnerLabels: ['private-runner-without-catalog-rate'],
      startedAt: '2026-07-01T00:00:01.000Z',
      completedAt,
      conclusion: 'cancelled'
    });
    const projection = estimateMonthlyProjection(
      history([
        run('same-time', [cancelled('same', '2026-07-01T00:00:01.000Z')]),
        run('reversed-time', [cancelled('reverse', '2026-07-01T00:00:00.000Z')])
      ], 2, 30.4375),
      {
        baseUsdPerWorkflowMinute: 0.006,
        headUsdPerWorkflowMinute: 0.006
      }
    );

    expect(projection.history).toMatchObject({ validRuns: 2, excludedRuns: 0 });
    expect(projection.observedRunCost).toEqual({ meanUsd: 0, p50Usd: 0, p95Usd: 0 });
    expect(projection.baseMonthlyCost.expectedUsd).toBe(0);
    expect(projection.diagnostics).toContainEqual(expect.objectContaining({
      code: 'non-executed-cancelled-job'
    }));
    expect(projection.diagnostics.some(({ code }) => code === 'unknown-runner')).toBe(false);
  });

  it('uses totals above the 1,000-result pagination limit to estimate frequency', () => {
    const snapshot: HistorySnapshot = {
      windowDays: 30,
      totalCompletedRuns: 14_178,
      samplingStrategy: 'time-stratified-run-weighted',
      runs: [run('sample', [job('job', ['ubuntu-latest'], 1)])]
    };

    const projection = estimateMonthlyProjection(snapshot, {
      baseUsdPerWorkflowMinute: 0.006,
      headUsdPerWorkflowMinute: 0.012
    });

    expect(projection.observedRunCost).toEqual({
      meanUsd: 0.006,
      p50Usd: 0.006,
      p95Usd: 0.006
    });
    expect(projection.monthlyRunFrequency).toBe(14_384.7625);
    expect(projection.baseMonthlyCost).toEqual({
      expectedUsd: 86.308575,
      atRunP50Usd: 86.308575,
      atRunP95Usd: 86.308575
    });
    expect(projection.proposedMonthlyCost).toEqual({
      expectedUsd: 172.61715,
      atRunP50Usd: 172.61715,
      atRunP95Usd: 172.61715
    });
    expect(projection.monthlyDelta).toEqual({
      expectedUsd: 86.308575,
      atRunP50Usd: 86.308575,
      atRunP95Usd: 86.308575
    });
    expect(projection.confidence).toBe('low');
  });

  it('caps confidence at medium even for a large, complete window', () => {
    const runs = Array.from({ length: 20 }, (_, index) =>
      run('run-' + index, [job('job-' + index, ['ubuntu-latest'], 1)]));

    const projection = estimateMonthlyProjection(
      history(runs, 20, 30),
      {
        baseUsdPerWorkflowMinute: 0.012,
        headUsdPerWorkflowMinute: 0.006
      }
    );

    expect(projection.monthlyRunFrequency).toBe(20.291667);
    expect(projection.confidence).toBe('medium');
    expect(projection.diagnostics).toContainEqual(expect.objectContaining({
      code: 'model-confidence-cap'
    }));
    expect(projection.baseMonthlyCost).toEqual({
      expectedUsd: 0.12175,
      atRunP50Usd: 0.12175,
      atRunP95Usd: 0.12175
    });
    expect(projection.proposedMonthlyCost).toEqual({
      expectedUsd: 0.060875,
      atRunP50Usd: 0.060875,
      atRunP95Usd: 0.060875
    });
    expect(projection.monthlyDelta).toEqual({
      expectedUsd: -0.060875,
      atRunP50Usd: -0.060875,
      atRunP95Usd: -0.060875
    });
  });

  it('keeps the observed baseline but withholds proposed cost without both static rates', () => {
    const projection = estimateMonthlyProjection(
      history([run('run', [job('job', ['ubuntu-latest'], 1)])], 1, 30.4375),
      {
        baseUsdPerWorkflowMinute: null,
        headUsdPerWorkflowMinute: 0.006
      }
    );

    expect(projection.baseMonthlyCost).toEqual({
      expectedUsd: 0.006,
      atRunP50Usd: 0.006,
      atRunP95Usd: 0.006
    });
    expect(projection.staticRateRatio).toBeNull();
    expect(projection.proposedMonthlyCost).toEqual({
      expectedUsd: null,
      atRunP50Usd: null,
      atRunP95Usd: null
    });
    expect(projection.monthlyDelta).toEqual({
      expectedUsd: null,
      atRunP50Usd: null,
      atRunP95Usd: null
    });
    expect(projection.confidence).toBe('low');
    expect(projection.diagnostics).toContainEqual(expect.objectContaining({
      code: 'missing-static-rate'
    }));
  });

  it('withholds the proposed scenario when triggers changed', () => {
    const projection = estimateMonthlyProjection(
      history(Array.from({ length: 5 }, (_, index) =>
        run('run-' + index, [job('job-' + index, ['ubuntu-latest'], 2)])), 30, 30),
      {
        baseUsdPerWorkflowMinute: 0.006,
        headUsdPerWorkflowMinute: 0.012,
        triggerConfigurationChanged: true
      }
    );

    expect(projection.baseMonthlyCost.expectedUsd).not.toBeNull();
    expect(projection.staticRateRatio).toBe(2);
    expect(projection.proposedMonthlyCost).toEqual({
      expectedUsd: null,
      atRunP50Usd: null,
      atRunP95Usd: null
    });
    expect(projection.monthlyDelta).toEqual({
      expectedUsd: null,
      atRunP50Usd: null,
      atRunP95Usd: null
    });
    expect(projection.confidence).toBe('low');
    expect(projection.diagnostics).toContainEqual(expect.objectContaining({
      code: 'trigger-configuration-changed'
    }));
  });

  it('withholds proposed cost when a static matrix estimate is approximate', () => {
    const projection = estimateMonthlyProjection(
      history(Array.from({ length: 5 }, (_, index) =>
        run('run-' + index, [job('job-' + index, ['ubuntu-latest'], 2)])), 30, 30),
      {
        baseUsdPerWorkflowMinute: 0.006,
        headUsdPerWorkflowMinute: 0.012,
        staticComparisonComplete: false
      }
    );

    expect(projection.baseMonthlyCost.expectedUsd).not.toBeNull();
    expect(projection.proposedMonthlyCost).toEqual({
      expectedUsd: null,
      atRunP50Usd: null,
      atRunP95Usd: null
    });
    expect(projection.monthlyDelta).toEqual({
      expectedUsd: null,
      atRunP50Usd: null,
      atRunP95Usd: null
    });
    expect(projection.diagnostics).toContainEqual(expect.objectContaining({
      code: 'approximate-static-comparison'
    }));
  });

  it('rounds each job to integer micro-USD before accumulating the run', () => {
    const mutable = structuredClone(DEFAULT_PRICING_CATALOG) as PricingCatalog;
    mutable.catalogVersion = 'micro-usd-test';
    mutable.runnerFamilies.linux.pricePerMinute = 0.0000006;
    const catalog = validatePricingCatalog(mutable);

    const projection = estimateMonthlyProjection(
      history([run('run', [job('job', ['ubuntu-latest'], 1)])], 1, 30.4375),
      {
        baseUsdPerWorkflowMinute: 0.0000006,
        headUsdPerWorkflowMinute: 0.0000006
      },
      catalog
    );

    expect(projection.observedRunCost).toEqual({
      meanUsd: 0.000001,
      p50Usd: 0.000001,
      p95Usd: 0.000001
    });
    expect(projection.baseMonthlyCost).toEqual({
      expectedUsd: 0.000001,
      atRunP50Usd: 0.000001,
      atRunP95Usd: 0.000001
    });
  });

  it('renders the experimental range without exposing raw history identifiers', () => {
    const projection = estimateMonthlyProjection(
      history(Array.from({ length: 5 }, (_, index) =>
        run('private-run-' + index, [
          job('private-job-' + index, ['ubuntu-latest'], 10)
        ])), 30, 30.4375),
      {
        baseUsdPerWorkflowMinute: 0.006,
        headUsdPerWorkflowMinute: 0.012
      }
    );
    const workflow = [
      'name: CI',
      'on: push',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    timeout-minutes: 10',
      '    steps:',
      '      - run: npm test'
    ].join('\n');
    const comparison = compareWorkflowDocuments(workflow, workflow, 'ci.yml');
    const markdown = formatComparisonMarkdown({ ...comparison, monthlyProjection: projection });

    expect(markdown).toContain('Experimental monthly projection');
    expect(markdown).toContain('Historical base');
    expect(markdown).toContain('gross-equivalent');
    expect(markdown.match(/## Introduced findings/g)).toHaveLength(1);
    expect(JSON.stringify(projection)).not.toContain('private-run-');
    expect(JSON.stringify(projection)).not.toContain('private-job-');

    const unavailable = formatComparisonMarkdown({
      ...comparison,
      historyCollection: {
        status: 'unavailable',
        reason: 'GitHub API HTTP 403'
      }
    });
    expect(unavailable).toContain('History was requested but is unavailable');
    expect(unavailable).toContain('Static analysis remains available');
  });
});

function history(
  runs: readonly HistoricalRun[],
  totalCompletedRuns: number,
  windowDays: number
): HistorySnapshot {
  return {
    windowDays,
    totalCompletedRuns,
    samplingStrategy: 'time-stratified-run-weighted',
    runs
  };
}

function run(
  id: string,
  jobs: readonly HistoricalJob[],
  jobsTruncated = false
): HistoricalRun {
  return { id, jobs, jobsTruncated };
}

function job(
  id: string,
  runnerLabels: readonly string[],
  durationMinutes: number
): HistoricalJob {
  const startedAtMs = Date.parse('2026-07-01T00:00:00.000Z');
  return {
    id,
    runnerLabels,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(startedAtMs + durationMinutes * 60_000).toISOString(),
    conclusion: 'success'
  };
}
