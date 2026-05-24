import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  getRegisteredSources,
  registerSource,
  resolveSource,
  resetSourceRegistryForTest
} from '../src/sourceRegistry.ts';

beforeEach(() => {
  resetSourceRegistryForTest();
});

test('source registry includes TradeScout defaults', () => {
  const sources = getRegisteredSources();
  const tradeScout = sources.find((source) => source.id === 'tradescout');
  assert.ok(tradeScout);
  assert.equal(tradeScout?.name, 'TradeScout');
});

test('source registry resolves known aliases and reference formats', () => {
  registerSource({
    id: 'partner-alpha',
    name: 'Partner Alpha',
    type: 'app',
    trustLevel: 0.85,
    active: true,
    aliases: ['partner-alpha', 'partner_alpha', 'alpha']
  });

  const fromReference = resolveSource({
    sourceReference: 'alpha:business_001',
    entityId: 'business_001'
  });
  assert.equal(fromReference.id, 'partner-alpha');
  assert.equal(fromReference.reference, 'alpha:business_001');
  assert.equal(fromReference.type, 'app');

  const fromFallback = resolveSource({
    originSurface: 'partner-alpha',
    entityId: 'business_002'
  });
  assert.equal(fromFallback.id, 'partner-alpha');
  assert.equal(fromFallback.reference, 'partner-alpha:business_002');
});

test('source registry falls back to TradeScout for unknown sources', () => {
  const resolved = resolveSource({
    sourceReference: 'mystery-source:entity-1',
    entityId: 'entity-1'
  });
  assert.equal(resolved.id, 'tradescout');
  assert.equal(resolved.reference, 'mystery-source:entity-1');
  assert.equal(resolved.name, 'TradeScout');
});

