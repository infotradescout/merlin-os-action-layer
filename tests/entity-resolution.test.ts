import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  resolveAndTrackEntity,
  resetEntityResolutionForTest
} from '../src/entityResolution.ts';

beforeEach(() => {
  resetEntityResolutionForTest();
});

test('same entity_id returns canonical', () => {
  const first = resolveAndTrackEntity({
    entity_id: 'business_001'
  });

  const second = resolveAndTrackEntity({
    entity_id: 'business_001'
  });

  assert.equal(first.canonical_entity_id, 'business_001');
  assert.equal(second.canonical_entity_id, 'business_001');
  assert.equal(second.confidence, 'high');
});

test('same business/identity alias matches prior entity', () => {
  resolveAndTrackEntity({
    entity_id: 'business_canonical',
    aliases: ['Acme-Edge', 'Acme Contractor LLC']
  });

  const resolved = resolveAndTrackEntity({
    entity_id: 'Acme Contractor LLC'
  });

  assert.equal(resolved.canonical_entity_id, 'business_canonical');
  assert.equal(resolved.matchType, 'exact');
  assert.equal(resolved.confidence, 'high');
});

test('same normalized business name + location resolves to canonical', () => {
  const first = resolveAndTrackEntity({
    entity_id: 'business_abc_1',
    business_name: 'ABC Roofing LLC',
    location: 'Austin, TX'
  });

  const second = resolveAndTrackEntity({
    entity_id: 'business_abc_2',
    business_name: 'A.B.C. Roofing',
    location: 'austin tx'
  });

  assert.equal(first.canonical_entity_id, 'business_abc_1');
  assert.equal(second.canonical_entity_id, 'business_abc_1');
  assert.equal(second.matchType, 'name_location');
  assert.equal(second.confidence, 'medium');
});

test('phone / email / domain matches resolve to same canonical entity', () => {
  const first = resolveAndTrackEntity({
    entity_id: 'business_signal',
    business_name: 'Signal Works',
    phone: '(555) 321-0001'
  });

  const byPhone = resolveAndTrackEntity({
    entity_id: 'business_signal_alias',
    phone: '5553210001'
  });
  assert.equal(byPhone.canonical_entity_id, first.canonical_entity_id);
  assert.equal(byPhone.matchType, 'phone');
  assert.equal(byPhone.confidence, 'high');

  const emailSeed = resolveAndTrackEntity({
    entity_id: 'business_signal_email',
    email: 'Ops@SignalWorks.Com',
    phone: '5550000000'
  });
  const byEmail = resolveAndTrackEntity({
    entity_id: 'business_signal_email_alias',
    email: 'ops@signalworks.com'
  });
  assert.equal(emailSeed.canonical_entity_id, 'business_signal_email');
  assert.equal(byEmail.canonical_entity_id, 'business_signal_email');

  const domainSeed = resolveAndTrackEntity({
    entity_id: 'business_signal_domain',
    domain: 'https://signalworks.com/profile'
  });
  const byDomain = resolveAndTrackEntity({
    entity_id: 'business_signal_domain_alias',
    domain: 'signalworks.com'
  });
  assert.equal(domainSeed.canonical_entity_id, 'business_signal_domain');
  assert.equal(byDomain.canonical_entity_id, 'business_signal_domain');
});

test('different businesses do not merge when identity differs', () => {
  resolveAndTrackEntity({
    entity_id: 'business_a',
    business_name: 'Northside Plumbing',
    location: 'Austin, TX'
  });

  const second = resolveAndTrackEntity({
    entity_id: 'business_b',
    business_name: 'Northside Plumb',
    location: 'Austin, TX'
  });

  assert.equal(second.canonical_entity_id, 'business_b');
  assert.equal(second.matchType, 'none');
});
