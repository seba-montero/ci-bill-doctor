#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeWorkflow } from './analyzer.js';
import { compareWorkflowDocuments } from './compare.js';
import { formatAnalysisMarkdown, formatComparisonMarkdown } from './format.js';
import { parseWorkflow } from './parser.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = removeFlag(args, '--json');
  const command = args.shift();

  if (command === 'analyze' && args.length === 1) {
    const file = resolve(args[0] ?? '');
    const sourceText = await readFile(file, 'utf8');
    const result = analyzeWorkflow(parseWorkflow(sourceText, file), file);
    process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : formatAnalysisMarkdown(result) + '\n');
    return;
  }

  if (command === 'compare' && args.length === 2) {
    const baseFile = resolve(args[0] ?? '');
    const headFile = resolve(args[1] ?? '');
    const [baseText, headText] = await Promise.all([
      readFile(baseFile, 'utf8'),
      readFile(headFile, 'utf8')
    ]);
    const result = compareWorkflowDocuments(baseText, headText, headFile);
    process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : formatComparisonMarkdown(result) + '\n');
    return;
  }

  process.stderr.write([
    'CI Bill Doctor',
    '',
    'Usage:',
    '  ci-bill-doctor analyze <workflow.yml> [--json]',
    '  ci-bill-doctor compare <base.yml> <head.yml> [--json]',
    ''
  ].join('\n'));
  process.exitCode = 2;
}

function removeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write('ci-bill-doctor: ' + message + '\n');
  process.exitCode = 1;
});
