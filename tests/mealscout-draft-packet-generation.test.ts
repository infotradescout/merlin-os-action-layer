import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateMealScoutDraftProfilePackets } from '../src/mealscoutDraftPacketGeneration.ts';
import type { MealScoutArtifactClassificationRow } from '../src/mealscoutMenuArtifactClassification.ts';

function row(overrides: Partial<MealScoutArtifactClassificationRow>): MealScoutArtifactClassificationRow {
  return {
    source_drive_file_id: overrides.drive_file_id || overrides.source_drive_file_id || 'file-1',
    source_final_filename: overrides.final_filename || overrides.source_final_filename || 'file.png',
    source_row_number: overrides.source_row_number || 1,
    drive_file_id: overrides.drive_file_id || overrides.source_drive_file_id || 'file-1',
    final_filename: overrides.final_filename || overrides.source_final_filename || 'file.png',
    raw_ocr_snippet: overrides.raw_ocr_snippet || '',
    artifact_type: overrides.artifact_type || 'profile',
    artifact_signals: overrides.artifact_signals || [],
    menu_items: overrides.menu_items || [],
    confidence: overrides.confidence ?? 0.8,
    warnings: overrides.warnings || [],
    ...overrides
  };
}

test('draft packet generation creates review-only food vendor packets from visible OCR facts', () => {
  const result = generateMealScoutDraftProfilePackets([
    row({
      drive_file_id: 'profile-1',
      source_row_number: 10,
      raw_ocr_snippet:
        'Bayou Bites\nFood Truck\nPhone: (985) 555-1212\nInstagram: @bayoubites\nServing Kenner, LA\nCajun',
      business_name_candidate: 'Bayou Bites',
      linked_business_candidate: 'Bayou Bites',
      artifact_signals: ['food_terms', 'profile_page'],
      phone: '985-555-1212'
    }),
    row({
      drive_file_id: 'menu-1',
      source_row_number: 11,
      artifact_type: 'menu',
      raw_ocr_snippet: 'Bayou Bites Menu\nShrimp Po Boy - $12.00\nGumbo Bowl 10.00',
      business_name_candidate: 'Bayou Bites',
      linked_business_candidate: 'Bayou Bites',
      artifact_signals: ['food_terms', 'menu_heading']
    })
  ]);

  assert.equal(result.mode, 'draft_packet_export_only');
  assert.equal(result.mutationAllowed, false);
  assert.equal(result.productionApplied, false);
  assert.equal(result.draftPacketsCreated, 1);
  const packet = result.draftPackets[0];
  assert.equal(packet.mutationAllowed, false);
  assert.equal(packet.productionApplied, false);
  assert.equal(packet.businessName?.value, 'Bayou Bites');
  assert.equal(packet.phone?.value, '985-555-1212');
  assert.equal(packet.socials.instagram?.value, '@bayoubites');
  assert.equal(packet.menuItems.some((item) => item.name === 'Shrimp Po Boy' && item.price === '$12.00'), true);
  assert.deepEqual(new Set(packet.sourceScreenshots.map((source) => source.driveFileId)), new Set(['profile-1', 'menu-1']));
});

test('draft packet generation quarantines non-food and holds unreadable unknown rows', () => {
  const result = generateMealScoutDraftProfilePackets([
    row({
      drive_file_id: 'roof-1',
      artifact_type: 'unknown',
      raw_ocr_snippet: 'Quality Roofing\nRoofing Service\n850-555-0101',
      business_name_candidate: 'Quality Roofing',
      linked_business_candidate: 'Quality Roofing'
    }),
    row({
      drive_file_id: 'unknown-1',
      artifact_type: 'unknown',
      raw_ocr_snippet: 'Follow @ Message\nAll posts',
      business_name_candidate: 'Follow @ Message',
      linked_business_candidate: 'Follow @ Message'
    })
  ]);

  assert.equal(result.draftPacketsCreated, 0);
  assert.equal(result.nonFoodQuarantined, 1);
  assert.equal(result.unknownHeld, 1);
  assert.equal(result.nonFoodQuarantine[0].driveFileId, 'roof-1');
  assert.equal(result.unknownHeldRows[0].driveFileId, 'unknown-1');
});

test('draft packet generation blocks conflict publish plan and requires owner confirmation', () => {
  const result = generateMealScoutDraftProfilePackets([
    row({
      drive_file_id: 'conflict-a',
      raw_ocr_snippet: 'Taco Orbit\nFood Truck\nPhone: 504-111-2222\nTacos',
      business_name_candidate: 'Taco Orbit',
      linked_business_candidate: 'Taco Orbit',
      phone: '504-111-2222'
    }),
    row({
      drive_file_id: 'conflict-b',
      raw_ocr_snippet: 'Taco Orbit\nFood Truck\nPhone: 504-999-2222\nTacos',
      business_name_candidate: 'Taco Orbit',
      linked_business_candidate: 'Taco Orbit',
      phone: '504-999-2222'
    })
  ]);

  assert.equal(result.draftPacketsCreated, 1);
  assert.equal(result.conflictsFound, 1);
  assert.equal(result.ownerConfirmationsRequired, 1);
  assert.equal(result.draftPackets[0].reviewStatus, 'blocked_by_conflict');
  assert.equal(result.draftPackets[0].conflicts[0].field, 'phone');
});

test('draft packet generation does not infer business name from filename without visible OCR support', () => {
  const result = generateMealScoutDraftProfilePackets([
    row({
      drive_file_id: 'filename-only',
      final_filename: 'Blessed Berry Bowls.png',
      artifact_type: 'profile',
      raw_ocr_snippet: 'Food Truck\nPhone: 850-555-0101',
      business_name_candidate: 'Blessed Berry Bowls',
      linked_business_candidate: 'Blessed Berry Bowls'
    })
  ]);

  assert.equal(result.draftPacketsCreated, 0);
  assert.equal(result.unknownHeld, 1);
  assert.equal(result.unknownHeldRows[0].reason, 'missing_visible_business_identity');
});

test('draft packet generation uses tracker rows as draft vendor packet boundaries', () => {
  const result = generateMealScoutDraftProfilePackets(
    [
      row({
        drive_file_id: 'profile-a',
        source_row_number: 1,
        raw_ocr_snippet: 'Jones Shakes Pensacola\nDessert Shop\nPhone: 850-470-1999\ninstagram.com/jonesshakes.pensacola',
        business_name_candidate: 'Jones Shakes Pensacola',
        linked_business_candidate: 'Jones Shakes Pensacola',
        artifact_signals: ['food_terms', 'profile_page'],
        phone: '850-470-1999',
        website: 'instagram.com/jonesshakes.pensacola'
      }),
      row({
        drive_file_id: 'profile-b',
        source_row_number: 2,
        raw_ocr_snippet: 'Hula Hawaiian Barbecue\nFood Truck\nPhone: 850-542-7599',
        business_name_candidate: 'Hula Hawaiian Barbecue',
        linked_business_candidate: 'Hula Hawaiian Barbecue',
        artifact_signals: ['food_terms', 'profile_page'],
        phone: '850-542-7599'
      }),
      row({
        drive_file_id: 'roof-extra',
        source_row_number: 3,
        artifact_type: 'unknown',
        raw_ocr_snippet: 'Quality Roofing\nRoofing Service\n850-555-0101',
        business_name_candidate: 'Quality Roofing',
        linked_business_candidate: 'Quality Roofing'
      }),
      row({
        drive_file_id: 'unknown-extra',
        source_row_number: 4,
        artifact_type: 'unknown',
        raw_ocr_snippet: 'Follow @ Message\nAll posts',
        business_name_candidate: 'Follow @ Message',
        linked_business_candidate: 'Follow @ Message'
      })
    ],
    {
      source: 'artifact-classification-rows.json',
      trackerSource: 'duplicate-groups.json',
      trackerRows: [
        {
          duplicateGroupId: 'tracker-1',
          groupKey: 'contact:850-470-1999',
          evidenceDriveFileIds: ['profile-a'],
          businessNames: ['Jones Shakes Pensacola']
        },
        {
          duplicateGroupId: 'tracker-2',
          groupKey: 'contact:850-542-7599',
          evidenceDriveFileIds: ['profile-b'],
          businessNames: ['Hula Hawaiian Barbecue']
        }
      ]
    }
  );

  assert.equal(result.trackerRowsProcessed, 2);
  assert.equal(result.manifestSummary.evidenceRowsRead, 4);
  assert.equal(result.manifestSummary.trackerSource, 'duplicate-groups.json');
  assert.equal(result.draftPacketsCreated, 2);
  assert.deepEqual(
    result.draftPackets.map((packet) => packet.trackerRowId).sort(),
    ['tracker-1', 'tracker-2']
  );
  assert.equal(result.nonFoodQuarantined, 1);
  assert.equal(result.unknownHeld, 1);
  assert.equal(result.productionApplied, false);
  assert.equal(result.mutationAllowed, false);
});
