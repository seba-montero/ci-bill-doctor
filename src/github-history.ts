import type { HistoricalJob, HistoricalRun, HistorySnapshot } from './history.js';

const JOBS_PER_PAGE = 100;
const MAX_JOBS_PER_RUN = 200;
const MAX_JOB_PAGES = MAX_JOBS_PER_RUN / JOBS_PER_PAGE;
const JOB_REQUEST_CONCURRENCY = 3;
const RUN_HISTORY_BUCKETS = 5;

interface WorkflowRunRecord {
  id: number;
}

interface WorkflowJobRecord {
  id: number;
  labels: string[];
  started_at: string | null;
  completed_at: string | null;
  conclusion: string | null;
}

interface WorkflowRunsResponse {
  data: {
    total_count: number;
    workflow_runs: WorkflowRunRecord[];
  };
}

interface WorkflowJobsResponse {
  data: {
    total_count: number;
    jobs: WorkflowJobRecord[];
  };
}

export interface ActionsHistoryApi {
  listWorkflowRuns(parameters: {
    owner: string;
    repo: string;
    workflow_id: string;
    status: 'completed';
    created: string;
    exclude_pull_requests: true;
    per_page: number;
  }): Promise<WorkflowRunsResponse>;
  listJobsForWorkflowRun(parameters: {
    owner: string;
    repo: string;
    run_id: number;
    filter: 'all';
    per_page: number;
    page: number;
  }): Promise<WorkflowJobsResponse>;
}

export interface CollectWorkflowHistoryOptions {
  owner: string;
  repo: string;
  workflowPath: string;
  windowDays: number;
  sampleRuns: number;
  now?: Date;
}

/**
 * Reads only run/job metadata. It deliberately does not request logs, artifacts,
 * workflow contents or billing data.
 */
export async function collectWorkflowHistory(
  api: ActionsHistoryApi,
  options: CollectWorkflowHistoryOptions
): Promise<HistorySnapshot> {
  validateOptions(options);

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error('History collection requires a valid current date.');
  }

  const normalizedNow = new Date(Math.floor(now.getTime() / 1_000) * 1_000);
  const since = new Date(normalizedNow.getTime() - options.windowDays * 86_400_000);
  const buckets = buildTimeBuckets(since, normalizedNow, options.sampleRuns);
  const bucketResponses: WorkflowRunsResponse[] = [];
  const workflowId = workflowFileName(options.workflowPath);
  const collectBucket = (bucket: { created: string }): Promise<WorkflowRunsResponse> =>
    api.listWorkflowRuns({
      owner: options.owner,
      repo: options.repo,
      workflow_id: workflowId,
      status: 'completed',
      created: bucket.created,
      exclude_pull_requests: true,
      per_page: options.sampleRuns
    });

  const firstBucket = buckets[0];
  if (!firstBucket) {
    throw new Error('History sampling requires at least one time bucket.');
  }
  // Probe permissions with one request before issuing the remaining bounded batch.
  bucketResponses.push(await collectBucket(firstBucket));
  for (let offset = 1; offset < buckets.length; offset += JOB_REQUEST_CONCURRENCY) {
    const batch = buckets.slice(offset, offset + JOB_REQUEST_CONCURRENCY);
    bucketResponses.push(...await Promise.all(batch.map(collectBucket)));
  }

  let totalCompletedRuns = 0;
  const bucketTotals: number[] = [];
  for (let index = 0; index < bucketResponses.length; index += 1) {
    const response = bucketResponses[index];
    const bucket = buckets[index];
    if (!response || !bucket) {
      throw new Error('GitHub history bucket response was incomplete.');
    }
    const bucketTotal = nonNegativeInteger(
      response.data.total_count,
      'workflow run total_count'
    );
    totalCompletedRuns = nonNegativeInteger(
      totalCompletedRuns + bucketTotal,
      'combined workflow run total_count'
    );
    bucketTotals.push(bucketTotal);
  }

  const allocations = allocateSamples(
    bucketTotals,
    bucketResponses.map((response) => response.data.workflow_runs.length),
    options.sampleRuns
  );
  const selectedById = new Map<number, WorkflowRunRecord>();
  for (let index = 0; index < bucketResponses.length; index += 1) {
    const response = bucketResponses[index];
    const allocation = allocations[index] ?? 0;
    if (!response) {
      throw new Error('GitHub history bucket response was incomplete.');
    }
    for (const run of response.data.workflow_runs.slice(0, allocation)) {
      selectedById.set(run.id, run);
    }
  }
  const selectedRuns = [...selectedById.values()].slice(0, options.sampleRuns);
  const runs: HistoricalRun[] = [];

  for (let offset = 0; offset < selectedRuns.length; offset += JOB_REQUEST_CONCURRENCY) {
    const batch = selectedRuns.slice(offset, offset + JOB_REQUEST_CONCURRENCY);
    const collected = await Promise.all(
      batch.map((run) => collectRun(api, options.owner, options.repo, run))
    );
    runs.push(...collected);
  }

  return {
    windowDays: options.windowDays,
    totalCompletedRuns,
    samplingStrategy: 'time-stratified-run-weighted',
    runs
  };
}

function toGitHubTimestamp(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function buildTimeBuckets(
  since: Date,
  now: Date,
  sampleRuns: number
): Array<{ created: string }> {
  const bucketCount = Math.min(RUN_HISTORY_BUCKETS, sampleRuns);
  const durationMs = now.getTime() - since.getTime();
  const boundaries = Array.from({ length: bucketCount + 1 }, (_, index) =>
    Math.floor((since.getTime() + (durationMs * index) / bucketCount) / 1_000) * 1_000
  );

  return Array.from({ length: bucketCount }, (_, index) => {
    const start = boundaries[index];
    const next = boundaries[index + 1];
    if (start === undefined || next === undefined) {
      throw new Error('Unable to construct history time buckets.');
    }
    const end = index === bucketCount - 1 ? next : next - 1_000;
    return {
      created: toGitHubTimestamp(new Date(start))
        + '..'
        + toGitHubTimestamp(new Date(end))
    };
  });
}

function allocateSamples(
  totals: readonly number[],
  available: readonly number[],
  requested: number
): number[] {
  const allocations = totals.map(() => 0);
  const totalRuns = totals.reduce((sum, value) => sum + value, 0);
  const totalAvailable = available.reduce((sum, value) => sum + value, 0);
  const target = Math.min(requested, totalRuns, totalAvailable);
  if (target === 0 || totalRuns === 0) {
    return allocations;
  }

  for (let assigned = 0; assigned < target; assigned += 1) {
    let bestIndex = -1;
    let bestDeficit = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < totals.length; index += 1) {
      const capacity = available[index] ?? 0;
      const allocation = allocations[index] ?? 0;
      if (allocation >= capacity) {
        continue;
      }
      const ideal = (target * (totals[index] ?? 0)) / totalRuns;
      const deficit = ideal - allocation;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) {
      break;
    }
    allocations[bestIndex] = (allocations[bestIndex] ?? 0) + 1;
  }
  return allocations;
}

async function collectRun(
  api: ActionsHistoryApi,
  owner: string,
  repo: string,
  run: WorkflowRunRecord
): Promise<HistoricalRun> {
  const recordsById = new Map<number, WorkflowJobRecord>();
  let totalJobs: number | null = null;
  let totalCountConsistent = true;
  let duplicateJobRecord = false;

  for (let page = 1; page <= MAX_JOB_PAGES; page += 1) {
    const response = await api.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: run.id,
      // Include previous attempts: rerun jobs also consume runner time.
      filter: 'all',
      per_page: JOBS_PER_PAGE,
      page
    });
    const responseTotal = nonNegativeInteger(
      response.data.total_count,
      'workflow job total_count'
    );
    if (totalJobs !== null && responseTotal !== totalJobs) {
      totalJobs = Math.max(totalJobs, responseTotal);
      totalCountConsistent = false;
      break;
    }
    totalJobs = responseTotal;
    for (const job of response.data.jobs) {
      if (recordsById.has(job.id)) {
        duplicateJobRecord = true;
      } else if (recordsById.size < MAX_JOBS_PER_RUN) {
        recordsById.set(job.id, job);
      }
    }
    if (recordsById.size >= totalJobs || response.data.jobs.length < JOBS_PER_PAGE) {
      break;
    }
  }

  const jobs: HistoricalJob[] = [...recordsById.values()].map((job) => ({
    id: String(job.id),
    runnerLabels: [...job.labels],
    startedAt: job.started_at,
    completedAt: job.completed_at,
    conclusion: job.conclusion
  }));

  return {
    id: String(run.id),
    jobs,
    jobsTruncated: !totalCountConsistent
      || duplicateJobRecord
      || totalJobs === null
      || totalJobs > jobs.length
  };
}

function workflowFileName(workflowPath: string): string {
  const normalized = workflowPath.replace(/\\/g, '/');
  const filename = normalized.split('/').at(-1);
  if (!filename || !/\.ya?ml$/i.test(filename)) {
    throw new Error('History collection requires a .yml or .yaml workflow path.');
  }
  return filename;
}

function validateOptions(options: CollectWorkflowHistoryOptions): void {
  if (!Number.isInteger(options.windowDays) || options.windowDays < 7 || options.windowDays > 90) {
    throw new Error('history-window-days must be an integer from 7 to 90.');
  }
  if (!Number.isInteger(options.sampleRuns) || options.sampleRuns < 3 || options.sampleRuns > 20) {
    throw new Error('history-sample-runs must be an integer from 3 to 20.');
  }
  if (!options.owner || !options.repo) {
    throw new Error('History collection requires a repository owner and name.');
  }
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid ' + label + ' returned by GitHub.');
  }
  return value;
}
