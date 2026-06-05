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

test('affiliate screenshot folder processing includes configured root folder in Drive discovery', async () => {
  const report = await processAffiliateScreenshotFolders({
    apply: false,
    parentFolderId: 'root-affiliate',
    parentFolderPath: 'thehungerbrothers1@gmail.com Screenshots',
    client: {
      async listSubfoldersInFolder() {
        return [];
      },
      async listFilesInFolder(folderId) {
        assert.equal(folderId, 'root-affiliate');
        return [
          {
            drive_file_id: 'root-meal-1',
            file_name: 'root-meal-profile.jpg',
            mime_type: 'image/jpeg',
            folder_id: 'root-affiliate',
            web_url: '',
            raw_metadata: {
              extracted_text: 'Root Tacos Food Truck\nEmail: root-truck@example.com\nPhone: 850-255-8396'
            }
          }
        ];
      },
      async getFileMetadata() {
        throw new Error('not used');
      },
      async downloadFileContent() {
        return undefined;
      },
      async moveFileToFolder() {
        throw new Error('not used');
      },
      async findFolderByName() {
        return undefined;
      },
      async listFoldersByName() {
        return [];
      },
      async createFolderIfMissing() {
        throw new Error('not used');
      }
    }
  });

  assert.equal(report.discovery_mode, 'drive_folder_walk');
  assert.equal(report.scanned_root_id, 'root-affiliate');
  assert.equal(report.scanned_root_name, 'thehungerbrothers1@gmail.com Screenshots');
  assert.equal(report.auth_mode.length > 0, true);
  assert.equal(report.drive_scope_mode.length > 0, true);
  assert.equal(report.recursive_scan_enabled, true);
  assert.equal(report.folders_scanned_count, 1);
  assert.equal(report.folder_paths_scanned_count, 1);
  assert.deepEqual(report.folder_names_scanned_sample, ['thehungerbrothers1@gmail.com Screenshots']);
  assert.equal(report.folders_with_at_symbol_count, 1);
  assert.equal(report.affiliate_folders_found_count, 1);
  assert.deepEqual(report.valid_affiliate_folder_names, ['thehungerbrothers1@gmail.com Screenshots']);
  assert.deepEqual(report.files_parent_folder_ids_sample, ['root-affiliate']);
  assert.deepEqual(report.files_parent_folder_names_sample, ['thehungerbrothers1@gmail.com Screenshots']);
  assert.equal(report.screenshots_found_count, 1);
  assert.equal(report.screenshots_processed_count, 0);
});

test('affiliate screenshot folder processing resolves explicit root folder id metadata for attribution', async () => {
  const report = await processAffiliateScreenshotFolders({
    apply: false,
    rootFolderId: 'drive-folder-17',
    client: {
      async listSubfoldersInFolder() {
        return [];
      },
      async listFilesInFolder(folderId) {
        assert.equal(folderId, 'drive-folder-17');
        return [
          {
            drive_file_id: 'explicit-root-meal-1',
            file_name: 'explicit-root-meal-profile.jpg',
            mime_type: 'image/jpeg',
            folder_id: 'drive-folder-17',
            web_url: '',
            raw_metadata: {
              extracted_text: 'Explicit Root Tacos\nEmail: explicit-root-truck@example.com\nPhone: 850-255-8396'
            }
          }
        ];
      },
      async getFileMetadata(fileId) {
        assert.equal(fileId, 'drive-folder-17');
        return {
          drive_file_id: 'drive-folder-17',
          file_name: 'Thehungerbrothers1@gmail.com Screenshots',
          mime_type: 'application/vnd.google-apps.folder',
          folder_id: '',
          web_url: ''
        };
      },
      async downloadFileContent() {
        return undefined;
      },
      async moveFileToFolder() {
        throw new Error('not used');
      },
      async findFolderByName() {
        return undefined;
      },
      async listFoldersByName() {
        return [];
      },
      async createFolderIfMissing() {
        throw new Error('not used');
      }
    }
  });

  assert.equal(report.requested_root_folder_id, 'drive-folder-17');
  assert.equal(report.effective_root_folder_id, 'drive-folder-17');
  assert.equal(report.effective_root_folder_name, 'Thehungerbrothers1@gmail.com Screenshots');
  assert.equal(report.root_folder_has_affiliate_email_token, true);
  assert.equal(report.scanned_root_name, 'Thehungerbrothers1@gmail.com Screenshots');
  assert.equal(report.affiliate_folders_found_count, 1);
  assert.deepEqual(report.valid_affiliate_folder_names, ['Thehungerbrothers1@gmail.com Screenshots']);
  assert.equal(report.affiliate_folders[0]?.affiliate_attribution_email, 'thehungerbrothers1@gmail.com');
  assert.equal(report.screenshots_found_count, 1);
  assert.equal(report.screenshots_processed_count, 0);
});

test('affiliate screenshot folder processing reports explicit affiliate root folder when empty', async () => {
  const report = await processAffiliateScreenshotFolders({
    apply: true,
    rootFolderId: 'empty-drive-folder',
    client: {
      async listSubfoldersInFolder() {
        return [];
      },
      async listFilesInFolder(folderId) {
        assert.equal(folderId, 'empty-drive-folder');
        return [];
      },
      async getFileMetadata(fileId) {
        assert.equal(fileId, 'empty-drive-folder');
        return {
          drive_file_id: 'empty-drive-folder',
          file_name: 'Thehungerbrothers1@gmail.com Screenshots',
          mime_type: 'application/vnd.google-apps.folder',
          folder_id: '',
          web_url: ''
        };
      },
      async downloadFileContent() {
        return undefined;
      },
      async moveFileToFolder() {
        throw new Error('not used');
      },
      async findFolderByName() {
        return undefined;
      },
      async listFoldersByName() {
        return [];
      },
      async createFolderIfMissing() {
        throw new Error('not used');
      }
    }
  });

  assert.equal(report.reason, 'folder_empty');
  assert.equal(report.requested_root_folder_id, 'empty-drive-folder');
  assert.equal(report.root_folder_has_affiliate_email_token, true);
  assert.equal(report.affiliate_folders_found_count, 1);
  assert.equal(report.screenshots_found_count, 0);
  assert.equal(report.screenshots_processed_count, 0);
  assert.equal(report.affiliate_ledger_rows_written, 0);
});

test('affiliate screenshot folder processing reports when no valid email token folder is visible', async () => {
  const report = await processAffiliateScreenshotFolders({
    apply: true,
    localFolders: [
      {
        folderId: 'folder-unattributed',
        folderName: 'Screenshots',
        folderPath: 'Merlin OR Storage/Screenshots',
        files: [
          {
            fileId: 'unattributed-1',
            fileName: 'unattributed.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Unattributed Truck\nEmail: unattributed@example.com\nPhone: 504-111-2222'
          }
        ]
      }
    ]
  });

  assert.equal(report.reason, 'no_valid_email_token_folder_visible');
  assert.equal(report.affiliate_folders_found_count, 0);
  assert.equal(report.folders_scanned_count, 1);
  assert.equal(report.folder_paths_scanned_count, 1);
  assert.deepEqual(report.folder_names_scanned_sample, ['Screenshots']);
  assert.equal(report.folders_with_at_symbol_count, 0);
  assert.equal(report.files_without_attribution_count, 1);
  assert.equal(report.files_missing_parent_folder_metadata_count, 0);
  assert.equal(report.screenshots_processed_count, 0);
  assert.equal(readAffiliateTrackingLedgerRows().length, 0);
});
