import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUniversalProductUpdatePacket } from '../src/merlin/intake/universalProductUpdatePacket.ts';

test('builds a MealScout schedule proof packet with explicit timezone and current-week schedule evidence', () => {
  const sourceFolderReference = 'drive://mealscout/sweet-love/evidence-folder';
  const packet = createUniversalProductUpdatePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test',
      actorLabel: 'Sweet Love Owner'
    },
    targetProduct: 'MealScout',
    targetBusinessName: 'Sweet Love',
    targetProfileId: 'ms-test-sweet-love-profile',
    updateType: 'schedule_update',
    confidence: 0.88,
    evidenceReferences: [
      {
        sourceFileName: 'sweet-love-schedule.png',
        sourceMimeType: 'image/png',
        sourceReference: 'drive://sweet-love-schedule',
        sourceFolderReference
      }
    ],
    scheduleEntries: [
      {
        date: '2026-06-20',
        startTime: '11:00',
        endTime: '15:00',
        timezone: 'America/Chicago',
        locationName: 'Sweet Love at Riverwalk',
        address: '123 Riverwalk Ave, Austin, TX',
        closed: false,
        recurrence: 'current_week_only'
      }
    ]
  });

  assert.equal(packet.targetProduct, 'MealScout');
  assert.equal(packet.updateType, 'schedule_update');
  assert.equal(packet.sourceFolderReference, sourceFolderReference);
  assert.equal(packet.productionApplied, false);
  assert.equal(packet.mutationAllowed, false);
  assert.equal(packet.implementationAllowed, false);
  assert.equal(packet.applyEligible, false);
  assert.equal(packet.ownerSubmittedEquivalent, true);
  assert.equal(packet.targetResolutionStatus, 'resolved_exact_target_id');
  assert.equal(packet.productSpecificPayload.updateType, 'schedule_update');

  const [entry] = packet.productSpecificPayload.entries;
  assert.equal(entry.date, '2026-06-20');
  assert.equal(entry.startTime, '11:00');
  assert.equal(entry.endTime, '15:00');
  assert.equal(entry.timezone, 'America/Chicago');
  assert.equal(entry.locationName, 'Sweet Love at Riverwalk');
  assert.equal(entry.address, '123 Riverwalk Ave, Austin, TX');
  assert.equal(entry.recurrence, 'current_week_only');
  assert.equal(entry.mapEligible, true);
  assert.equal(entry.liveFeedEligible, true);
  assert.equal(entry.sourceEvidence[0].sourceReference, 'drive://sweet-love-schedule');
  assert.equal(packet.requiredVerificationSteps.includes('preview_before_apply'), true);
  assert.equal(packet.requiredVerificationSteps.includes('exact_target_id_required_for_production_apply'), true);
  assert.equal(packet.requiredVerificationSteps.includes('no_fake_schedules'), true);
  assert.equal(packet.requiredVerificationSteps.includes('no_inferred_recurring_schedule'), true);
  assert.equal(packet.requiredVerificationSteps.includes('timezone_must_be_explicit'), true);
});

test('fails closed on incomplete schedule evidence and ambiguous target profile', () => {
  const sourceFolderReference = 'drive://mealscout/sweet-love/evidence-folder';
  const packet = createUniversalProductUpdatePacket({
    sourceActor: {
      actorScope: 'staff',
      actorId: 'merlin-staff-test'
    },
    targetProduct: 'MealScout',
    targetBusinessName: 'Sweet Love',
    targetProfileId: 'ms-test-sweet-love-profile',
    targetResolutionStatus: 'ambiguous_target',
    updateType: 'schedule_update',
    confidence: 0.62,
    evidenceReferences: [
      {
        sourceFileName: 'sweet-love-schedule.png',
        sourceMimeType: 'image/png',
        sourceReference: 'drive://sweet-love-schedule',
        sourceFolderReference
      }
    ],
    scheduleEntries: [
      {
        date: '2026-06-20',
        locationName: 'Sweet Love somewhere downtown',
        recurrence: 'unknown'
      }
    ]
  });

  assert.equal(packet.productionApplied, false);
  assert.equal(packet.mutationAllowed, false);
  assert.equal(packet.implementationAllowed, false);
  assert.equal(packet.applyEligible, false);
  assert.equal(packet.ownerSubmittedEquivalent, false);
  assert.equal(packet.targetResolutionStatus, 'ambiguous_target');
  assert.equal(packet.requiredVerificationSteps.includes('fail_closed_on_ambiguous_target'), true);

  const [entry] = packet.productSpecificPayload.entries;
  assert.equal(entry.recurrence, 'unknown');
  assert.equal(entry.mapEligible, false);
  assert.equal(entry.liveFeedEligible, false);
  assert.equal(packet.missingFields.includes('schedule.entries.startTime'), true);
  assert.equal(packet.missingFields.includes('schedule.entries.endTime'), true);
  assert.equal(packet.missingFields.includes('schedule.entries.timezone'), true);
  assert.equal(packet.missingFields.includes('schedule.entries.address'), true);
  assert.equal(packet.safetyFlags.includes('no_inferred_recurring_schedule'), true);
  assert.equal(packet.safetyFlags.includes('missing_schedule_fields'), true);
});
