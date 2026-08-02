#!/usr/bin/env node

import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const labRoot = fileURLToPath(new URL('../', import.meta.url));
const templateRoot = resolve(labRoot, 'template');
const manifestPath = resolve(labRoot, 'scenarios/manifest.json');

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write('Unable to apply lab scenario: ' + message + '\n');
  process.exitCode = 1;
});

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.destination || !options.scenario) {
    throw new Error('--destination and --scenario are required. Use --help for examples.');
  }

  const destination = resolve(options.destination);
  await validateGeneratedDestination(destination);

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.scenarios)) {
    throw new Error('unsupported scenario manifest');
  }
  const scenario = manifest.scenarios.find((candidate) => candidate.id === options.scenario);
  if (!scenario || typeof scenario.overlay !== 'string') {
    throw new Error('unknown scenario: ' + options.scenario);
  }

  const overlayRoot = resolve(labRoot, 'scenarios', scenario.overlay);
  const overlayFiles = await listFiles(overlayRoot);
  if (overlayFiles.length === 0) {
    throw new Error('scenario overlay is empty: ' + options.scenario);
  }

  for (const sourcePath of overlayFiles) {
    const relativePath = relative(overlayRoot, sourcePath);
    const targetPath = resolve(destination, relativePath);
    const baselinePath = resolve(templateRoot, relativePath);

    if (await pathExists(targetPath)) {
      if (!await pathExists(baselinePath)) {
        throw new Error('refusing to overwrite non-baseline file: ' + relativePath);
      }
      const [current, baseline] = await Promise.all([
        readFile(targetPath),
        readFile(baselinePath)
      ]);
      if (!current.equals(baseline)) {
        throw new Error('destination differs from baseline: ' + relativePath);
      }
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }

  process.stdout.write(
    'Applied scenario ' + options.scenario + ':\n'
      + overlayFiles
        .map((path) => '  - ' + relative(overlayRoot, path))
        .join('\n')
      + '\nReview the diff, commit it on a dedicated branch, and open a pull request.\n'
  );
}
function parseArguments(argumentsList) {
  const options = { destination: '', scenario: '', help: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('missing value for ' + argument);
    }
    if (argument === '--destination') {
      options.destination = value;
    } else if (argument === '--scenario') {
      options.scenario = value;
    } else {
      throw new Error('unknown argument: ' + argument);
    }
    index += 1;
  }
  return options;
}

async function validateGeneratedDestination(destination) {
  const markerPath = resolve(destination, '.ci-bill-doctor-lab.json');
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    throw new Error('destination is not a generated CI Bill Doctor lab: ' + destination);
  }
  if (
    !marker
    || marker.schemaVersion !== 1
    || marker.template !== 'ci-bill-doctor-consumer-lab'
  ) {
    throw new Error('destination has an unsupported lab marker');
  }
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function printHelp() {
  process.stdout.write(`Apply one controlled change to a generated lab repository.

Usage:
  node lab/scripts/apply-scenario.mjs \\
    --destination /path/to/ci-bill-doctor-lab \\
    --scenario matrix-impact

Scenarios: normal-pr, matrix-impact, trigger-expansion.
The command performs no Git or network operations.
`);
}
