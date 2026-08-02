import {
  analyzeWorkflowText,
  compareWorkflowDocuments,
  type AnalysisResult,
  type ComparisonResult
} from '../../src/browser.js';

export const MAX_WORKFLOW_BYTES = 250 * 1024;

export class ScannerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScannerInputError';
  }
}

export function analyzeText(sourceText: string): AnalysisResult {
  validateSource(sourceText, 'Workflow');
  return analyzeWorkflowText(sourceText, 'pasted workflow');
}

export function compareTexts(baseText: string, headText: string): ComparisonResult {
  validateSource(baseText, 'Base workflow');
  validateSource(headText, 'Proposed workflow');
  return compareWorkflowDocuments(baseText, headText, 'pasted workflow change');
}

export function sourceSizeBytes(sourceText: string): number {
  return new TextEncoder().encode(sourceText).byteLength;
}

function validateSource(sourceText: string, label: string): void {
  if (sourceText.trim().length === 0) {
    throw new ScannerInputError(label + ' is empty. Paste or open a .yml/.yaml file first.');
  }

  const bytes = sourceSizeBytes(sourceText);
  if (bytes > MAX_WORKFLOW_BYTES) {
    throw new ScannerInputError(
      label + ' is ' + formatBytes(bytes) + '; the browser scanner limit is 250 KB.'
    );
  }
}

function formatBytes(bytes: number): string {
  return (bytes / 1024).toFixed(1) + ' KB';
}
