import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const actionBundle = join(projectRoot, 'dist/action/index.cjs');

const baseWorkflow = `name: CI
on:
  pull_request:
  push:
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: npm test
`;

const headWorkflow = `name: CI
on:
  pull_request:
  push:
jobs:
  test:
    runs-on: windows-latest
    steps:
      - run: npm test
`;

const largeWorkflow = makeLargeWorkflow(5_000);

const scenarios = [
  { name: 'static fork PR', history: false, historyMode: 'unused' },
  { name: 'history permission fallback', history: true, historyMode: 'forbidden' },
  { name: 'history projection', history: true, historyMode: 'success' },
  {
    name: 'missing pull-request read permission',
    history: false,
    historyMode: 'unused',
    pullRequestFilesForbidden: true
  },
  {
    name: 'incomplete pull-request file list',
    history: false,
    historyMode: 'unused',
    incompletePullRequestFiles: true
  },
  {
    name: 'bounded large report',
    history: false,
    historyMode: 'unused',
    largeOutput: true
  },
  {
    name: 'PAT user comment update',
    history: false,
    historyMode: 'unused',
    comment: true,
    commentMode: 'user-update'
  },
  {
    name: 'foreign marker comment recovery',
    history: false,
    historyMode: 'unused',
    comment: true,
    commentMode: 'foreign-marker'
  }
];

for (const scenario of scenarios) {
  await runScenario(scenario);
}

console.log('Action bundle smoke: 8 scenarios passed.');

async function runScenario(scenario) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ci-bill-doctor-smoke-'));
  const eventPath = join(temporaryDirectory, 'event.json');
  const summaryPath = join(temporaryDirectory, 'summary.md');
  const outputPath = join(temporaryDirectory, 'output.txt');
  const requests = [];
  let historyBucket = 0;

  const event = {
    repository: {
      name: 'widgets',
      owner: { login: 'acme' }
    },
    pull_request: {
      number: 7,
      changed_files: scenario.incompletePullRequestFiles ? 3_001 : 1,
      base: {
        sha: 'base-sha',
        repo: { name: 'widgets', owner: { login: 'acme' } }
      },
      head: {
        sha: 'head-sha',
        repo: { name: 'widgets-fork', owner: { login: 'contributor' } }
      }
    }
  };

  await Promise.all([
    writeFile(eventPath, JSON.stringify(event), 'utf8'),
    writeFile(summaryPath, '', 'utf8'),
    writeFile(outputPath, '', 'utf8')
  ]);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    // Octokit percent-encodes the slash-bearing Contents API path parameter;
    // fetch encodes that percent sign once more on the wire.
    const pathname = decodeURIComponent(decodeURIComponent(url.pathname));
    requests.push({ method: request.method, pathname, search: url.search });

    if (pathname === '/repos/acme/widgets/issues/7/comments' && request.method === 'GET') {
      assert.equal(url.searchParams.get('per_page'), '100');
      if (scenario.commentMode === 'user-update') {
        return sendJson(response, 200, [{
          id: 91,
          body: '<!-- ci-bill-doctor-report -->\nold report',
          user: { login: 'pat-user', type: 'User' }
        }]);
      }
      if (scenario.commentMode === 'foreign-marker') {
        return sendJson(response, 200, [{
          id: 92,
          body: '<!-- ci-bill-doctor-report -->\nforeign report',
          user: { login: 'someone-else', type: 'User' }
        }]);
      }
      return sendJson(response, 200, []);
    }

    if (pathname === '/repos/acme/widgets/issues/comments/91' && request.method === 'PATCH') {
      return sendJson(response, 200, { id: 91 });
    }

    if (pathname === '/repos/acme/widgets/issues/7/comments' && request.method === 'POST') {
      return sendJson(response, 201, { id: 93 });
    }

    if (request.method !== 'GET') {
      return sendJson(response, 405, { message: 'Method not allowed' });
    }

    if (pathname === '/repos/acme/widgets/pulls/7/files') {
      assert.equal(url.searchParams.get('per_page'), '100');
      if (scenario.pullRequestFilesForbidden) {
        return sendJson(response, 403, { message: 'Resource not accessible by integration' });
      }
      return sendJson(response, 200, [{
        filename: '.github/workflows/ci.yml',
        status: 'modified'
      }]);
    }

    if (pathname === '/repos/acme/widgets/contents/.github/workflows/ci.yml') {
      const ref = url.searchParams.get('ref');
      if (ref === 'head-sha') {
        return sendContent(response, scenario.largeOutput ? largeWorkflow : headWorkflow);
      }
      assert.equal(ref, 'base-sha');
      return sendContent(response, baseWorkflow);
    }

    if (pathname === '/repos/acme/widgets/actions/workflows/ci.yml/runs') {
      assert.equal(url.searchParams.get('status'), 'completed');
      assert.equal(url.searchParams.get('exclude_pull_requests'), 'true');
      assert.equal(url.searchParams.get('per_page'), '10');
      assert.match(url.searchParams.get('created') ?? '', /^.+\.\..+$/);

      if (scenario.historyMode === 'forbidden') {
        return sendJson(response, 403, { message: 'Resource not accessible by integration' });
      }

      const runId = 1_001 + historyBucket;
      historyBucket += 1;
      return sendJson(response, 200, {
        total_count: 1,
        workflow_runs: [{ id: runId }]
      });
    }

    const jobsMatch = pathname.match(/^\/repos\/acme\/widgets\/actions\/runs\/(\d+)\/jobs$/);
    if (jobsMatch) {
      const runId = Number(jobsMatch[1]);
      assert.equal(url.searchParams.get('filter'), 'all');
      assert.equal(url.searchParams.get('per_page'), '100');
      assert.equal(url.searchParams.get('page'), '1');
      return sendJson(response, 200, {
        total_count: 1,
        jobs: [{
          id: runId * 10,
          labels: ['ubuntu-latest'],
          started_at: '2026-07-15T10:00:00Z',
          completed_at: '2026-07-15T10:05:00Z',
          conclusion: 'success'
        }]
      });
    }

    return sendJson(response, 404, { message: 'Unexpected smoke-test route: ' + pathname });
  });

  await new Promise((resolveListening, rejectListening) => {
    server.once('error', rejectListening);
    server.listen(0, '127.0.0.1', resolveListening);
  });

  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    const result = await spawnAction({
      eventPath,
      outputPath,
      summaryPath,
      workspace: temporaryDirectory,
      apiUrl: `http://127.0.0.1:${address.port}`,
      history: scenario.history,
      comment: scenario.comment === true
    });

    if (scenario.pullRequestFilesForbidden) {
      assert.equal(result.exitCode, 1);
      assert.match(result.stdout, /Grant the workflow .*pull-requests: read/);
      assert.equal(requests.length, 1);
      return;
    }

    if (scenario.incompletePullRequestFiles) {
      assert.equal(result.exitCode, 1);
      assert.match(result.stdout, /Refusing to analyze an incomplete file list/);
      assert.equal(requests.length, 1);
      return;
    }

    assert.equal(
      result.exitCode,
      0,
      `${scenario.name} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );

    const [summary, output] = await Promise.all([
      readFile(summaryPath, 'utf8'),
      readFile(outputPath, 'utf8')
    ]);
    assert.match(summary, /CI Bill Doctor report/);
    assert.match(output, /"event":"pull_request"/);
    if (!scenario.largeOutput) {
      assert.match(summary, /\.github\/workflows\/ci\.yml/);
      assert.match(output, /"kind":"comparison"/);
    }

    const requestedPaths = requests.map(({ pathname }) => pathname);
    assert(requestedPaths.includes('/repos/acme/widgets/pulls/7/files'));
    assert(requestedPaths.includes('/repos/acme/widgets/contents/.github/workflows/ci.yml'));
    assert(!requestedPaths.some((path) => path.startsWith('/repos/contributor/')));

    if (scenario.commentMode === 'user-update') {
      assert(requests.some(({ method, pathname }) =>
        method === 'PATCH' && pathname === '/repos/acme/widgets/issues/comments/91'
      ));
      assert(!requests.some(({ method }) => method === 'POST'));
    } else if (scenario.commentMode === 'foreign-marker') {
      assert(!requests.some(({ method }) => method === 'PATCH'));
      assert(requests.some(({ method, pathname }) =>
        method === 'POST' && pathname === '/repos/acme/widgets/issues/7/comments'
      ));
    } else if (scenario.largeOutput) {
      assert.match(summary, /Report truncated to fit the GitHub Step Summary limit/);
      assert.match(output, /"truncated":true/);
      assert.match(output, /"summaryTruncated":true/);
      assert.match(output, /"omittedItems":1/);
      assert(Buffer.byteLength(summary, 'utf8') <= 900_000);
      assert(output.length * 2 <= 910_000);
    } else if (scenario.historyMode === 'unused') {
      assert.equal(requests.length, 3);
      assert(!requestedPaths.some((path) => path.includes('/actions/')));
    } else if (scenario.historyMode === 'forbidden') {
      assert.match(summary, /History was requested but is unavailable/);
      assert.match(output, /"status":"unavailable"/);
      assert.match(output, /GitHub API HTTP 403/);
      assert.equal(requestedPaths.filter((path) => path.endsWith('/runs')).length, 1);
    } else {
      assert.equal(requestedPaths.filter((path) => path.endsWith('/runs')).length, 5);
      assert.equal(requestedPaths.filter((path) => path.endsWith('/jobs')).length, 5);
      assert.match(summary, /Expected\/month/);
      assert.match(output, /"totalCompletedRuns":5/);
      assert.match(output, /"confidence":"medium"/);
    }
  } finally {
    await new Promise((resolveClosed) => server.close(resolveClosed));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function spawnAction({ eventPath, outputPath, summaryPath, workspace, apiUrl, history, comment }) {
  return new Promise((resolveSpawn, rejectSpawn) => {
    const child = spawn(process.execPath, [actionBundle], {
      cwd: projectRoot,
      env: {
        ...process.env,
        GITHUB_ACTION: 'ci-bill-doctor-smoke',
        GITHUB_API_URL: apiUrl,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REPOSITORY: 'acme/widgets',
        GITHUB_STEP_SUMMARY: summaryPath,
        GITHUB_WORKSPACE: workspace,
        GITHUB_ACTOR: 'pat-user',
        INPUT_COMMENT: comment ? 'true' : 'false',
        'INPUT_FAIL-ON': 'none',
        'INPUT_GITHUB-TOKEN': 'smoke-token',
        INPUT_HISTORY: history ? 'true' : 'false',
        'INPUT_HISTORY-SAMPLE-RUNS': '10',
        'INPUT_HISTORY-WINDOW-DAYS': '30',
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectSpawn);
    child.once('close', (exitCode) => resolveSpawn({ exitCode, stdout, stderr }));
  });
}

function sendContent(response, source) {
  sendJson(response, 200, {
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(source, 'utf8').toString('base64'),
    size: Buffer.byteLength(source, 'utf8'),
    name: 'ci.yml',
    path: '.github/workflows/ci.yml',
    sha: 'fixture-sha',
    url: 'https://example.invalid/content',
    html_url: 'https://example.invalid/html',
    git_url: 'https://example.invalid/git',
    download_url: null,
    _links: {
      self: 'https://example.invalid/content',
      git: 'https://example.invalid/git',
      html: 'https://example.invalid/html'
    }
  });
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'x-github-api-version-selected': '2022-11-28'
  });
  response.end(JSON.stringify(value));
}

function makeLargeWorkflow(jobCount) {
  const jobs = Array.from({ length: jobCount }, (_, index) => {
    const jobId = 'job_' + String(index).padStart(4, '0');
    return `  ${jobId}:
    runs-on: ubuntu-latest
    steps:
      - run: echo smoke
`;
  }).join('');
  return `name: Large output smoke
on:
  pull_request:
jobs:
${jobs}`;
}
