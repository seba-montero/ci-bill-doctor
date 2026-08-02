import { describe, expect, it } from 'vitest';
import {
  classifyWorkflowFileChange,
  isWorkflowPath
} from '../src/workflow-path.js';

describe('workflow file path classification', () => {
  it('accepts only files directly under .github/workflows', () => {
    expect(isWorkflowPath('.github/workflows/ci.yml')).toBe(true);
    expect(isWorkflowPath('.github/workflows/release.yaml')).toBe(true);
    expect(isWorkflowPath('.github/workflows/archive/ci.yml')).toBe(false);
    expect(isWorkflowPath('workflows/ci.yml')).toBe(false);
    expect(isWorkflowPath('.GITHUB/WORKFLOWS/ci.yml')).toBe(false);
    expect(isWorkflowPath('.github/workflows/CI.YML')).toBe(false);
    expect(isWorkflowPath('.github/workflows/ci.yml\n')).toBe(false);
  });

  it('treats a rename from the workflow root into a subdirectory as removal', () => {
    expect(classifyWorkflowFileChange({
      status: 'renamed',
      filename: '.github/workflows/archive/ci.yml',
      previous_filename: '.github/workflows/ci.yml'
    })).toEqual({ kind: 'removed', basePath: '.github/workflows/ci.yml' });
  });

  it('treats a rename from a subdirectory into the workflow root as addition', () => {
    expect(classifyWorkflowFileChange({
      status: 'renamed',
      filename: '.github/workflows/ci.yml',
      previous_filename: '.github/workflows/archive/ci.yml'
    })).toEqual({ kind: 'added', headPath: '.github/workflows/ci.yml' });
  });

  it('preserves both paths for a real workflow rename', () => {
    expect(classifyWorkflowFileChange({
      status: 'renamed',
      filename: '.github/workflows/build.yml',
      previous_filename: '.github/workflows/ci.yml'
    })).toEqual({
      kind: 'modified',
      basePath: '.github/workflows/ci.yml',
      headPath: '.github/workflows/build.yml'
    });
  });
});
