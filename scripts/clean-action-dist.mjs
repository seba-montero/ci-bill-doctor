import { rm } from 'node:fs/promises';

const actionBundle = new URL('../dist/action', import.meta.url);
await rm(actionBundle, { recursive: true, force: true });
