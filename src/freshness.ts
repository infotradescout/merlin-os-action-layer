type FreshnessTier = 'fresh' | 'aging' | 'stale';

export interface FreshnessOptions {
  nowMs?: number;
  baseScore?: number;
  trustLevel?: number;
  decayHours?: number;
  minimumScore?: number;
}

export interface FreshnessResult {
  score: number;
  ageHours: number;
  tier: FreshnessTier;
}

const DEFAULT_FRESHNESS_BASE_SCORE = 0.9;
const DEFAULT_TRUST_LEVEL = 1;
const DEFAULT_DECAY_HOURS = 72;
const DEFAULT_MIN_SCORE = 0;
const MS_PER_HOUR = 1000 * 60 * 60;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseObservedTime(observedAt: string, fallback = Date.now()): number {
  const parsed = new Date(observedAt).getTime();
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

export function getFreshnessAgeHours(observedAt: string, nowMs = Date.now()): number {
  const ageMs = Math.max(0, nowMs - parseObservedTime(observedAt, nowMs));
  return ageMs / MS_PER_HOUR;
}

function classifyFreshnessTier(score: number): FreshnessTier {
  if (score >= 0.72) return 'fresh';
  if (score >= 0.35) return 'aging';
  return 'stale';
}

export function calculateFreshnessScore(
  observedAt: string,
  options: FreshnessOptions = {}
): FreshnessResult {
  const nowMs = options.nowMs ?? Date.now();
  const ageHours = getFreshnessAgeHours(observedAt, nowMs);
  const base = clamp01(options.baseScore ?? DEFAULT_FRESHNESS_BASE_SCORE);
  const trust = clamp01(options.trustLevel ?? DEFAULT_TRUST_LEVEL);
  const decayHours = Math.max(1, options.decayHours ?? DEFAULT_DECAY_HOURS);
  const minimum = clamp01(options.minimumScore ?? DEFAULT_MIN_SCORE);

  const decayMultiplier = 1 / (1 + ageHours / decayHours);
  const score = clamp01(Math.max(minimum, base * decayMultiplier * trust));
  return {
    ageHours,
    score,
    tier: classifyFreshnessTier(score)
  };
}
