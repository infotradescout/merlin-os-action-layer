import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IntentActionDefinition, UploadIntent, UploadIntentFileRef } from '../src/merlin/intake/intakeTypes.js';
import { routeUploadIntentFiles } from '../src/merlin/intake/router.ts';

function makeActionSnapshot(overrides: { actionId: string; actorScope?: 'owner' | 'staff' | 'admin' }): IntentActionDefinition {
  return {
    actionId: overrides.actionId,
    brand: 'MEALSCOUT',
    actorScope: overrides.actorScope || 'owner',
    label: overrides.actionId,
    description: `MealScout action ${overrides.actionId}`,
    entityTypesAllowed: ['food_truck', 'restaurant', 'unknown'],
    expectedFileTypes: ['image/*', 'application/pdf', 'text/*'],
    allowedOutputTypes: ['menu_update'],
    allowedFieldPaths: ['menu.items'],
    forbiddenFieldPaths: ['businessName'],
    requiresEntityContext: true,
    requiresUserHint: false,
    previewRequired: true,
    approvalRequired: true,
    implementationMode: 'approval_required',
    riskLevel: 'medium'
  };
}

function makeIntent(input: {
  actionId: string;
  actorScope?: 'owner' | 'staff' | 'admin';
  files: UploadIntentFileRef[];
}): UploadIntent {
  return {
    uploadId: 'upload-intent-test',
    userId: 'u-1',
    accountId: 'a-1',
    brand: 'MEALSCOUT',
    actorScope: input.actorScope || 'owner',
    entityType: 'food_truck',
    entityId: 'truck-1',
    actionId: input.actionId,
    actionSnapshot: makeActionSnapshot({ actionId: input.actionId, actorScope: input.actorScope || 'owner' }),
    files: input.files,
    routing: [],
    status: 'CREATED',
    implementationAllowed: false,
    previewRequired: true,
    approvalRequired: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

test('routeUploadIntentFiles holds ambiguous files when menu and schedule signals compete', () => {
  const intent = makeIntent({
    actionId: 'update_menu',
    files: [
      {
        fileId: 'file-ambiguous',
        fileName: 'menu-hours.png',
        extractedText: 'Menu board Monday 11:00 AM - 8:00 PM'
      }
    ]
  });
  const routed = routeUploadIntentFiles(intent);
  assert.equal(routed[0].routedType, 'held');
  assert.equal(routed[0].holdReason, 'ambiguous');
  assert.equal(routed[0].reasons.includes('menu_signal_detected'), true);
  assert.equal(routed[0].reasons.includes('schedule_signal_detected'), true);
  assert.equal(routed[0].reasons.includes('competing_destination_signals'), true);
});

test('routeUploadIntentFiles blocks clear destination mismatch for explicit menu action', () => {
  const intent = makeIntent({
    actionId: 'update_menu',
    files: [
      {
        fileId: 'file-schedule',
        fileName: 'hours.jpg',
        mimeType: 'image/jpeg',
        extractedText: 'Monday 11:00 AM - 8:00 PM'
      }
    ]
  });
  const routed = routeUploadIntentFiles(intent);
  assert.equal(routed[0].routedType, 'held');
  assert.equal(routed[0].holdReason, 'INTENT_EVIDENCE_CONFLICT');
  assert.equal(routed[0].reasons.includes('intent_destination_mismatch'), true);
});

test('routeUploadIntentFiles requires confidence for destination-specific actions', () => {
  const intent = makeIntent({
    actionId: 'upload_logo',
    files: [
      {
        fileId: 'file-pdf',
        fileName: 'contract.pdf',
        mimeType: 'application/pdf',
        extractedText: 'Random contract text for a menu description'
      }
    ]
  });
  const routed = routeUploadIntentFiles(intent);
  assert.equal(routed[0].routedType, 'held');
  assert.equal(routed[0].holdReason, 'INTENT_EVIDENCE_CONFLICT');
  assert.equal(routed[0].reasons.includes('intent_destination_mismatch'), true);
  assert.equal(routed[0].reasons.includes('expected_route_logo'), true);
});

test('routeUploadIntentFiles holds unknown evidence with insufficient evidence metadata', () => {
  const intent = makeIntent({
    actionId: 'update_menu',
    files: [
      {
        fileId: 'file-unknown',
        fileName: 'upload.bin',
        mimeType: 'application/octet-stream',
        extractedText: 'unstructured notes without a destination signal'
      }
    ]
  });
  const routed = routeUploadIntentFiles(intent);
  assert.equal(routed[0].routedType, 'held');
  assert.equal(routed[0].holdReason, 'insufficient_evidence');
  assert.equal(routed[0].reasons.includes('no_destination_signal_detected'), true);
});

test('routeUploadIntentFiles keeps menu intent on menu evidence', () => {
  const intent = makeIntent({
    actionId: 'update_menu',
    files: [
      {
        fileId: 'file-menu',
        fileName: 'menu.jpg',
        mimeType: 'image/jpeg',
        extractedText: 'Wing combo $12.00 and fries'
      }
    ]
  });
  const routed = routeUploadIntentFiles(intent);
  assert.equal(routed[0].routedType, 'menu');
  assert.equal(routed[0].confidence >= 0.85, true);
  assert.equal(routed[0].holdReason, undefined);
});

test('routeUploadIntentFiles keeps photo intent on clear photo evidence', () => {
  const intent = makeIntent({
    actionId: 'add_food_photos',
    files: [
      {
        fileId: 'file-photo',
        fileName: 'tacos.jpg',
        mimeType: 'image/jpeg',
        extractedText: ''
      }
    ]
  });
  const routed = routeUploadIntentFiles(intent);
  assert.equal(routed[0].routedType, 'photo');
  assert.equal(routed[0].confidence >= 0.8, true);
  assert.equal(routed[0].reasons.includes('photo_signal_detected'), true);
  assert.equal(routed[0].reasons.includes('action_bias_add_food_photos'), true);
  assert.equal(routed[0].holdReason, undefined);
});
