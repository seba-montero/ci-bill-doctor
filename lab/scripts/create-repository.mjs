#!/usr/bin/env node

import { access, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTION_REPOSITORY_PLACEHOLDER = '__ACTION_REPOSITORY__';
const ACTION_REF_PLACEHOLDER = '__ACTION_REF__';
const templateRoot = fileURLToPath(new URL('../template/', import.meta.url));

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write('Unable to create lab repository: ' + message + '\n');
  process.exitCode = 1;
});

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!options.destination || !options.actionRepository || !options.actionRef) {
    throw new Error(
      '--destination, --action-repository and --action-ref are required. Use --help for examples.'
    );
  }

  validateActionRepository(options.actionRepository);
  validateActionRef(options.actionRef);

  const destination = resolve(options.destination);
  if (await pathExists(destination)) {
    throw new Error('destination already exists: ' + destination);
  }

  await cp(templateRoot, destination, {
    recursive: true,
    errorOnExist: true,
    force: false
  });

  const guardPath = resolve(destination, '.github/workflows/ci-bill-doctor.yml');
  const template = await readFile(guardPath, 'utf8');
  const rendered = template
    .replaceAll(ACTION_REPOSITORY_PLACEHOLDER, options.actionRepository)
    .replaceAll(ACTION_REF_PLACEHOLDER, options.actionRef);

  if (
    rendered.includes(ACTION_REPOSITORY_PLACEHOLDER)
    || rendered.includes(ACTION_REF_PLACEHOLDER)
  ) {
    throw new Error('the generated workflow still contains unresolved placeholders');
  }
  await writeFile(guardPath, rendered, 'utf8');

  const marker = {
    schemaVersion: 1,
    template: 'ci-bill-doctor-consumer-lab',
    actionRepository: options.actionRepository,
    actionRef: options.actionRef
  };
  await writeFile(
    resolve(destination, '.ci-bill-doctor-lab.json'),
    JSON.stringify(marker, null, 2) + '\n',
    'utf8'
  );

  process.stdout.write(
    'Created CI Bill Doctor lab at ' + destination + '\n'
      + 'Action: ' + options.actionRepository + '@' + options.actionRef + '\n'
      + 'Next: initialize Git, commit the baseline, and publish it explicitly when ready.\n'
  );
}
function parseArguments(argumentsList) {
  const options = {
    destination: '',
    actionRepository: '',
    actionRef: '',
    help: false
  };

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
    } else if (argument === '--action-repository') {
      options.actionRepository = value;
    } else if (argument === '--action-ref') {
      options.actionRef = value;
    } else {
      throw new Error('unknown argument: ' + argument);
    }
    index += 1;
  }

  return options;
}

function validateActionRepository(repository) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error('action repository must use the form OWNER/REPOSITORY');
  }
}

function validateActionRef(ref) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref)
    || ref.endsWith('/')
    || ref.includes('..')
    || ref.includes('//')
  ) {
    throw new Error('action ref contains unsupported characters');
  }
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
  process.stdout.write(`Create a standalone CI Bill Doctor consumer lab.

Usage:
  node lab/scripts/create-repository.mjs \\
    --destination /path/to/ci-bill-doctor-lab \\
    --action-repository OWNER/ci-bill-doctor \\
    --action-ref COMMIT_SHA

The destination must not exist. The command performs no Git or network operations.
`);
}
