import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { compareWorkflowDocuments } from '../src/compare.js';
import { isRecord, parseWorkflow } from '../src/parser.js';

const executeFile = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const labRoot = join(repositoryRoot, 'lab');
const baselineWorkflowPath = join(
  labRoot,
  'template/.github/workflows/app-ci.yml'
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('reproducible consumer lab', () => {
  it('uses a read-only, secretless guard with opt-in history', async () => {
    const path = join(labRoot, 'template/.github/workflows/ci-bill-doctor.yml');
    const source = await readFile(path, 'utf8');
    const workflow = parseWorkflow(source, path);
    const permissions = isRecord(workflow.permissions) ? workflow.permissions : {};
    const jobs = isRecord(workflow.jobs) ? workflow.jobs : {};
    const inspect = isRecord(jobs.inspect) ? jobs.inspect : {};
    const steps = Array.isArray(inspect.steps) ? inspect.steps.filter(isRecord) : [];
    const checkoutStep = steps.find(
      (step) =>
        step.uses ===
        'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803'
    );
    const checkoutInputs = checkoutStep && isRecord(checkoutStep.with)
      ? checkoutStep.with
      : {};
    const actionStep = steps.find((step) => step.uses === '__ACTION_REPOSITORY__@__ACTION_REF__');
    const inputs = actionStep && isRecord(actionStep.with) ? actionStep.with : {};

    expect(permissions).toEqual({
      actions: 'read',
      contents: 'read',
      'pull-requests': 'read'
    });
    expect(inputs).toMatchObject({
      'github-token': '${{ github.token }}',
      history: 'true',
      'history-window-days': '30',
      'history-sample-runs': '5',
      comment: 'false',
      'fail-on': 'none'
    });
    expect(actionStep?.id).toBe('bill_doctor');
    expect(checkoutInputs).toEqual({ 'persist-credentials': false });
    expect(source).not.toContain('pull_request_target');
    expect(source).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it('keeps the baseline workflow exactly priced and free of findings', async () => {
    const baseline = await readFile(baselineWorkflowPath, 'utf8');
    const comparison = compareWorkflowDocuments(baseline, baseline, 'app-ci.yml');

    expect(comparison.base.summary.hostedRunnerRateUsdPerWorkflowMinute).toBe(0.012);
    expect(comparison.base.findings).toEqual([]);
    expect(comparison.costDelta.direction).toBe('unchanged');
    expect(comparison.triggerConfigurationChanged).toBe(false);
  });

  it('models the matrix and macOS regression declared in the manifest', async () => {
    const [baseline, proposed] = await Promise.all([
      readFile(baselineWorkflowPath, 'utf8'),
      readFile(
        join(labRoot, 'scenarios/matrix-impact/overlay/.github/workflows/app-ci.yml'),
        'utf8'
      )
    ]);
    const comparison = compareWorkflowDocuments(baseline, proposed, 'app-ci.yml');

    expect(comparison.costDelta).toMatchObject({
      direction: 'increase',
      baseHostedRunnerRateUsdPerWorkflowMinute: 0.012,
      headHostedRunnerRateUsdPerWorkflowMinute: 0.372,
      deltaUsdPerWorkflowRuntimeMinute: 0.36,
      percentageChange: 3000
    });
    expect(comparison.introducedFindings.map((finding) => finding.ruleId)).toEqual([
      'expensive-runner',
      'large-matrix'
    ]);
    expect(comparison.triggerConfigurationChanged).toBe(false);
  });

  it('isolates trigger expansion from the static runner rate', async () => {
    const [baseline, proposed] = await Promise.all([
      readFile(baselineWorkflowPath, 'utf8'),
      readFile(
        join(labRoot, 'scenarios/trigger-expansion/overlay/.github/workflows/app-ci.yml'),
        'utf8'
      )
    ]);
    const comparison = compareWorkflowDocuments(baseline, proposed, 'app-ci.yml');

    expect(comparison.costDelta).toMatchObject({
      direction: 'unchanged',
      baseHostedRunnerRateUsdPerWorkflowMinute: 0.012,
      headHostedRunnerRateUsdPerWorkflowMinute: 0.012,
      deltaUsdPerWorkflowRuntimeMinute: 0
    });
    expect(comparison.introducedFindings.map((finding) => finding.ruleId)).toEqual([
      'duplicate-branch-triggers'
    ]);
    expect(comparison.triggerConfigurationChanged).toBe(true);
  });

  it('generates a standalone repository and applies one scenario safely', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'ci-bill-doctor-lab-test-'));
    temporaryRoots.push(temporaryRoot);
    const destination = join(temporaryRoot, 'consumer');
    const actionRef = '0123456789abcdef0123456789abcdef01234567';

    await executeFile(process.execPath, [
      join(labRoot, 'scripts/create-repository.mjs'),
      '--destination',
      destination,
      '--action-repository',
      'example/ci-bill-doctor',
      '--action-ref',
      actionRef
    ]);

    const generatedGuard = await readFile(
      join(destination, '.github/workflows/ci-bill-doctor.yml'),
      'utf8'
    );
    expect(generatedGuard).toContain(
      'uses: example/ci-bill-doctor@' + actionRef
    );
    expect(generatedGuard).not.toContain('__ACTION_');

    await executeFile(process.execPath, [
      join(labRoot, 'scripts/apply-scenario.mjs'),
      '--destination',
      destination,
      '--scenario',
      'matrix-impact'
    ]);

    const [baseline, proposed] = await Promise.all([
      readFile(baselineWorkflowPath, 'utf8'),
      readFile(join(destination, '.github/workflows/app-ci.yml'), 'utf8')
    ]);
    expect(
      compareWorkflowDocuments(baseline, proposed).costDelta
        .headHostedRunnerRateUsdPerWorkflowMinute
    ).toBe(0.372);

    await expect(
      executeFile(process.execPath, [
        join(labRoot, 'scripts/apply-scenario.mjs'),
        '--destination',
        destination,
        '--scenario',
        'matrix-impact'
      ])
    ).rejects.toThrow(/destination differs from baseline/);
  });
});
