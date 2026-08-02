const WORKFLOW_PATH = /^\.github\/workflows\/[^/\r\n]+\.ya?ml$/;

export type WorkflowFileChange =
  | { kind: 'added'; headPath: string }
  | { kind: 'modified'; basePath: string; headPath: string }
  | { kind: 'removed'; basePath: string }
  | { kind: 'irrelevant' };

export interface ChangedFilePath {
  filename: string;
  previous_filename?: string;
  status: string;
}

export function isWorkflowPath(path: string): boolean {
  return WORKFLOW_PATH.test(path);
}

export function classifyWorkflowFileChange(file: ChangedFilePath): WorkflowFileChange {
  const headExists = file.status !== 'removed' && isWorkflowPath(file.filename);
  const baseCandidate = file.status === 'renamed' && file.previous_filename
    ? file.previous_filename
    : file.filename;
  const baseExists = file.status !== 'added'
    && file.status !== 'copied'
    && isWorkflowPath(baseCandidate);

  if (baseExists && headExists) {
    return { kind: 'modified', basePath: baseCandidate, headPath: file.filename };
  }
  if (baseExists) {
    return { kind: 'removed', basePath: baseCandidate };
  }
  if (headExists) {
    return { kind: 'added', headPath: file.filename };
  }
  return { kind: 'irrelevant' };
}
