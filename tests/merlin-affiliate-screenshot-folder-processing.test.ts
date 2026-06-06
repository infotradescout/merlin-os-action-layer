import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, test } from 'node:test';

process.env.MERLIN_RUNTIME = 'test';
process.env.MEALSCOUT_AFFILIATE_TRACKING_LEDGER_PATH = join(tmpdir(), 'merlin-affiliate-screenshot-folder-processing-ledger-test.csv');

const { preflightAffiliateScreenshotFolders, processAffiliateScreenshotFolders } = await import('../src/merlin/affiliateScreenshotFolderProcessing.ts');
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
  assert.equal(report.screenshots_processed_count, 4);
  assert.equal(report.affiliate_attributed_screenshots_count, 3);
  assert.equal(report.admin_flow_screenshots_count, 1);
  assert.equal(report.mealscout_created_count, 1);
  assert.equal(report.tradescout_created_count, 1);
  assert.equal(report.blocked_ambiguous_count, 2);
  assert.equal(report.folders_without_valid_email_count, 1);
  assert.equal(report.files_without_attribution_count, 1);
  assert.equal(report.admin_flow_profiles_created_count, 0);
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

test('affiliate screenshot folder preflight is read-only and reports valid affiliate folders', async () => {
  const report = await preflightAffiliateScreenshotFolders({
    apply: true,
    rootFolderId: 'shared-parent-folder',
    client: {
      async listSubfoldersInFolder(folderId) {
        if (folderId === 'shared-parent-folder') {
          return [
            { id: 'affiliate-child-folder', name: 'Thehungerbrothers1@gmail.com Screenshots' },
            { id: 'plain-child-folder', name: 'Screenshots' }
          ];
        }
        return [];
      },
      async listFilesInFolder(folderId) {
        if (folderId === 'affiliate-child-folder') {
          return [
            {
              drive_file_id: 'affiliate-screenshot-1',
              file_name: 'affiliate-screenshot.jpg',
              mime_type: 'image/jpeg',
              folder_id: 'affiliate-child-folder',
              web_url: ''
            }
          ];
        }
        if (folderId === 'shared-parent-folder') {
          return [
            {
              drive_file_id: 'loose-screenshot-1',
              file_name: 'loose-screenshot.png',
              mime_type: 'image/png',
              folder_id: 'shared-parent-folder',
              web_url: ''
            }
          ];
        }
        return [];
      },
      async getFileMetadata(fileId) {
        assert.equal(fileId, 'shared-parent-folder');
        return {
          drive_file_id: 'shared-parent-folder',
          file_name: 'MealScout screenshot',
          mime_type: 'application/vnd.google-apps.folder',
          folder_id: '',
          web_url: ''
        };
      },
      async downloadFileContent() {
        throw new Error('preflight must not download file content');
      },
      async moveFileToFolder() {
        throw new Error('preflight must not move Drive files');
      },
      async trashFile() {
        throw new Error('preflight must not trash Drive files');
      },
      async findFolderByName() {
        return undefined;
      },
      async listFoldersByName() {
        return [];
      },
      async createFolderIfMissing() {
        throw new Error('preflight must not create Drive folders');
      }
    }
  });

  assert.equal(report.status, 'ok');
  assert.equal(report.requested_root_folder_id, 'shared-parent-folder');
  assert.equal(report.effective_root_folder_name, 'MealScout screenshot');
  assert.equal(report.folder_metadata_accessible, true);
  assert.equal(report.folders_scanned_count, 3);
  assert.equal(report.child_folder_count, 2);
  assert.deepEqual(report.child_folder_names_sample, ['Thehungerbrothers1@gmail.com Screenshots', 'Screenshots']);
  assert.equal(report.folders_with_at_symbol_count, 1);
  assert.deepEqual(report.valid_affiliate_folder_names, ['Thehungerbrothers1@gmail.com Screenshots']);
  assert.equal(report.screenshots_found_count, 2);
  assert.equal(report.affiliate_attributed_screenshots_count, 1);
  assert.equal(report.admin_flow_screenshots_count, 1);
  assert.equal(report.screenshots_inside_affiliate_folders_count, 1);
  assert.equal(report.loose_unattributed_screenshots_count, 1);
  assert.deepEqual(report.mutation_methods_invoked, []);
  assert.equal(readAffiliateTrackingLedgerRows().length, 0);
  assert.equal(listMealScoutTrucks().length, 0);
  assert.deepEqual(listVerificationEmailRecords(), []);
});

test('affiliate screenshot folder processing treats loose screenshots as admin flow without affiliate credit', async () => {
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
            extractedText: 'Admin Flow Food Truck\nEmail: admin-flow@example.com\nPhone: 504-111-2222\nMenu: Gumbo $8'
          }
        ]
      }
    ]
  });

  assert.equal(report.reason, undefined);
  assert.equal(report.affiliate_folders_found_count, 0);
  assert.equal(report.affiliate_attributed_screenshots_count, 0);
  assert.equal(report.admin_flow_screenshots_count, 1);
  assert.equal(report.loose_unattributed_screenshots_count, 1);
  assert.equal(report.folders_scanned_count, 1);
  assert.equal(report.folder_paths_scanned_count, 1);
  assert.deepEqual(report.folder_names_scanned_sample, ['Screenshots']);
  assert.equal(report.folders_with_at_symbol_count, 0);
  assert.equal(report.files_without_attribution_count, 1);
  assert.equal(report.files_missing_parent_folder_metadata_count, 0);
  assert.equal(report.screenshots_processed_count, 1);
  assert.equal(report.mealscout_created_count, 1);
  assert.equal(report.admin_flow_profiles_created_count, 1);
  assert.equal(report.affiliate_ledger_rows_written, 0);
  assert.equal(readAffiliateTrackingLedgerRows().length, 0);
  const recipients = listVerificationEmailRecords().map((row) => row.recipient_email);
  assert.deepEqual(recipients, ['admin-flow@example.com']);
});

test('affiliate screenshot folder processing max-files caps selected eligible screenshots', async () => {
  const report = await processAffiliateScreenshotFolders({
    apply: true,
    maxFiles: 2,
    localFolders: [
      {
        folderId: 'admin-folder',
        folderName: 'Screenshots',
        folderPath: 'MealScout screenshot/Screenshots',
        files: [
          {
            fileId: 'admin-1',
            fileName: 'admin-1.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Admin One Food Truck\nEmail: admin-one@example.com\nPhone: 504-111-2222\nMenu: Gumbo $8'
          },
          {
            fileId: 'admin-2',
            fileName: 'admin-2.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Admin Two Food Truck\nEmail: admin-two@example.com\nPhone: 504-222-3333\nMenu: Tacos $4'
          },
          {
            fileId: 'admin-3',
            fileName: 'admin-3.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Admin Three Food Truck\nEmail: admin-three@example.com\nPhone: 504-333-4444\nMenu: BBQ $10'
          }
        ]
      }
    ]
  });

  assert.equal(report.max_files_requested, 2);
  assert.equal(report.screenshots_eligible_count, 3);
  assert.equal(report.screenshots_selected_count, 2);
  assert.equal(report.screenshots_skipped_due_to_cap, 1);
  assert.equal(report.screenshots_processed_count, 2);
  assert.equal(report.admin_flow_profiles_created_count, 2);
  assert.equal(report.affiliate_ledger_rows_written, 0);
  const recipients = listVerificationEmailRecords().map((row) => row.recipient_email).sort();
  assert.deepEqual(recipients, ['admin-one@example.com', 'admin-two@example.com']);
});

test('affiliate screenshot folder processing exports seeded profile handoff bundle when requested', async () => {
  const exportPath = join(tmpdir(), `merlin-profile-seed-export-${Date.now()}.json`);
  const report = await processAffiliateScreenshotFolders({
    apply: true,
    maxFiles: 5,
    exportProfileSeedsPath: exportPath,
    localFolders: [
      {
        folderId: 'admin-folder',
        folderName: 'Screenshots',
        folderPath: 'MealScout screenshot/Screenshots',
        files: [
          {
            fileId: 'admin-export-1',
            fileName: 'admin-export-1.jpg',
            mimeType: 'image/jpeg',
            extractedText:
              'Export One Food Truck\nEmail: export-one@example.com\nPhone: 504-555-2222\nWebsite: www.export-one.example\nInstagram: @exportone\nMenu: Gumbo $8'
          },
          {
            fileId: 'admin-export-2',
            fileName: 'admin-export-2.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Export Two Food Truck\nPhone: 504-222-3333\nMenu: Tacos $4'
          },
          {
            fileId: 'admin-export-blocked',
            fileName: 'admin-export-blocked.jpg',
            mimeType: 'image/jpeg',
            extractedText: 'Random image without enough business identity'
          },
          {
            fileId: 'admin-export-invalid-extraction',
            fileName: 'admin-export-invalid-extraction.jpg',
            mimeType: 'image/jpeg',
            extractedText:
              'eee\nEmail: www.theflaminpepper@yahoo.com\nPhone: 228-372-4071\nWebsite: www.theflaminpepper@yahoo.com\nInstagram: @yahoo.com\nMenu: Loaded fries $8'
          },
          {
            fileId: 'admin-export-review-needed',
            fileName: 'admin-export-review-needed.jpg',
            mimeType: 'image/jpeg',
            extractedText:
              'MANN Kettle Corn 2\nEmail: Mannkettlecorn@gmail.com\nPhone: 228-623-9469\nInstagram: @gmail.com\nCity: Moss Point, MS\nMenu: Kettle corn bag $6'
          }
        ]
      }
    ]
  });

  assert.equal(report.screenshots_processed_count, 5);
  assert.equal(report.mealscout_created_count, 4);
  assert.equal(report.blocked_ambiguous_count, 1);
  assert.equal(existsSync(exportPath), true);

  const exported = JSON.parse(readFileSync(exportPath, 'utf8')) as Array<Record<string, unknown>>;
  assert.equal(exported.length, 4);
  const first = exported.find((row) => row.source_file_id === 'admin-export-1');
  assert.ok(first);
  assert.equal(first.export_schema_version, 'merlin_profile_seed_export_v1');
  assert.equal(first.brand_lane, 'MEALSCOUT');
  assert.equal(first.target_profile_type, 'food_truck');
  assert.equal(first.profile_action, 'create');
  assert.equal(first.profile_name, 'Export One Food Truck');
  assert.equal(first.profile_email, 'export-one@example.com');
  assert.equal(first.phone, '504-555-2222');
  assert.equal(first.website, 'www.export-one.example');
  assert.equal((first.socials as { instagram?: string }).instagram, '@exportone');
  assert.equal(first.source_file_id, 'admin-export-1');
  assert.equal(first.source_file_name, 'admin-export-1.jpg');
  assert.equal(first.source_file_path, 'MealScout screenshot/Screenshots/admin-export-1.jpg');
  assert.deepEqual(first.source_refs, ['admin-export-1']);
  assert.equal(typeof first.extracted_fields, 'object');
  assert.equal(first.seeded_from_evidence, true);
  assert.equal(first.profile_origin, 'auto_onboarded');
  assert.equal(first.onboarding_source, 'admin_seed');
  assert.equal(first.claim_status, 'unclaimed');
  assert.equal(first.email_verified, false);
  assert.equal(first.insurance_verified, false);
  assert.equal(first.owner_user_id, null);
  assert.equal(first.attribution_method, 'admin_unattributed');
  assert.equal(first.submission_flow, 'admin');
  assert.equal('affiliate_attribution_email' in first, false);
  assert.equal(first.verification_email_status, 'sent');
  assert.equal(Array.isArray(first.safety_notes), true);
  assert.equal(first.import_decision, 'importable');

  const invalid = exported.find((row) => row.source_file_id === 'admin-export-invalid-extraction');
  assert.ok(invalid);
  assert.equal(invalid.import_decision, 'blocked');
  assert.equal(invalid.blocked_reason, 'invalid_extraction_identity');
  assert.equal(invalid.profile_name, 'eee');
  assert.equal(invalid.website, null);
  assert.equal((invalid.socials as { instagram?: string | null }).instagram, null);
  assert.deepEqual(
    invalid.normalized_fields,
    ['website_dropped_email_like', 'instagram_dropped_email_domain_like']
  );

  const review = exported.find((row) => row.source_file_id === 'admin-export-review-needed');
  assert.ok(review);
  assert.equal(review.import_decision, 'review_required');
  assert.equal(review.profile_name, 'MANN Kettle Corn');
  assert.equal(review.profile_email, 'mannkettlecorn@gmail.com');
  assert.equal((review.socials as { instagram?: string | null }).instagram, null);
  assert.deepEqual(
    review.normalized_fields,
    ['profile_name', 'instagram_dropped_email_domain_like']
  );
  assert.deepEqual(review.review_reasons, ['profile_name_trailing_numeric_suffix']);
});
