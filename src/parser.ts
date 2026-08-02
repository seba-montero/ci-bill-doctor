import { parseDocument } from 'yaml';
import type { WorkflowDocument } from './types.js';

export class WorkflowParseError extends Error {
  readonly source: string;

  constructor(source: string, message: string) {
    super('Unable to parse ' + source + ': ' + message);
    this.name = 'WorkflowParseError';
    this.source = source;
  }
}

export function parseWorkflow(sourceText: string, source = '<inline>'): WorkflowDocument {
  const document = parseDocument(sourceText, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
    version: '1.2'
  });

  if (document.errors.length > 0) {
    throw new WorkflowParseError(
      source,
      document.errors.map((error) => error.message).join('; ')
    );
  }

  const value: unknown = document.toJS();
  if (!isRecord(value)) {
    throw new WorkflowParseError(source, 'the root must be a YAML mapping');
  }

  if (!isRecord(value.jobs)) {
    throw new WorkflowParseError(source, 'the workflow must contain a jobs mapping');
  }

  return value as WorkflowDocument;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
