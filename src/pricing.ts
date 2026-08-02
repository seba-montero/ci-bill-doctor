import rawDefaultCatalog from '../catalog/github-hosted-standard.json' with { type: 'json' };
import { isRecord } from './parser.js';
import type { RunnerFamily } from './types.js';

export interface RunnerFamilyPricing {
  pricePerMinute: number | null;
  labelPatterns: string[];
  notes: string[];
}

export interface PricingCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  currency: 'USD';
  effectiveFrom: string;
  reviewedAt: string;
  sourceUrl: string;
  runnerFamilies: Record<RunnerFamily, RunnerFamilyPricing>;
}

export const DEFAULT_PRICING_CATALOG = validatePricingCatalog(rawDefaultCatalog);
export const PRICING_SNAPSHOT_DATE = DEFAULT_PRICING_CATALOG.reviewedAt;

export const HOSTED_RUNNER_USD_PER_MINUTE: Readonly<Record<'linux' | 'windows' | 'macos', number>> = {
  linux: requiredRate(DEFAULT_PRICING_CATALOG, 'linux'),
  windows: requiredRate(DEFAULT_PRICING_CATALOG, 'windows'),
  macos: requiredRate(DEFAULT_PRICING_CATALOG, 'macos')
};

export function validatePricingCatalog(raw: unknown): PricingCatalog {
  if (!isRecord(raw)) {
    throw new Error('Pricing catalog must be an object.');
  }
  if (raw.schemaVersion !== 1) {
    throw new Error('Unsupported pricing catalog schemaVersion.');
  }
  if (typeof raw.catalogVersion !== 'string' || raw.catalogVersion.length === 0) {
    throw new Error('Pricing catalog requires catalogVersion.');
  }
  if (raw.currency !== 'USD') {
    throw new Error('Only USD pricing catalogs are supported.');
  }
  if (
    typeof raw.effectiveFrom !== 'string'
    || typeof raw.reviewedAt !== 'string'
    || typeof raw.sourceUrl !== 'string'
  ) {
    throw new Error('Pricing catalog dates and sourceUrl must be strings.');
  }
  if (!isIsoDate(raw.effectiveFrom) || !isIsoDate(raw.reviewedAt)) {
    throw new Error('Pricing catalog dates must use YYYY-MM-DD.');
  }
  if (!raw.sourceUrl.startsWith('https://docs.github.com/')) {
    throw new Error('Default pricing source must be an official GitHub documentation URL.');
  }
  if (!isRecord(raw.runnerFamilies)) {
    throw new Error('Pricing catalog requires runnerFamilies.');
  }

  const runnerFamilies = {} as Record<RunnerFamily, RunnerFamilyPricing>;
  for (const family of runnerFamilyOrder()) {
    runnerFamilies[family] = validateRunnerFamily(raw.runnerFamilies[family], family);
  }

  return deepFreeze({
    schemaVersion: 1,
    catalogVersion: raw.catalogVersion,
    currency: 'USD',
    effectiveFrom: raw.effectiveFrom,
    reviewedAt: raw.reviewedAt,
    sourceUrl: raw.sourceUrl,
    runnerFamilies
  });
}

export function runnerRate(
  family: RunnerFamily,
  catalog: PricingCatalog = DEFAULT_PRICING_CATALOG
): number | null {
  return catalog.runnerFamilies[family].pricePerMinute;
}

export function classifyRunner(
  raw: unknown,
  catalog: PricingCatalog = DEFAULT_PRICING_CATALOG
): { label: string; family: RunnerFamily } {
  const labels = Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string')
    : typeof raw === 'string'
      ? [raw]
      : [];

  const label = labels.length > 0 ? labels.join(', ') : '<dynamic or missing>';
  const normalized = labels.map((value) => value.toLowerCase());

  for (const family of runnerFamilyOrder()) {
    if (family === 'unknown') {
      continue;
    }
    const patterns = catalog.runnerFamilies[family].labelPatterns.map(
      (pattern) => new RegExp(pattern, 'i')
    );
    if (normalized.some((candidate) => patterns.some((pattern) => pattern.test(candidate)))) {
      return { label, family };
    }
  }

  return { label, family: 'unknown' };
}

function validateRunnerFamily(raw: unknown, family: RunnerFamily): RunnerFamilyPricing {
  if (!isRecord(raw)) {
    throw new Error('Missing pricing for runner family: ' + family);
  }

  const price = raw.pricePerMinute;
  if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0)) {
    throw new Error('Invalid pricePerMinute for runner family: ' + family);
  }
  if (!isStringArray(raw.labelPatterns) || !isStringArray(raw.notes)) {
    throw new Error('labelPatterns and notes must be string arrays for: ' + family);
  }

  for (const pattern of raw.labelPatterns) {
    try {
      new RegExp(pattern, 'i');
    } catch {
      throw new Error('Invalid runner label pattern for ' + family + ': ' + pattern);
    }
  }

  return {
    pricePerMinute: price,
    labelPatterns: [...raw.labelPatterns],
    notes: [...raw.notes]
  };
}

function requiredRate(
  catalog: PricingCatalog,
  family: 'linux' | 'windows' | 'macos'
): number {
  const rate = catalog.runnerFamilies[family].pricePerMinute;
  if (rate === null) {
    throw new Error('Hosted runner family has no configured price: ' + family);
  }
  return rate;
}

function runnerFamilyOrder(): RunnerFamily[] {
  return ['self-hosted', 'macos', 'windows', 'linux', 'unknown'];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
}

function deepFreeze(catalog: PricingCatalog): PricingCatalog {
  for (const family of runnerFamilyOrder()) {
    Object.freeze(catalog.runnerFamilies[family].labelPatterns);
    Object.freeze(catalog.runnerFamilies[family].notes);
    Object.freeze(catalog.runnerFamilies[family]);
  }
  Object.freeze(catalog.runnerFamilies);
  return Object.freeze(catalog);
}
