import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import fg from 'fast-glob';
import { analyzeWorkflow } from './analyzer.js';
import { compareWorkflowDocuments } from './compare.js';
import {
  formatAnalysisMarkdown,
  formatComparisonMarkdown,
  formatFindingSummary
} from './format.js';
import {
  collectWorkflowHistory,
  type ActionsHistoryApi
} from './github-history.js';
import {
  estimateMonthlyProjection,
  type HistorySnapshot
} from './history.js';
import { parseWorkflow } from './parser.js';
import type {
  AnalysisResult,
  ComparisonResult,
  Finding,
  Severity
} from './types.js';
import { classifyWorkflowFileChange } from './workflow-path.js';

type ReportItem = AnalysisResult | ComparisonResult;
type Octokit = ReturnType<typeof github.getOctokit>;

interface ActionReport {
  event: string;
  items: ReportItem[];
  deletedWorkflowFiles: string[];
}

interface SerializableActionReport extends ActionReport {
  truncated: boolean;
  summaryTruncated: boolean;
  omittedItems: number;
  omittedDeletedWorkflowFiles: number;
}

interface BoundedMarkdown {
  markdown: string;
  truncated: boolean;
  omittedItems: number;
  omittedDeletedWorkflowFiles: number;
}

interface HistoryOptions {
  enabled: boolean;
  windowDays: number;
  sampleRuns: number;
}

interface HistoryRequestBudget {
  remaining: number;
}

const COMMENT_MARKER = '<!-- ci-bill-doctor-report -->';
const MAX_HISTORY_WORKFLOWS = 5;
const MAX_HISTORY_API_REQUESTS = 120;
const MAX_STEP_SUMMARY_BYTES = 900_000;
const MAX_REPORT_OUTPUT_UTF16_BYTES = 900_000;
const MAX_COMMENT_BYTES = 60_000;
const OUTPUT_SIZE_RESERVE_BYTES = 2_048;

async function run(): Promise<void> {
  const token = core.getInput('github-token');
  const commentInput = core.getInput('comment');
  const shouldComment = commentInput === '' ? false : core.getBooleanInput('comment');
  const failOn = parseFailOn(core.getInput('fail-on') || 'none');
  const historyOptions = parseHistoryOptions();

  if (historyOptions.enabled && !github.context.payload.pull_request) {
    core.warning('History projection currently runs only for pull-request comparisons.');
  } else if (historyOptions.enabled && !token) {
    core.warning('History projection requires github-token; continuing with static analysis.');
  }

  const report = github.context.payload.pull_request && token
    ? await analyzePullRequest(token, historyOptions)
    : await analyzeWorkspace();

  const summaryReport = formatBoundedActionReport(report, MAX_STEP_SUMMARY_BYTES);
  const outputReport = fitSerializableActionReport(
    report,
    summaryReport.truncated,
    MAX_REPORT_OUTPUT_UTF16_BYTES
  );
  if (summaryReport.truncated || outputReport.truncated) {
    core.warning(
      'Report output was truncated at workflow boundaries to stay within GitHub output limits.'
    );
  }
  await core.summary.addRaw(summaryReport.markdown).write();
  core.setOutput('report-json', JSON.stringify(outputReport));

  if (shouldComment && github.context.payload.pull_request) {
    if (!token) {
      core.warning('Cannot create a pull-request comment without github-token.');
    } else {
      const commentReport = formatBoundedActionReport(report, MAX_COMMENT_BYTES);
      await upsertComment(github.getOctokit(token), commentReport.markdown);
    }
  }

  const blocking = collectRelevantFindings(report.items)
    .filter((finding) => meetsThreshold(finding.severity, failOn));

  if (blocking.length > 0) {
    core.setFailed(
      'CI Bill Doctor found findings at or above '
      + failOn
      + ': '
      + formatFindingSummary(blocking)
    );
  }
}

async function analyzePullRequest(
  token: string,
  historyOptions: HistoryOptions
): Promise<ActionReport> {
  const client = github.getOctokit(token);
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) {
    return analyzeWorkspace();
  }

  const { owner, repo } = github.context.repo;
  const pullNumber = pullRequest.number;
  const baseOwner = pullRequest.base.repo.owner.login;
  const baseRepo = pullRequest.base.repo.name;
  const files = await listPullRequestFiles(client, owner, repo, pullNumber);
  const reportedChangedFiles = pullRequest.changed_files;
  if (
    Number.isSafeInteger(reportedChangedFiles)
    && reportedChangedFiles >= 0
    && files.length < reportedChangedFiles
  ) {
    throw new Error(
      'GitHub reported '
      + reportedChangedFiles
      + ' changed pull-request files, but the API returned only '
      + files.length
      + '. Refusing to analyze an incomplete file list; split the pull request '
      + 'or reduce it below GitHub\'s 3,000-file API limit.'
    );
  }

  const items: ReportItem[] = [];
  const deletedWorkflowFiles: string[] = [];
  let historyWorkflowCount = 0;
  let historyLimitWarningEmitted = false;
  const historyRequestBudget: HistoryRequestBudget = {
    remaining: MAX_HISTORY_API_REQUESTS
  };

  for (const file of files) {
    const change = classifyWorkflowFileChange(file);
    if (change.kind === 'irrelevant') {
      continue;
    }
    if (change.kind === 'removed') {
      deletedWorkflowFiles.push(change.basePath);
      continue;
    }

    const headText = await readRepositoryFile(
      client,
      // Pull-request head commits are exposed through the base repository's
      // pull ref. Keeping the request in the base repository preserves the
      // GITHUB_TOKEN scope for forks while the event SHA prevents ref races.
      baseOwner,
      baseRepo,
      change.headPath,
      pullRequest.head.sha
    );

    if (change.kind === 'added') {
      items.push(
        analyzeWorkflow(
          parseWorkflow(headText, change.headPath),
          change.headPath
        )
      );
      continue;
    }

    const baseText = await readRepositoryFile(
      client,
      baseOwner,
      baseRepo,
      change.basePath,
      pullRequest.base.sha
    );
    let comparison = compareWorkflowDocuments(baseText, headText, change.headPath);

    if (historyOptions.enabled) {
      if (historyWorkflowCount >= MAX_HISTORY_WORKFLOWS) {
        if (!historyLimitWarningEmitted) {
          core.warning(
            'History projection is limited to '
            + MAX_HISTORY_WORKFLOWS
            + ' modified workflows per action run; remaining workflows use static analysis.'
          );
          historyLimitWarningEmitted = true;
        }
        comparison = {
          ...comparison,
          historyCollection: {
            status: 'unavailable',
            reason: 'Per-action history workflow limit reached.'
          }
        };
      } else {
        historyWorkflowCount += 1;
        comparison = await addHistoryProjection(
          client,
          comparison,
          baseOwner,
          baseRepo,
          change.basePath,
          historyOptions,
          historyRequestBudget
        );
      }
    }

    items.push(comparison);
  }

  return {
    event: 'pull_request',
    items,
    deletedWorkflowFiles
  };
}

async function listPullRequestFiles(
  client: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
) {
  try {
    return await client.paginate(client.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100
    });
  } catch (error: unknown) {
    if (apiStatus(error) === 403) {
      throw new Error(
        'Unable to list pull-request files. Grant the workflow '
        + '`pull-requests: read` (or `write` when comments are enabled).',
        { cause: error }
      );
    }
    throw error;
  }
}

async function addHistoryProjection(
  client: Octokit,
  comparison: ComparisonResult,
  owner: string,
  repo: string,
  workflowPath: string,
  options: HistoryOptions,
  requestBudget: HistoryRequestBudget
): Promise<ComparisonResult> {
  const api: ActionsHistoryApi = {
    listWorkflowRuns: (parameters) => {
      consumeHistoryRequest(requestBudget);
      return client.rest.actions.listWorkflowRuns(parameters);
    },
    listJobsForWorkflowRun: (parameters) => {
      consumeHistoryRequest(requestBudget);
      return client.rest.actions.listJobsForWorkflowRun(parameters);
    }
  };

  let snapshot: HistorySnapshot;
  try {
    snapshot = await collectWorkflowHistory(api, {
      owner,
      repo,
      workflowPath,
      windowDays: options.windowDays,
      sampleRuns: options.sampleRuns
    });
  } catch (error: unknown) {
    if (!isExpectedHistoryApiFailure(error)) {
      throw error;
    }
    const reason = describeApiFailure(error);
    core.warning(
      'History projection unavailable for '
      + workflowPath.replace(/[\r\n]+/g, ' ')
      + ' ('
      + reason
      + '); continuing with static analysis.'
    );
    return {
      ...comparison,
      historyCollection: { status: 'unavailable', reason }
    };
  }

  const monthlyProjection = estimateMonthlyProjection(snapshot, {
    baseUsdPerWorkflowMinute:
      comparison.costDelta.baseHostedRunnerRateUsdPerWorkflowMinute,
    headUsdPerWorkflowMinute:
      comparison.costDelta.headHostedRunnerRateUsdPerWorkflowMinute,
    triggerConfigurationChanged: comparison.triggerConfigurationChanged === true,
    staticComparisonComplete: [...comparison.base.jobs, ...comparison.head.jobs]
      .every((job) => job.matrix.confidence === 'high')
      && [...comparison.base.findings, ...comparison.head.findings]
        .every((finding) => finding.ruleId !== 'invalid-job')
  });

  return { ...comparison, monthlyProjection };
}

async function analyzeWorkspace(): Promise<ActionReport> {
  if (github.context.payload.pull_request) {
    core.warning('No token was available; falling back to standalone workspace analysis.');
  }

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const pattern = core.getInput('workflow-glob') || '.github/workflows/*.{yml,yaml}';
  const files = await fg(pattern, {
    cwd: workspace,
    onlyFiles: true,
    unique: true
  });

  const items: AnalysisResult[] = [];
  for (const file of files.sort()) {
    const sourceText = await readFile(join(workspace, file), 'utf8');
    items.push(analyzeWorkflow(parseWorkflow(sourceText, file), file));
  }

  return {
    event: github.context.eventName || 'local',
    items,
    deletedWorkflowFiles: []
  };
}

async function readRepositoryFile(
  client: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string> {
  const response = await client.rest.repos.getContent({
    owner,
    repo,
    path,
    ref
  });
  const data = response.data;

  if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
    throw new Error('Expected a repository file at ' + path + ' for ' + ref);
  }

  if (data.encoding !== 'base64') {
    throw new Error('Unsupported content encoding for ' + path + ': ' + data.encoding);
  }

  const sourceText = Buffer.from(data.content, 'base64').toString('utf8');
  if (Buffer.byteLength(sourceText, 'utf8') > 1_000_000) {
    throw new Error('Workflow file exceeds the 1 MB analysis limit: ' + path);
  }

  return sourceText;
}

function formatBoundedActionReport(
  report: ActionReport,
  maximumBytes: number
): BoundedMarkdown {
  const header = [
    '## CI Bill Doctor report',
    '',
    report.items.length === 0
      ? 'No added or modified GitHub Actions workflow files were found.'
      : 'Analyzed ' + report.items.length + ' workflow file(s).'
  ].join('\n');
  const sections = [header];
  let usedBytes = Buffer.byteLength(header, 'utf8');
  let omittedItems = 0;
  let omittedDeletedWorkflowFiles = 0;

  for (const item of report.items) {
    const section = [
      '',
      '',
      '<details open>',
      '<summary><strong>' + escapeHtml(item.source) + '</strong></summary>',
      '',
      item.kind === 'comparison'
        ? formatComparisonMarkdown(item)
        : formatAnalysisMarkdown(item),
      '',
      '</details>'
    ].join('\n');
    const sectionBytes = Buffer.byteLength(section, 'utf8');
    if (usedBytes + sectionBytes <= maximumBytes - OUTPUT_SIZE_RESERVE_BYTES) {
      sections.push(section);
      usedBytes += sectionBytes;
    } else {
      omittedItems += 1;
    }
  }

  if (report.deletedWorkflowFiles.length > 0) {
    const section = [
      '',
      '',
      'Deleted workflow files: '
        + report.deletedWorkflowFiles.map((file) => inlineReportText(file)).join(', ')
        + '.'
    ].join('\n');
    const sectionBytes = Buffer.byteLength(section, 'utf8');
    if (usedBytes + sectionBytes <= maximumBytes - OUTPUT_SIZE_RESERVE_BYTES) {
      sections.push(section);
      usedBytes += sectionBytes;
    } else {
      omittedDeletedWorkflowFiles = report.deletedWorkflowFiles.length;
    }
  }

  const truncated = omittedItems > 0 || omittedDeletedWorkflowFiles > 0;
  if (truncated) {
    sections.push(
      '\n\n> Report truncated to fit the GitHub Step Summary limit. Omitted '
      + omittedItems
      + ' workflow detail(s) and '
      + omittedDeletedWorkflowFiles
      + ' deleted path(s). Machine output marks its own truncation explicitly.'
    );
  }

  const markdown = sections.join('');
  if (Buffer.byteLength(markdown, 'utf8') > maximumBytes) {
    throw new Error('Unable to fit the bounded Step Summary within its byte limit.');
  }
  return { markdown, truncated, omittedItems, omittedDeletedWorkflowFiles };
}

function fitSerializableActionReport(
  report: ActionReport,
  summaryTruncated: boolean,
  maximumUtf16Bytes: number
): SerializableActionReport {
  const bounded: SerializableActionReport = {
    event: report.event,
    items: [],
    deletedWorkflowFiles: [],
    truncated: false,
    summaryTruncated,
    omittedItems: 0,
    omittedDeletedWorkflowFiles: 0
  };
  const contentLimit = maximumUtf16Bytes - OUTPUT_SIZE_RESERVE_BYTES;

  for (const item of report.items) {
    const candidate = { ...bounded, items: [...bounded.items, item] };
    if (jsonUtf16Bytes(candidate) <= contentLimit) {
      bounded.items.push(item);
    } else {
      bounded.omittedItems += 1;
    }
  }

  for (const file of report.deletedWorkflowFiles) {
    const candidate = {
      ...bounded,
      deletedWorkflowFiles: [...bounded.deletedWorkflowFiles, file]
    };
    if (jsonUtf16Bytes(candidate) <= contentLimit) {
      bounded.deletedWorkflowFiles.push(file);
    } else {
      bounded.omittedDeletedWorkflowFiles += 1;
    }
  }

  bounded.truncated = bounded.omittedItems > 0
    || bounded.omittedDeletedWorkflowFiles > 0;
  if (jsonUtf16Bytes(bounded) > maximumUtf16Bytes) {
    throw new Error('Unable to fit the bounded report JSON within its output limit.');
  }
  return bounded;
}

function jsonUtf16Bytes(value: unknown): number {
  return JSON.stringify(value).length * 2;
}

function collectRelevantFindings(items: ReportItem[]): Finding[] {
  return items.flatMap((item) =>
    item.kind === 'comparison' ? item.introducedFindings : item.findings
  );
}

function parseHistoryOptions(): HistoryOptions {
  const rawEnabled = core.getInput('history');
  const enabled = rawEnabled === '' ? false : core.getBooleanInput('history');
  if (!enabled) {
    return { enabled: false, windowDays: 30, sampleRuns: 10 };
  }

  return {
    enabled: true,
    windowDays: parseBoundedIntegerInput('history-window-days', 30, 7, 90),
    sampleRuns: parseBoundedIntegerInput('history-sample-runs', 10, 3, 20)
  };
}

function parseBoundedIntegerInput(
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  const raw = core.getInput(name).trim();
  if (raw === '') {
    return defaultValue;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(name + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  }
  return value;
}

function parseFailOn(raw: string): Severity | 'none' {
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === 'none'
    || normalized === 'high'
    || normalized === 'medium'
    || normalized === 'low'
    || normalized === 'info'
  ) {
    return normalized;
  }

  throw new Error('fail-on must be one of none, high, medium, low, info');
}

function describeApiFailure(error: unknown): string {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'HISTORY_REQUEST_BUDGET_EXCEEDED'
  ) {
    return 'per-action history API request budget exhausted';
  }
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isInteger(status)) {
      return 'GitHub API HTTP ' + status;
    }
  }
  return 'unexpected GitHub API error';
}

function apiStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

function isExpectedHistoryApiFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ('status' in error && typeof (error as { status?: unknown }).status === 'number') {
    return true;
  }

  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ECONNREFUSED',
    'UND_ERR_CONNECT_TIMEOUT',
    'HISTORY_REQUEST_BUDGET_EXCEEDED'
  ]).has(code);
}

function consumeHistoryRequest(budget: HistoryRequestBudget): void {
  if (budget.remaining <= 0) {
    const error = new Error('History API request budget exhausted.') as Error & { code: string };
    error.code = 'HISTORY_REQUEST_BUDGET_EXCEEDED';
    throw error;
  }
  budget.remaining -= 1;
}

function meetsThreshold(severity: Severity, threshold: Severity | 'none'): boolean {
  if (threshold === 'none') {
    return false;
  }

  const weight: Record<Severity, number> = {
    info: 1,
    low: 2,
    medium: 3,
    high: 4
  };
  return weight[severity] >= weight[threshold];
}

async function upsertComment(client: Octokit, markdown: string): Promise<void> {
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) {
    return;
  }

  const { owner, repo } = github.context.repo;
  const body = COMMENT_MARKER + '\n' + markdown.slice(0, 64_000);

  try {
    const comments = await client.paginate(client.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullRequest.number,
      per_page: 100
    });
    const candidates = comments.filter((comment) => {
      if (!comment.body?.includes(COMMENT_MARKER)) {
        return false;
      }
      const login = comment.user?.login;
      return login === 'github-actions[bot]' || login === github.context.actor;
    });

    for (const candidate of candidates) {
      try {
        await client.rest.issues.updateComment({
          owner,
          repo,
          comment_id: candidate.id,
          body
        });
        return;
      } catch (error: unknown) {
        const status = apiStatus(error);
        if (status !== 403 && status !== 404) {
          throw error;
        }
        // A marker can come from another user or bot. Try another candidate,
        // then create our own comment instead of letting it block reporting.
      }
    }

    await client.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullRequest.number,
      body
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning('Unable to create the pull-request comment: ' + message);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/@/g, '@\u200b');
}

function inlineReportText(value: string): string {
  const markdownEscaped = value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_\[\]{}()#!|+~\-])/g, '\\$1')
    .replace(/[\r\n]+/g, ' ');
  return escapeHtml(markdownEscaped).trim();
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  core.setFailed(message);
});
