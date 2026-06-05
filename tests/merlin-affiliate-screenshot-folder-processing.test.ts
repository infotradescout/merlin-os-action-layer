import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, test } from 'node:test';

process.env.MERLIN_RUNTIME = 'test';
process.env.MEALSCOUT_AFFILIATE_TRACKING_LEDGER_PATH = join(tmpdir(), 'merlin-affiliate-screenshot-folder-processing-ledger-test.csv');

const { processAffiliateScreenshotFolders } = await import('../src/merlin/affiliateScreenshotFolderProcessing.ts');
const { readAffiliateTrackingLedgerRows, resetAffiliateTrackingLedgerForTest } = await import('../src/mealscoutAffiliateTrackingLedger.ts');
const { resetMerlinProfileSeedRuntimeForTest, listVerificationEmailRecords } = await import('../src/merlin/profileSeedRuntime.ts');
const { resetMealScoutProfileImportForTest, listMealScoutTrucks } = await import('../src/mealscoutProfileImport.ts');
const { setProductVerificationEmailSenderForTest } = await import('../src/productVerificationEmail.ts');

beforeEach(() => {
  resetAffiliateTrackingLedgerForTest();
  resetMerlinProfileSeedRuntimeForTest();
  resetMealScoutProfileImportForTest();
  setProductVerificationEmailSenderForTest((request) => ({
    status: 'sent',
    providerMessageId: `folder-processing-${request.recipientEmail}`
  }));
});

test('affiliate screenshot folder processing is dry-run by default and does not seed profiles', async () => {
  const report = await processAffiliateScreenshotFolders({
    apply: false,
    localFolders: [
      {
        folderId: 'folder-affiliate',
        folderName: 'Thehungerbrothers1@gmail.com Screenshots',
        folderPath: 'Merlin OR Storage/Thehungerbrothers1@gmail.com Screenshots',
        files: [
          {
            fileId: 'meal-1',
            fileName: 'meal-profile.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Lucky Tacos Food Truck\nEmail: truck@example.com\nPhone: 850-255-8396\nMenu: Taco $4'
          }
        ]
      }
    ]
  });

  assert.equal(report.mode, 'dry_run');
  assert.equal(report.affiliate_folders_found_count, 1);
  assert.equal(report.screenshots_found_count, 1);
  assert.equal(report.screenshots_processed_count, 0);
  assert.equal(report.affiliate_ledger_rows_written, 0);
  assert.equal(readAffiliateTrackingLedgerRows().length, 0);
  assert.equal(listMealScoutTrucks().length, 0);
});

test('affiliate screenshot folder processing applies through existing seed runtime and preserves safety boundaries', async () => {
  const report = await processAffiliateScreenshotFolders({
    apply: true,
    localFolders: [
      {
        folderId: 'folder-affiliate',
        folderName: 'Screenshots - Affiliate@Example.com',
        folderPath: 'Merlin OR Storage/Screenshots - Affiliate@Example.com',
        files: [
          {
            fileId: 'meal-1',
            fileName: 'meal-profile.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Lucky Tacos Food Truck\nEmail: truck@example.com\nPhone: 850-255-8396\nMenu: Taco $4'
          },
          {
            fileId: 'trade-1',
            fileName: 'trade-profile.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Contractor: Apex Roofing\nEmail: apex@example.com\nPhone: 985-222-3333\nLicense and insurance document'
          },
          {
            fileId: 'ambiguous-1',
            fileName: 'unknown.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Random screenshot without a business identity'
          }
        ]
      },
      {
        folderId: 'folder-invalid',
        folderName: 'John Screenshots',
        folderPath: 'Merlin OR Storage/John Screenshots',
        files: [
          {
            fileId: 'ignored-1',
            fileName: 'ignored.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Ignored Truck\nPhone: 504-111-2222'
          }
        ]
      }
    ]
  });

  assert.equal(report.mode, 'apply');
  assert.equal(report.affiliate_folders_found_count, 1);
  assert.equal(report.screenshots_found_count, 4);
  assert.equal(report.screenshots_processed_count, 3);
  assert.equal(report.mealscout_created_count, 1);
  assert.equal(report.tradescout_created_count, 1);
  assert.equal(report.blocked_ambiguous_count, 1);
  assert.equal(report.folders_without_valid_email_count, 1);
  assert.equal(report.files_without_attribution_count, 1);
  assert.equal(report.verification_email_sent_count, 2);

  const ledger = readAffiliateTrackingLedgerRows();
  assert.equal(ledger.some((row) => row.source_file_id === 'meal-1' && row.affiliate_attribution_email === 'affiliate@example.com'), true);
  assert.equal(ledger.some((row) => row.source_file_id === 'trade-1' && row.affiliate_attribution_email === 'affiliate@example.com'), true);
  assert.equal(ledger.some((row) => row.source_file_id === 'ignored-1'), false);

  const recipients = listVerificationEmailRecords().map((row) => row.recipient_email);
  assert.deepEqual(recipients.sort(), ['apex@example.com', 'truck@example.com']);
  assert.equal(recipients.includes('affiliate@example.com'), false);

  const mealProfile = listMealScoutTrucks().find((profile) => profile.email === 'truck@example.com');
  assert.ok(mealProfile);
  assert.equal(mealProfile?.email_verified, false);
  assert.equal(mealProfile?.insurance_verified, false);
  assert.equal(mealProfile?.claim_status, 'unclaimed');
});
