import assert from 'node:assert/strict';
import { test } from 'node:test';

const { buildMealScoutPublishPlanPreview } = await import('../src/mealscoutPublishPlan.ts');
const { buildMealScoutProfileDraft } = await import('../src/mealscoutProfileImport.ts');

function makeDraft(input: {
  id: string;
  truckName?: string;
  cityArea?: string;
  phone?: string;
  email?: string;
  website?: string;
  instagram?: string;
  menuName?: string;
  existingTruckId?: string;
  draftType?: 'create_new' | 'update_existing' | 'uncertain_match';
  repId?: string;
  affiliateCode?: string;
}) {
  const draft = buildMealScoutProfileDraft([
    {
      sourceFileId: `${input.id}-file`,
      sourceFileName: `${input.id}.png`,
      sourceType: 'screenshot',
      truckName: input.truckName,
      cityArea: input.cityArea,
      phone: input.phone,
      email: input.email,
      website: input.website,
      socials: { instagram: input.instagram },
      menuItems: input.menuName ? [{ name: input.menuName, price: '$10.00' }] : undefined,
      menuDeferred: false,
      rawExtractedText: 'raw ocr snippet',
      sourceFileAttribution: {
        attributionSource: 'request_context',
        repId: input.repId,
        affiliateCode: input.affiliateCode,
        sourceChannel: 'manual_upload'
      }
    }
  ]);
  draft.draftId = input.id;
  if (input.existingTruckId) draft.existingTruckId = input.existingTruckId;
  if (input.draftType) draft.draftType = input.draftType;
  return draft;
}

test('same_truck decision combines drafts into one plan record', () => {
  const d1 = makeDraft({ id: 'd1', truckName: 'Orbit', cityArea: 'Kenner', phone: '111', menuName: 'Taco' });
  const d2 = makeDraft({ id: 'd2', truckName: 'Orbit', cityArea: 'Kenner', phone: '111', menuName: 'Burrito' });
  const plan = buildMealScoutPublishPlanPreview(
    [d1, d2],
    [
      {
        decisionId: 'r1',
        draftIds: ['d1', 'd2'],
        decision: 'same_truck',
        sourceFileIds: ['d1-file', 'd2-file'],
        evidenceRefs: ['same_phone'],
        decidedAt: '2026-05-29T00:00:00.000Z',
        mutationAllowed: false
      }
    ]
  );
  assert.equal(plan.mutationAllowed, false);
  assert.equal(plan.records.length, 1);
  assert.deepEqual(plan.records[0].draftIds.sort(), ['d1', 'd2']);
});

test('keep_separate keeps drafts separate and needs_review blocks publish', () => {
  const d1 = makeDraft({ id: 'd3', truckName: 'A', cityArea: 'Kenner', phone: '111', menuName: 'Taco' });
  const d2 = makeDraft({ id: 'd4', truckName: 'B', cityArea: 'Kenner', phone: '222', menuName: 'Wrap' });
  const plan = buildMealScoutPublishPlanPreview(
    [d1, d2],
    [
      {
        decisionId: 'r2',
        draftIds: ['d3'],
        decision: 'keep_separate',
        sourceFileIds: ['d3-file'],
        evidenceRefs: ['manual'],
        decidedAt: '2026-05-29T00:00:00.000Z',
        mutationAllowed: false
      },
      {
        decisionId: 'r3',
        draftIds: ['d4'],
        decision: 'needs_review',
        sourceFileIds: ['d4-file'],
        evidenceRefs: ['manual'],
        decidedAt: '2026-05-29T00:00:01.000Z',
        mutationAllowed: false
      }
    ]
  );
  assert.equal(plan.records.length, 2);
  assert.equal(plan.records.some((row) => row.plannedAction === 'needs_review' && row.publishReady === false), true);
});

test('missing required and conflicting contact fields block publish readiness', () => {
  const d1 = makeDraft({ id: 'd5', truckName: 'Same', cityArea: 'Kenner', phone: '111', menuName: 'Taco' });
  const d2 = makeDraft({ id: 'd6', truckName: 'Same', cityArea: 'Kenner', phone: '222', menuName: 'Wrap' });
  const d3 = makeDraft({ id: 'd7', truckName: 'NoContact', cityArea: 'Kenner', menuName: 'Rice' });
  const plan = buildMealScoutPublishPlanPreview(
    [d1, d2, d3],
    [
      {
        decisionId: 'r4',
        draftIds: ['d5', 'd6'],
        decision: 'same_truck',
        sourceFileIds: ['d5-file', 'd6-file'],
        evidenceRefs: ['manual'],
        decidedAt: '2026-05-29T00:00:00.000Z',
        mutationAllowed: false
      }
    ]
  );
  const merged = plan.records.find((row) => row.draftIds.includes('d5'));
  assert.ok(merged);
  assert.equal(merged.publishReady, false);
  assert.equal((merged.blockedReasons || []).includes('conflicting_identity_fields'), true);
  const noContact = plan.records.find((row) => row.draftIds.includes('d7'));
  assert.ok(noContact);
  assert.equal(noContact.publishReady, false);
  assert.equal((noContact.blockedReasons || []).includes('missing_contact_or_web_or_social'), true);
});

test('existing truck match yields update_existing and fields carry evidence refs/source ids', () => {
  const d1 = makeDraft({
    id: 'd8',
    truckName: 'Updater',
    cityArea: 'Kenner',
    phone: '999',
    menuName: 'Plate',
    existingTruckId: 'truck-1',
    draftType: 'update_existing'
  });
  const plan = buildMealScoutPublishPlanPreview([d1], []);
  assert.equal(plan.records[0].plannedAction, 'update_existing');
  const name = plan.records[0].profileFields.truckName;
  assert.ok(name);
  assert.equal(name.evidenceRefs.length > 0, true);
  assert.equal(name.sourceFileIds.length > 0, true);
  assert.equal(plan.mutationAllowed, false);
});

test('publish plan preserves contributor attribution and primary source', () => {
  const d1 = makeDraft({ id: 'd9', truckName: 'Attribution Truck', cityArea: 'Kenner', phone: '999', menuName: 'Plate', repId: 'rep-1' });
  const d2 = makeDraft({ id: 'd10', truckName: 'Attribution Truck', cityArea: 'Kenner', menuName: 'Logo Only', repId: 'rep-2' });
  const plan = buildMealScoutPublishPlanPreview([d1, d2], [
    {
      decisionId: 'r-attrib',
      draftIds: ['d9', 'd10'],
      decision: 'same_truck',
      sourceFileIds: ['d9-file', 'd10-file'],
      evidenceRefs: ['similar_name'],
      decidedAt: '2026-05-29T00:00:00.000Z',
      mutationAllowed: false
    }
  ]);
  assert.equal(plan.records.length, 1);
  const attribution = plan.records[0].sourceAttribution;
  assert.ok(attribution);
  assert.equal(attribution?.contributingRepIds.includes('rep-1'), true);
  assert.equal(attribution?.contributingRepIds.includes('rep-2'), true);
});
