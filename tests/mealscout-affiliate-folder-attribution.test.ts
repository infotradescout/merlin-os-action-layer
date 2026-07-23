import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

process.env.MERLIN_RUNTIME = 'test';

const { resolveAffiliateFolderAttributionFromPath } = await import('../src/server.ts');
const {
  buildMealScoutProfileDraft,
  createMealScoutProfileFromPlanRecord,
  resetMealScoutProfileImportForTest
} = await import('../src/mealscoutProfileImport.ts');
const {
  buildMealScoutPublishPlanPreview,
  rememberMealScoutPublishPlan,
  resetMealScoutPublishPlansForTest
} = await import('../src/mealscoutPublishPlan.ts');
const {
  executeMealScoutPublishPlan,
  queryMealScoutPublishExecutionAudit,
  resetMealScoutPublishExecutionForTest
} = await import('../src/mealscoutPublishExecution.ts');

beforeEach(() => {
  resetMealScoutProfileImportForTest();
  resetMealScoutPublishPlansForTest();
  resetMealScoutPublishExecutionForTest();
});

function sourceAttribution(folderPath: string, sourceChannel: 'drive_upload' | 'admin_import' = 'drive_upload') {
  return {
    attributionSource: 'drive_metadata' as const,
    attributionStatus: 'unmatched' as const,
    driveUploaderEmail: 'staff@merlin.example',
    sourceChannel,
    capturedAt: '2026-06-02T00:00:00.000Z',
    ...resolveAffiliateFolderAttributionFromPath({ folderPath })
  };
}

function validDraft() {
  return buildMealScoutProfileDraft([
    {
      sourceFileId: 'seed-profile-1',
      sourceFileName: 'profile.png',
      sourcePath: '/Merlin OR Storage/MealScout Intake/affiliates/Owner@Example.COM/orbit/profile.png',
      sourceType: 'screenshot',
      rawExtractedText: 'Orbit Tacos\nPhone: 504-333-9090\nCity: Metairie\nCuisine: Tacos',
      truckName: 'Orbit Tacos',
      phone: '504-333-9090',
      cityArea: 'Metairie',
      cuisine: 'Tacos',
      sourceFileAttribution: sourceAttribution('/Merlin OR Storage/MealScout Intake/affiliates/Owner@Example.COM/orbit')
    },
    {
      sourceFileId: 'seed-menu-1',
      sourceFileName: 'menu.png',
      sourcePath: '/Merlin OR Storage/MealScout Intake/affiliates/Owner@Example.COM/orbit/menu.png',
      sourceType: 'menu',
      rawExtractedText: 'Orbit Tacos Menu\nAl Pastor Taco $4.25',
      menuItems: [{ name: 'Al Pastor Taco', price: '$4.25' }],
      sourceFileAttribution: sourceAttribution('/Merlin OR Storage/MealScout Intake/affiliates/Owner@Example.COM/orbit')
    }
  ]);
}

test('valid email-named folder assigns normalized affiliate attribution only', () => {
  const attribution = resolveAffiliateFolderAttributionFromPath({
    folderPath: '/Merlin/MealScout Intake/Affiliates/Owner@Example.COM/screenshots'
  });

  assert.equal(attribution.affiliate_attribution_email, 'owner@example.com');
  assert.equal(attribution.affiliate_attribution_source, 'folder_email_token');
  assert.equal(attribution.affiliate_attribution_folder, 'Owner@Example.COM');
  assert.equal(attribution.affiliate_attribution_folder_path, 'Merlin/MealScout Intake/Affiliates/Owner@Example.COM');
});

test('folder email token can appear with screenshot or product label text', () => {
  const examples = [
    ['affiliate@example.com', 'affiliate@example.com'],
    ['affiliate@example.com Screenshots', 'affiliate@example.com'],
    ['affiliate@example.com - Screenshots', 'affiliate@example.com'],
    ['Screenshots - affiliate@example.com', 'affiliate@example.com'],
    ['affiliate@example.com TradeScout', 'affiliate@example.com'],
    ['affiliate@example.com MealScout', 'affiliate@example.com'],
    ['Thehungerbrothers1@gmail.com Screenshots', 'thehungerbrothers1@gmail.com']
  ] as const;

  for (const [folderName, expectedEmail] of examples) {
    const attribution = resolveAffiliateFolderAttributionFromPath({
      folderPath: `/Merlin/MealScout Intake/Affiliates/${folderName}/incoming`
    });

    assert.equal(attribution.affiliate_attribution_email, expectedEmail);
    assert.equal(attribution.affiliate_attribution_source, 'folder_email_token');
    assert.equal(attribution.affiliate_attribution_folder, folderName);
  }
});

test('non-email folder names do not guess affiliate attribution', () => {
  const examples = ['John Screenshots', 'Affiliate Uploads', 'Screenshots Gmail', 'john at example dot com'];

  for (const folderName of examples) {
    const attribution = resolveAffiliateFolderAttributionFromPath({
      folderPath: `/Merlin/MealScout Intake/Affiliates/${folderName}/incoming`
    });

    assert.equal(attribution.affiliate_attribution_email, undefined);
    assert.equal(attribution.affiliate_attribution_source, undefined);
  }
});

test('invalid email folder assigns no affiliate attribution', () => {
  const attribution = resolveAffiliateFolderAttributionFromPath({
    folderPath: '/Merlin/MealScout Intake/Affiliates/not-an-email@/screenshots'
  });

  assert.equal(attribution.affiliate_attribution_email, undefined);
  assert.equal((attribution.affiliate_attribution_warnings || []).includes('invalid_email_named_parent_folder'), true);
});

test('nested email folders use nearest valid parent and warn on multiple email folders', () => {
  const attribution = resolveAffiliateFolderAttributionFromPath({
    folderPath: '/Merlin/root@outer.example/Affiliates/Nearest@Example.COM/screenshots'
  });

  assert.equal(attribution.affiliate_attribution_email, 'nearest@example.com');
  assert.equal(attribution.affiliate_attribution_folder, 'Nearest@Example.COM');
  assert.equal((attribution.affiliate_attribution_warnings || []).includes('multiple_email_named_parent_folders'), true);
});

test('staff-placed screenshots preserve folder owner credit without becoming business email or brand', () => {
  const draft = buildMealScoutProfileDraft([
    {
      sourceFileId: 'staff-profile-1',
      sourceFileName: 'staff-profile.png',
      sourcePath: '/Merlin OR Storage/MealScout Intake/staff/affiliate@example.com/staff-profile.png',
      sourceType: 'screenshot',
      rawExtractedText: 'Staff Placed Tacos\nPhone: 504-111-2222\nEmail: truck@example.biz\nCity: Metairie\nCuisine: Tacos\nTaco $4.00',
      truckName: 'Staff Placed Tacos',
      phone: '504-111-2222',
      email: 'truck@example.biz',
      cityArea: 'Metairie',
      cuisine: 'Tacos',
      menuItems: [{ name: 'Taco', price: '$4.00' }],
      sourceFileAttribution: sourceAttribution('/Merlin OR Storage/MealScout Intake/staff/affiliate@example.com', 'admin_import')
    }
  ]);

  assert.equal(draft.sourceAttribution?.affiliate_attribution_email, 'affiliate@example.com');
  assert.equal(draft.email, 'truck@example.biz');
  assert.notEqual(draft.email, draft.sourceAttribution?.affiliate_attribution_email);
  assert.equal('brand' in (draft as unknown as Record<string, unknown>), false);
  assert.equal(draft.sourceFiles[0].sourceAttribution?.sourceChannel, 'admin_import');
});

test('publish preview, profile seed, and audit preserve affiliate attribution and keep verification false', () => {
  const draft = validDraft();
  assert.equal(draft.sourceAttribution?.affiliate_attribution_email, 'owner@example.com');

  const plan = rememberMealScoutPublishPlan(buildMealScoutPublishPlanPreview([draft], []));
  const record = plan.records[0];
  assert.equal(record.publishReady, true);
  assert.equal(record.sourceAttribution?.affiliate_attribution_email, 'owner@example.com');
  assert.equal(record.profileFields.email, undefined);

  const profile = createMealScoutProfileFromPlanRecord(record);
  assert.equal(profile.affiliate_attribution_email, 'owner@example.com');
  assert.equal(profile.email, undefined);
  assert.equal(profile.email_verified, false);
  assert.equal(profile.insurance_verified, false);

  const execution = executeMealScoutPublishPlan({
    planId: plan.planId,
    recordIds: [record.recordId],
    confirmation: true,
    operatorId: 'staff-user-1',
    expectedSignature: plan.signature
  });
  assert.equal(execution.results[0].result, 'success');
  const audit = queryMealScoutPublishExecutionAudit({ planId: plan.planId })[0];
  assert.equal(audit.sourceAttribution?.affiliate_attribution_email, 'owner@example.com');
  assert.equal(audit.newValues?.email, undefined);
});
