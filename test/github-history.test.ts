import { describe, expect, it, vi } from 'vitest';
import {
  collectWorkflowHistory,
  type ActionsHistoryApi
} from '../src/github-history.js';

describe('GitHub Actions history adapter', () => {
  it('uses the documented filename form and collects bounded rerun metadata', async () => {
    let runBucket = 0;
    const listWorkflowRuns = vi.fn(async () => {
      runBucket += 1;
      return {
        data: {
          total_count: 4,
          workflow_runs: [{ id: 100 + runBucket }]
        }
      };
    });
    const listJobsForWorkflowRun = vi.fn(async ({ run_id }: { run_id: number }) => ({
      data: {
        total_count: 1,
        jobs: [{
          id: run_id * 10,
          labels: ['ubuntu-latest'],
          started_at: '2026-07-15T10:00:00Z',
          completed_at: '2026-07-15T10:05:00Z',
          conclusion: 'success'
        }]
      }
    }));
    const api = { listWorkflowRuns, listJobsForWorkflowRun } as ActionsHistoryApi;

    const snapshot = await collectWorkflowHistory(api, {
      owner: 'acme',
      repo: 'widgets',
      workflowPath: '.github/workflows/ci.yml',
      windowDays: 30,
      sampleRuns: 3,
      now: new Date('2026-08-01T00:00:00Z')
    });

    expect(listWorkflowRuns).toHaveBeenCalledTimes(3);
    expect(listWorkflowRuns).toHaveBeenNthCalledWith(1, {
      owner: 'acme',
      repo: 'widgets',
      workflow_id: 'ci.yml',
      status: 'completed',
      created: '2026-07-02T00:00:00Z..2026-07-11T23:59:59Z',
      exclude_pull_requests: true,
      per_page: 3
    });
    expect(listWorkflowRuns).toHaveBeenNthCalledWith(3, expect.objectContaining({
      created: '2026-07-22T00:00:00Z..2026-08-01T00:00:00Z'
    }));
    expect(listJobsForWorkflowRun).toHaveBeenCalledTimes(3);
    expect(listJobsForWorkflowRun).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      run_id: 101,
      filter: 'all',
      per_page: 100,
      page: 1
    });
    expect(snapshot).toEqual({
      windowDays: 30,
      totalCompletedRuns: 12,
      samplingStrategy: 'time-stratified-run-weighted',
      runs: [
        {
          id: '101',
          jobsTruncated: false,
          jobs: [{
            id: '1010',
            runnerLabels: ['ubuntu-latest'],
            startedAt: '2026-07-15T10:00:00Z',
            completedAt: '2026-07-15T10:05:00Z',
            conclusion: 'success'
          }]
        },
        {
          id: '102',
          jobsTruncated: false,
          jobs: [{
            id: '1020',
            runnerLabels: ['ubuntu-latest'],
            startedAt: '2026-07-15T10:00:00Z',
            completedAt: '2026-07-15T10:05:00Z',
            conclusion: 'success'
          }]
        },
        {
          id: '103',
          jobsTruncated: false,
          jobs: [{
            id: '1030',
            runnerLabels: ['ubuntu-latest'],
            startedAt: '2026-07-15T10:00:00Z',
            completedAt: '2026-07-15T10:05:00Z',
            conclusion: 'success'
          }]
        }
      ]
    });
  });

  it('keeps a large total count while marking partial job pages as incomplete', async () => {
    const totals = [2_836, 2_836, 2_836, 2_835, 2_835];
    let bucketIndex = 0;
    const api: ActionsHistoryApi = {
      listWorkflowRuns: async () => {
        const index = bucketIndex;
        bucketIndex += 1;
        return {
          data: {
            total_count: totals[index] ?? 0,
            workflow_runs: [{ id: 200 + index }]
          }
        };
      },
      listJobsForWorkflowRun: async () => ({
        data: {
          total_count: 201,
          jobs: [{
            id: 2_001,
            labels: ['windows-latest'],
            started_at: null,
            completed_at: null,
            conclusion: 'cancelled'
          }]
        }
      })
    };

    const snapshot = await collectWorkflowHistory(api, {
      owner: 'acme',
      repo: 'widgets',
      workflowPath: '.github/workflows/build.yaml',
      windowDays: 90,
      sampleRuns: 20,
      now: new Date('2026-08-01T00:00:00Z')
    });

    expect(snapshot.totalCompletedRuns).toBe(14_178);
    expect(snapshot.runs[0]?.jobsTruncated).toBe(true);
  });

  it('allocates the global sample by run volume instead of weighting buckets equally', async () => {
    const totals = [1_000, 1, 0, 0, 0];
    let index = 0;
    const api: ActionsHistoryApi = {
      listWorkflowRuns: async () => {
        const bucket = index;
        index += 1;
        return {
          data: {
            total_count: totals[bucket] ?? 0,
            workflow_runs: bucket === 0
              ? Array.from({ length: 10 }, (_, runIndex) => ({ id: 300 + runIndex }))
              : bucket === 1 ? [{ id: 999 }] : []
          }
        };
      },
      listJobsForWorkflowRun: async ({ run_id }) => ({
        data: {
          total_count: 1,
          jobs: [{
            id: run_id * 10,
            labels: ['ubuntu-latest'],
            started_at: '2026-07-15T10:00:00Z',
            completed_at: '2026-07-15T10:01:00Z',
            conclusion: 'success'
          }]
        }
      })
    };

    const snapshot = await collectWorkflowHistory(api, {
      owner: 'acme',
      repo: 'widgets',
      workflowPath: '.github/workflows/ci.yml',
      windowDays: 30,
      sampleRuns: 10,
      now: new Date('2026-08-01T00:00:00Z')
    });

    expect(snapshot.totalCompletedRuns).toBe(1_001);
    expect(snapshot.runs).toHaveLength(10);
    expect(snapshot.runs.map(({ id }) => id)).not.toContain('999');
  });

  it('paginates rerun jobs to a hard cap of 200 records', async () => {
    let bucket = 0;
    const api: ActionsHistoryApi = {
      listWorkflowRuns: async () => ({
        data: { total_count: 1, workflow_runs: [{ id: 700 + bucket++ }] }
      }),
      listJobsForWorkflowRun: async ({ run_id, page }) => ({
        data: {
          total_count: 101,
          jobs: page === 1
            ? Array.from({ length: 100 }, (_, index) => historyJob(run_id * 1_000 + index))
            : [historyJob(run_id * 1_000 + 100)]
        }
      })
    };

    const snapshot = await collectWorkflowHistory(api, {
      owner: 'acme',
      repo: 'widgets',
      workflowPath: '.github/workflows/ci.yml',
      windowDays: 30,
      sampleRuns: 3,
      now: new Date('2026-08-01T00:00:00Z')
    });

    expect(snapshot.runs).toHaveLength(3);
    expect(snapshot.runs.every((run) => run.jobs.length === 101)).toBe(true);
    expect(snapshot.runs.every((run) => !run.jobsTruncated)).toBe(true);
  });

  it('marks a run partial when job totals change during pagination', async () => {
    let bucket = 0;
    const api: ActionsHistoryApi = {
      listWorkflowRuns: async () => ({
        data: { total_count: 1, workflow_runs: [{ id: 800 + bucket++ }] }
      }),
      listJobsForWorkflowRun: async ({ run_id, page }) => ({
        data: {
          total_count: page === 1 ? 101 : 102,
          jobs: page === 1
            ? Array.from({ length: 100 }, (_, index) => historyJob(run_id * 1_000 + index))
            : [historyJob(run_id * 1_000 + 100), historyJob(run_id * 1_000 + 101)]
        }
      })
    };

    const snapshot = await collectWorkflowHistory(api, {
      owner: 'acme',
      repo: 'widgets',
      workflowPath: '.github/workflows/ci.yml',
      windowDays: 30,
      sampleRuns: 3,
      now: new Date('2026-08-01T00:00:00Z')
    });

    expect(snapshot.runs).toHaveLength(3);
    expect(snapshot.runs.every((run) => run.jobsTruncated)).toBe(true);
  });

  it('rejects configuration outside the public action bounds before calling GitHub', async () => {
    const api: ActionsHistoryApi = {
      listWorkflowRuns: vi.fn(),
      listJobsForWorkflowRun: vi.fn()
    };

    await expect(collectWorkflowHistory(api, {
      owner: 'acme',
      repo: 'widgets',
      workflowPath: '.github/workflows/ci.yml',
      windowDays: 6,
      sampleRuns: 10
    })).rejects.toThrow(/7 to 90/);
    expect(api.listWorkflowRuns).not.toHaveBeenCalled();
  });
});

function historyJob(id: number) {
  return {
    id,
    labels: ['ubuntu-latest'],
    started_at: '2026-07-15T10:00:00Z',
    completed_at: '2026-07-15T10:01:00Z',
    conclusion: 'success'
  };
}
