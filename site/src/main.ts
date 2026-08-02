import '../styles.css';
import {
  PRICING_SNAPSHOT_DATE,
  type AnalysisResult,
  type ComparisonResult,
  type Finding
} from '../../src/browser.js';
import { BASE_EXAMPLE, HEAD_EXAMPLE } from './examples.js';
import { MAX_WORKFLOW_BYTES, analyzeText, compareTexts } from './scanner.js';

type ScannerMode = 'analyze' | 'compare';

const baseEditor = requiredElement<HTMLTextAreaElement>('#base-workflow');
const headEditor = requiredElement<HTMLTextAreaElement>('#head-workflow');
const editorGrid = requiredElement<HTMLElement>('#editor-grid');
const headLabel = requiredElement<HTMLElement>('#head-workflow-label');
const headState = requiredElement<HTMLElement>('#head-workflow-state');
const resultRoot = requiredElement<HTMLElement>('#scan-result');
const runButton = requiredElement<HTMLButtonElement>('#run-scan');
const fileInput = requiredElement<HTMLInputElement>('#workflow-file');
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('.mode-button')];

let scannerMode: ScannerMode = 'compare';

loadExample();
renderCurrentScan();

for (const [index, button] of modeButtons.entries()) {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode;
    if (mode !== 'analyze' && mode !== 'compare') return;
    setMode(mode);
  });

  button.addEventListener('keydown', (event) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % modeButtons.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + modeButtons.length) % modeButtons.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = modeButtons.length - 1;
    }

    if (nextIndex === undefined) return;
    const nextButton = modeButtons[nextIndex];
    const nextMode = nextButton?.dataset.mode;
    if (!nextButton || (nextMode !== 'analyze' && nextMode !== 'compare')) return;

    event.preventDefault();
    setMode(nextMode);
    nextButton.focus();
  });
}

requiredElement<HTMLButtonElement>('#load-example').addEventListener('click', () => {
  loadExample();
  renderCurrentScan();
});

requiredElement<HTMLButtonElement>('#clear-editors').addEventListener('click', () => {
  baseEditor.value = '';
  headEditor.value = '';
  resultRoot.replaceChildren();
  headEditor.focus();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;

  if (file.size > MAX_WORKFLOW_BYTES) {
    renderError('The selected file is larger than the 250 KB browser scanner limit.');
    return;
  }

  try {
    headEditor.value = await file.text();
    renderCurrentScan();
  } catch (error: unknown) {
    renderError(errorMessage(error));
  }
});

runButton.addEventListener('click', () => renderCurrentScan());

requiredElement<HTMLButtonElement>('#copy-install').addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const code = requiredElement<HTMLElement>('#install-code').textContent ?? '';
  try {
    await navigator.clipboard.writeText(code);
    showTemporaryButtonState(button, 'Copied');
  } catch {
    showTemporaryButtonState(button, 'Select manually');
  }
});

function setMode(mode: ScannerMode): void {
  scannerMode = mode;
  const compare = mode === 'compare';
  editorGrid.classList.toggle('compare-mode', compare);
  editorGrid.classList.toggle('single-mode', !compare);
  headLabel.textContent = compare ? 'Proposed workflow' : 'Workflow';
  headState.textContent = compare ? 'After' : 'Current';

  for (const button of modeButtons) {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
    button.tabIndex = active ? 0 : -1;
  }

  resultRoot.replaceChildren();
}

function loadExample(): void {
  baseEditor.value = BASE_EXAMPLE;
  headEditor.value = HEAD_EXAMPLE;
}

function renderCurrentScan(): void {
  runButton.disabled = true;
  runButton.textContent = 'Analyzing…';

  window.setTimeout(() => {
    try {
      if (scannerMode === 'compare') {
        renderComparison(compareTexts(baseEditor.value, headEditor.value));
      } else {
        renderAnalysis(analyzeText(headEditor.value));
      }
    } catch (error: unknown) {
      renderError(errorMessage(error));
    } finally {
      runButton.disabled = false;
      runButton.replaceChildren('Analyze cost signals ', span('→'));
    }
  }, 20);
}

function renderAnalysis(result: AnalysisResult): void {
  const shell = element('div', 'result-shell');
  shell.append(
    resultHeader('WORKFLOW ANALYZED', result.workflowName),
    metrics([
      ['Hosted runner rate', formatRate(result.summary.hostedRunnerRateUsdPerWorkflowMinute), '/min', ''],
      ['Jobs', String(result.summary.jobs), '', ''],
      ['Findings', String(result.findings.length), '', result.findings.some((finding) => finding.severity === 'high') ? 'negative' : '']
    ], 'analysis-metrics'),
    findingsSection('Findings', result.findings),
    resultDisclaimer(),
    resultActions()
  );
  resultRoot.replaceChildren(shell);
}

function renderComparison(result: ComparisonResult): void {
  const delta = result.costDelta;
  const deltaClass = delta.direction === 'increase'
    ? 'negative'
    : delta.direction === 'decrease'
      ? 'positive'
      : '';
  const shell = element('div', 'result-shell');
  shell.append(
    resultHeader('CHANGE COMPARED', result.source),
    metrics([
      ['Base rate', formatRate(delta.baseHostedRunnerRateUsdPerWorkflowMinute), '/min', ''],
      ['Proposed rate', formatRate(delta.headHostedRunnerRateUsdPerWorkflowMinute), '/min', ''],
      ['Delta', formatSignedRate(delta.deltaUsdPerWorkflowRuntimeMinute), '/min', deltaClass],
      ['Change', formatPercentage(delta.percentageChange), '', deltaClass]
    ]),
    findingsSection('Introduced findings', result.introducedFindings)
  );

  if (result.resolvedFindings.length > 0) {
    shell.append(findingsSection('Resolved findings', result.resolvedFindings));
  }

  shell.append(resultDisclaimer(), resultActions());
  resultRoot.replaceChildren(shell);
}

function resultHeader(kicker: string, title: string): HTMLElement {
  const header = element('div', 'result-header');
  const copy = element('div');
  copy.append(element('p', 'result-kicker', kicker), element('h3', '', title));
  header.append(copy, element('span', 'result-state', 'LOCAL RESULT'));
  return header;
}

function metrics(
  items: Array<[label: string, value: string, suffix: string, stateClass: string]>,
  extraClass = ''
): HTMLElement {
  const grid = element('div', ['metric-grid', extraClass].filter(Boolean).join(' '));
  for (const [label, value, suffix, stateClass] of items) {
    const metric = element('div', ['metric', stateClass].filter(Boolean).join(' '));
    metric.append(element('span', 'metric-label', label), element('strong', '', value));
    if (suffix) metric.append(element('small', '', suffix));
    grid.append(metric);
  }
  return grid;
}

function findingsSection(title: string, findings: Finding[]): HTMLElement {
  const section = element('section');
  const sectionTitle = element('div', 'result-section-title');
  sectionTitle.append(element('h4', '', title), element('span', '', String(findings.length)));
  section.append(sectionTitle);

  if (findings.length === 0) {
    section.append(element('div', 'empty-findings', 'No findings in this category.'));
    return section;
  }

  const list = element('div', 'finding-list');
  for (const finding of findings) {
    const card = element('article', 'finding-card severity-' + finding.severity);
    const main = element('div', 'finding-main');
    main.append(
      element('h5', '', finding.title),
      labeledParagraph('Why: ', finding.message),
      labeledParagraph('Evidence: ', finding.evidence),
      labeledParagraph('Recommendation: ', finding.recommendation)
    );
    const metadata = element('div', 'finding-meta');
    metadata.append(
      element('span', '', finding.severity),
      element('span', '', finding.confidence + ' confidence')
    );
    card.append(element('div', 'finding-stripe'), main, metadata);
    list.append(card);
  }
  section.append(list);
  return section;
}

function labeledParagraph(label: string, value: string): HTMLElement {
  const paragraph = element('p');
  paragraph.append(element('b', '', label), document.createTextNode(value));
  return paragraph;
}

function resultDisclaimer(): HTMLElement {
  return element(
    'div',
    'result-note',
    'Gross-equivalent signal using the pricing catalog reviewed ' + PRICING_SNAPSHOT_DATE
      + '. This is not an invoice or monthly forecast; quotas, discounts, duration and frequency are excluded.'
  );
}

function resultActions(): HTMLElement {
  const actions = element('div', 'result-actions');
  actions.append(
    externalLink(
      'Install this check →',
      'https://github.com/marketplace/actions/ci-bill-doctor'
    ),
    externalLink(
      'Share sanitized feedback ↗',
      'https://github.com/seba-montero/ci-bill-doctor/issues/new?template=result-feedback.yml'
    )
  );
  return actions;
}

function externalLink(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'result-link';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = label;
  return link;
}

function renderError(message: string): void {
  const error = element('div', 'error-result');
  const copy = element('div');
  copy.append(element('h3', '', 'Unable to analyze this workflow'), element('p', '', message));
  error.append(element('span', 'error-icon', '!'), copy);
  resultRoot.replaceChildren(error);
}

function formatRate(value: number | null): string {
  return value === null ? 'unknown' : '$' + value.toFixed(4);
}

function formatSignedRate(value: number | null): string {
  if (value === null) return 'unknown';
  return (value > 0 ? '+' : '') + '$' + value.toFixed(4);
}

function formatPercentage(value: number | null): string {
  if (value === null) return 'unknown';
  return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function span(text: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.setAttribute('aria-hidden', 'true');
  node.textContent = text;
  return node;
}

function requiredElement<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error('Missing required page element: ' + selector);
  return node;
}

function showTemporaryButtonState(button: HTMLButtonElement, label: string): void {
  const previous = button.textContent ?? 'Copy';
  button.textContent = label;
  window.setTimeout(() => {
    button.textContent = previous;
  }, 1_800);
}
