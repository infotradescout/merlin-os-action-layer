import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculateFreshnessScore } from '../src/freshness.ts';

test('freshness score starts at default base for fresh signal observations', () => {
  const observedAt = '2026-05-24T00:00:00.000Z';
  const now = Date.parse(observedAt);
  const result = calculateFreshnessScore(observedAt, {
    nowMs: now
  });

  assert.equal(result.ageHours, 0);
  assert.equal(result.score, 0.9);
  assert.equal(result.tier, 'fresh');
});

test('freshness score decays with event age', () => {
  const observedAt = '2026-05-24T00:00:00.000Z';
  const now = Date.parse('2026-05-25T00:00:00.000Z');
  const result = calculateFreshnessScore(observedAt, {
    nowMs: now,
    decayHours: 24
  });

  assert.equal(result.ageHours, 24);
  assert.equal(result.score < 0.9, true);
  assert.equal(result.tier === 'aging' || result.tier === 'stale', true);
});

test('freshness applies trust and minimum score floor', () => {
  const observedAt = '2026-05-24T00:00:00.000Z';
  const now = Date.parse('2026-05-30T00:00:00.000Z');
  const result = calculateFreshnessScore(observedAt, {
    nowMs: now,
    trustLevel: 0.4,
    decayHours: 12,
    minimumScore: 0.15
  });

  assert.equal(result.score >= 0.15, true);
  assert.equal(result.score < 0.9, true);
  assert.equal(result.tier === 'stale' || result.tier === 'aging', true);
});

