import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  buildRoundTableDiscordPayload,
  validateDiscordDeliveryEligibility
} = await import('../src/roundtableDiscord.ts');

const approvedRequest = {
  audience: 'human_knights' as const,
  title: 'RoundTable alignment correction: AutoBott spelling',
  body: 'Rename the Lancelot Project from Autobott to AutoBott. Do not create a duplicate.',
  source: 'roundtable' as const,
  sourceRefs: ['roundtable:knight-clean-slate-protocol', 'project:AutoBott'],
  authority: {
    routedBy: 'RoundTable' as const,
    governedBy: 'Albion/AI Council' as const,
    approvalStatus: 'approved' as const,
    requiresHumanReview: false,
    approvedBy: 'Thomas/Gawain',
    verifiedApprovalRecordId: 'merlin-approval-record:discord-dispatch-001',
    escalationPath: ['RoundTable', 'Merlin', 'Albion/AI Council', 'Human Knights']
  }
};

test('Discord payload carries Merlin routing and Albion authority context', () => {
  const payload = buildRoundTableDiscordPayload(approvedRequest);

  assert.equal(payload.username, 'Merlin x Albion');
  assert.equal(payload.allowed_mentions.parse.length, 0);
  assert.equal(payload.content.includes('Human Knights'), true);
  const fields = payload.embeds[0].fields;
  assert.equal(fields.some((field) => field.name === 'Routed by' && field.value === 'RoundTable'), true);
  assert.equal(fields.some((field) => field.name === 'Delivery owner' && field.value === 'Merlin'), true);
  assert.equal(fields.some((field) => field.name === 'Governed by' && field.value === 'Albion/AI Council'), true);
  assert.equal(
    fields.some(
      (field) =>
        field.name === 'Verified approval record' &&
        field.value === 'merlin-approval-record:discord-dispatch-001'
    ),
    true
  );
  assert.equal(payload.embeds[0].footer.text.includes('Discord is transport only'), true);
});

test('unapproved packets are ineligible for delivery', () => {
  const result = validateDiscordDeliveryEligibility({
    ...approvedRequest,
    authority: {
      ...approvedRequest.authority,
      approvalStatus: 'needs_review',
      approvedBy: undefined,
      verifiedApprovalRecordId: undefined
    }
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'discord_delivery_requires_approved_packet');
  assert.equal(result.payloadPreview.embeds[0].fields.some((field) => field.value === 'needs_review'), true);
});

test('approved packets still require a verified approval record', () => {
  const result = validateDiscordDeliveryEligibility({
    ...approvedRequest,
    authority: {
      ...approvedRequest.authority,
      verifiedApprovalRecordId: undefined
    }
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'discord_delivery_requires_verified_approval_record');
  assert.equal(result.detail.includes('approvalStatus and approvedBy are not sufficient'), true);
});

test('verified approved packet is eligible without network dispatch', () => {
  let networkCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    networkCalled = true;
    throw new Error('RoundTable contract tests must not dispatch network requests');
  }) as typeof fetch;

  try {
    const result = validateDiscordDeliveryEligibility(approvedRequest);

    assert.equal(result.eligible, true);
    assert.equal(networkCalled, false);
    assert.equal(result.payloadPreview.embeds[0].fields.some((field) => field.name === 'Source refs'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
