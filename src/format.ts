import type {
  AnalysisResult,
  ComparisonResult,
  Finding,
  MonthlyProjection,
  ProjectionMonthlyScenarios,
  Severity
} from './types.js';

export function formatAnalysisMarkdown(result: AnalysisResult): string {
  const lines: string[] = [
    '# CI Bill Doctor',
    '',
    '**Workflow:** ' + inline(result.workflowName),
    '',
    formatCostSignal(result),
    '',
    '## Findings',
    ''
  ];

  if (result.findings.length === 0) {
    lines.push('No cost-risk rules fired.');
  } else {
    lines.push(...formatFindings(result.findings));
  }

  lines.push('', formatAssumptions(result.assumptions));
  return lines.join('\n');
}

export function formatComparisonMarkdown(result: ComparisonResult): string {
  const delta = result.costDelta;
  const lines: string[] = [
    '# CI Bill Doctor',
    '',
    '**Workflow:** ' + inline(result.source),
    '',
    '## Pull-request cost signal',
    '',
    '| Base | Head | Delta | Direction |',
    '|---:|---:|---:|:---|',
    '| ' + formatRate(delta.baseHostedRunnerRateUsdPerWorkflowMinute)
      + ' | ' + formatRate(delta.headHostedRunnerRateUsdPerWorkflowMinute)
      + ' | ' + formatDelta(delta.deltaUsdPerWorkflowRuntimeMinute)
      + ' | ' + delta.direction + ' |',
    '',
    'This is the summed hosted-runner rate for one minute of every statically expanded job, not a monthly bill.'
  ];

  if (result.monthlyProjection) {
    lines.push('', ...formatMonthlyProjection(result.monthlyProjection));
  } else if (result.historyCollection?.status === 'unavailable') {
    lines.push(
      '',
      '## Experimental monthly projection',
      '',
      'History was requested but is unavailable: '
        + inline(result.historyCollection.reason)
        + ' Static analysis remains available.'
    );
  }

  lines.push('', '## Introduced findings', '');
  if (result.introducedFindings.length === 0) {
    lines.push('No new rule violations.');
  } else {
    lines.push(...formatFindings(result.introducedFindings));
  }

  lines.push('', '## Resolved findings', '');
  if (result.resolvedFindings.length === 0) {
    lines.push('No findings resolved.');
  } else {
    lines.push(...formatFindings(result.resolvedFindings));
  }

  lines.push('', formatAssumptions(result.assumptions));
  return lines.join('\n');
}

function formatMonthlyProjection(projection: MonthlyProjection): string[] {
  const history = projection.history;
  const lines: string[] = [
    '## Experimental monthly projection',
    '',
    '**Confidence:** ' + projection.confidence
      + '; **sample coverage:** ' + history.validRuns + '/' + history.sampledRuns
      + ' runs; **completed runs created in window:** ' + history.totalCompletedRuns
      + '; **window:** ' + history.windowDays + ' days; **sampling:** '
      + history.samplingStrategy + '.',
    '',
    'Observed frequency: '
      + (projection.monthlyRunFrequency === null
        ? 'unknown'
        : projection.monthlyRunFrequency.toFixed(2) + ' runs/month')
      + '; static head/base rate ratio: '
      + (projection.staticRateRatio === null
        ? 'unknown'
        : projection.staticRateRatio.toFixed(3) + '×')
      + '.',
    'Observed fully priced run cost: mean '
      + formatUsd(projection.observedRunCost.meanUsd)
      + '; p50 ' + formatUsd(projection.observedRunCost.p50Usd)
      + '; p95 ' + formatUsd(projection.observedRunCost.p95Usd) + '.',
    ''
  ];

  if (hasMonthlyScenarios(projection.baseMonthlyCost)) {
    lines.push(
      '| Scenario | Expected/month | At run p50 | At run p95 |',
      '|:---|---:|---:|---:|',
      '| Historical base | ' + formatUsd(projection.baseMonthlyCost.expectedUsd)
        + ' | ' + formatUsd(projection.baseMonthlyCost.atRunP50Usd)
        + ' | ' + formatUsd(projection.baseMonthlyCost.atRunP95Usd) + ' |',
      '| Proposed structure | ' + formatUsd(projection.proposedMonthlyCost.expectedUsd)
        + ' | ' + formatUsd(projection.proposedMonthlyCost.atRunP50Usd)
        + ' | ' + formatUsd(projection.proposedMonthlyCost.atRunP95Usd) + ' |',
      '| Estimated delta | ' + formatSignedUsd(projection.monthlyDelta.expectedUsd)
        + ' | ' + formatSignedUsd(projection.monthlyDelta.atRunP50Usd)
        + ' | ' + formatSignedUsd(projection.monthlyDelta.atRunP95Usd) + ' |'
    );
    if (!hasMonthlyScenarios(projection.proposedMonthlyCost)) {
      lines.push(
        '',
        'The historical baseline is available, but the proposed monthly scenario is not because the static comparison is incomplete.'
      );
    }
  } else {
    lines.push(
      'Monthly baseline unavailable because the historical sample is incomplete.'
    );
  }

  lines.push(
    '',
    'This is a gross-equivalent scenario at catalog list rates, not a bill, budget guarantee or confidence interval. At-run p50/p95 columns are sensitivity scenarios, not monthly aggregate percentiles.'
  );

  const diagnosticMessages = [...new Set(
    projection.diagnostics.map((diagnostic) => diagnostic.message)
  )];
  lines.push(
    '',
    '<details>',
    '<summary>Projection diagnostics and assumptions</summary>',
    '',
    ...diagnosticMessages.map((message) => '- ' + inline(message)),
    ...projection.assumptions.map((assumption) => '- ' + inline(assumption)),
    '',
    '</details>'
  );

  return lines;
}

export function formatFindingSummary(findings: Finding[]): string {
  if (findings.length === 0) {
    return 'No findings';
  }

  const counts = new Map<Severity, number>([
    ['high', 0],
    ['medium', 0],
    ['low', 0],
    ['info', 0]
  ]);

  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }

  return ['high', 'medium', 'low', 'info']
    .map((severity) => severity + ': ' + counts.get(severity as Severity))
    .join(', ');
}

function formatCostSignal(result: AnalysisResult): string {
  const rate = result.summary.hostedRunnerRateUsdPerWorkflowMinute;
  if (rate === null) {
    return [
      '## Cost signal',
      '',
      'A complete rate could not be calculated because '
        + result.summary.unknownPriceJobs
        + ' job(s) use dynamic, self-hosted or unknown runners/matrices.'
    ].join('\n');
  }

  return [
    '## Cost signal',
    '',
    '**Hosted-runner rate per workflow runtime minute:** ' + formatRate(rate),
    '',
    'This is a comparison signal, not a monthly forecast.'
  ].join('\n');
}

function formatFindings(findings: Finding[]): string[] {
  const lines: string[] = [];
  for (const finding of findings) {
    lines.push(
      '### ' + severityIcon(finding.severity) + ' ' + inline(finding.title),
      '',
      '- **Severity:** ' + finding.severity + '; **confidence:** ' + finding.confidence + '.',
      '- **Why:** ' + inline(finding.message),
      '- **Evidence:** ' + inline(finding.evidence),
      '- **Recommendation:** ' + inline(finding.recommendation),
      ''
    );
  }
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function formatAssumptions(assumptions: string[]): string {
  return [
    '<details>',
    '<summary>Assumptions and limitations</summary>',
    '',
    ...assumptions.map((assumption) => '- ' + inline(assumption)),
    '',
    '</details>'
  ].join('\n');
}

function formatRate(rate: number | null): string {
  return rate === null ? 'unknown' : '$' + rate.toFixed(4) + '/min';
}

function formatDelta(delta: number | null): string {
  if (delta === null) {
    return 'unknown';
  }
  const sign = delta > 0 ? '+' : '';
  return sign + '$' + delta.toFixed(4) + '/min';
}

function hasMonthlyScenarios(range: ProjectionMonthlyScenarios): boolean {
  return range.expectedUsd !== null
    && range.atRunP50Usd !== null
    && range.atRunP95Usd !== null;
}

function formatUsd(value: number | null): string {
  return value === null ? 'unknown' : '$' + value.toFixed(2);
}

function formatSignedUsd(value: number | null): string {
  if (value === null) {
    return 'unknown';
  }
  const sign = value > 0 ? '+' : '';
  return sign + '$' + value.toFixed(2);
}

function severityIcon(severity: Severity): string {
  if (severity === 'high') return '🔴';
  if (severity === 'medium') return '🟠';
  if (severity === 'low') return '🟡';
  return '🔵';
}

function inline(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_\[\]{}()#!|+~\-])/g, '\\$1')
    .replace(/(https?):\/\//gi, '$1:\u200b//')
    .replace(/\bwww\./gi, 'www.\u200b')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '@\u200b')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}
