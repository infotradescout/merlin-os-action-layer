import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAccountIntakePacketFromThread, inferMerlinThreadIntent } from '../src/merlin/threadIntentRuntime.ts';
import { buildUniversalProductUpdatePacketPreview } from '../src/merlin/intake/universalProductUpdatePacketPreview.ts';

test('thread intent inference picks account intake review for account-first language', () => {
  const inferred = inferMerlinThreadIntent({
    messageText: 'Process accounts first. Skip logos and menus. Review business facts and contact info only.',
    files: [
      {
        fileId: 'acct-1',
        fileName: 'account.pdf',
        mimeType: 'application/pdf',
        extractedText: 'Sweet Heat Tacos\nFood Truck\nhello@sweetheat.example'
      }
    ]
  });

  assert.equal(inferred.brand, 'MEALSCOUT');
  assert.equal(inferred.actionId, 'account_intake_review');
  assert.equal(inferred.actorScope, 'staff');
  assert.equal(inferred.reasons.includes('account_first_language_detected'), true);
});

test('thread account parser builds a read-only account_intake packet from extracted text', () => {
  const packet = buildAccountIntakePacketFromThread({
    files: [
      {
        fileId: 'acct-1',
        fileName: 'sweet-heat-account.pdf',
        mimeType: 'application/pdf',
        extractedText: [
          'Sweet Heat Tacos',
          'Food Truck',
          '123 Canal St',
          'New Orleans, LA 70112',
          'Phone: 504-555-0123',
          'Email: hello@sweetheat.example',
          'Website: https://sweetheat.example',
          'Service Area: New Orleans Metro'
        ].join('\n')
      }
    ],
    actorScope: 'staff'
  });

  const preview = buildUniversalProductUpdatePacketPreview(packet);
  assert.equal(preview.status, 'supported');
  if (preview.status !== 'supported') return;
  assert.equal(preview.updateType, 'account_intake');
  assert.equal((preview.extractedStructuredData as { accountIntake: { businessName: string } }).accountIntake.businessName, 'Sweet Heat Tacos');
  assert.equal(preview.applyEligible, false);
});
