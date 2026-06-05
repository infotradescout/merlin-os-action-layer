import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDriveAuthConfig, getDriveAuthProfile } from '../driveAuth.js';
import { getDriveClient, type DriveClient, type DriveFileInfo } from '../driveClient.js';
import { loadEnvFromDotFile } from '../env.js';
import { resolveAffiliateFolderAttributionFromPath } from '../mealscoutAffiliateFolderAttribution.js';
import { readAffiliateTrackingLedgerRows } from '../mealscoutAffiliateTrackingLedger.js';
import {
  processExistingScreenshotsIntoSeededProfiles,
  type MerlinExistingScreenshotSeedInput,
  type MerlinProfileSeedResult
} from './profileSeedRuntime.js';

export const AFFILIATE_SCREENSHOT_FOLDER_REPORT_FILE = 'merlin-affiliate-screenshot-folder-processing-report.txt';

const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif', 'pdf']);
const DEFAULT_SCAN_DEPTH = 4;

export type AffiliateScreenshotFolderFile = {
  fileId: string;
  fileName: string;
  mimeType?: string;
  parentFolderId?: string;
  parentFolderName?: string;
  modifiedTime?: string;
  webUrl?: string;
  extractedText?: string;
  visualLabels?: string[];
};

export type AffiliateScreenshotFolderInput = {
  folderId: string;
  folderName: string;
  folderPath?: string;
  files: AffiliateScreenshotFolderFile[];
};

export type AffiliateScreenshotFolderProcessingOptions = {
  apply: boolean;
  reportPath?: string;
  parentFolderId?: string;
  parentFolderPath?: string;
  maxDepth?: number;
  localFolders?: AffiliateScreenshotFolderInput[];
  client?: DriveClient;
};

export type AffiliateScreenshotFolderProcessingReport = {
  generated_at: string;
  mode: 'dry_run' | 'apply';
  status: 'ok' | 'disabled' | 'error';
  reason?: string;
  drive_scope_used: string;
  scanned_root_id: string;
  scanned_root_name: string;
  drive_scope_mode: string;
  auth_mode: string;
  discovery_mode: 'local_input' | 'drive_folder_walk';
  recursive_scan_enabled: boolean;
  folders_scanned_count: number;
  folder_paths_scanned_count: number;
  folder_names_scanned_sample: string[];
  folders_with_at_symbol_count: number;
  valid_affiliate_folder_names: string[];
  files_parent_folder_ids_sample: string[];
  files_parent_folder_names_sample: string[];
  affiliate_folders_found_count: number;
  screenshots_found_count: number;
  screenshots_processed_count: number;
  mealscout_created_count: number;
  mealscout_updated_count: number;
  tradescout_created_count: number;
  tradescout_updated_count: number;
  blocked_ambiguous_count: number;
  blocked_missing_identity_count: number;
  affiliate_ledger_rows_written: number;
  verification_email_sent_count: number;
  verification_email_failed_count: number;
  verification_email_not_available_count: number;
  folders_without_valid_email_count: number;
  files_without_attribution_count: number;
  files_missing_parent_folder_metadata_count: number;
  safety_confirmations: {
    email_verified_false: true;
    insurance_verified_false: true;
    claim_status_unclaimed: true;
    affiliate_folder_email_not_used_as_business_email: true;
    no_cleanup_delete_archive_suppress: true;
    no_payout_logic: true;
  };
  affiliate_folders: Array<{
    folder_id: string;
    folder_name: string;
    affiliate_attribution_email?: string;
    screenshot_count: number;
  }>;
  processed_results: MerlinProfileSeedResult[];
};

type DiscoveredFolder = {
  folderId: string;
  folderName: string;
  folderPath: string;
};

function isSupportedScreenshot(fileName: string, mimeType?: string): boolean {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (mime === 'application/pdf') return true;
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';
  return SUPPORTED_EXTENSIONS.has(extension);
}

function toLocalFile(file: DriveFileInfo): AffiliateScreenshotFolderFile {
  const metadata = file.raw_metadata || {};
  return {
    fileId: file.drive_file_id,
    fileName: file.file_name,
    mimeType: file.mime_type,
    parentFolderId: file.folder_id,
    modifiedTime: file.modified_time,
    webUrl: file.web_url,
    extractedText: typeof metadata.extracted_text === 'string' ? metadata.extracted_text : undefined,
    visualLabels: Array.isArray(metadata.visual_labels)
      ? metadata.visual_labels.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : undefined
  };
}

async function readFileText(client: DriveClient | undefined, file: AffiliateScreenshotFolderFile): Promise<string | undefined> {
  if (file.extractedText?.trim()) return file.extractedText;
  if (!client) return undefined;
  try {
    const text = await client.downloadFileContent(file.fileId);
    return text?.trim() ? text : undefined;
  } catch {
    return undefined;
  }
}

async function walkDriveFolders(input: {
  client: DriveClient;
  folderId: string;
  folderPath: string;
  depth: number;
  maxDepth: number;
  out: DiscoveredFolder[];
}): Promise<void> {
  if (input.depth > input.maxDepth || typeof input.client.listSubfoldersInFolder !== 'function') return;
  const children = await input.client.listSubfoldersInFolder(input.folderId);
  for (const child of children) {
    const folderPath = `${input.folderPath}/${child.name}`;
    const discovered = { folderId: child.id, folderName: child.name, folderPath };
    input.out.push(discovered);
    await walkDriveFolders({
      client: input.client,
      folderId: child.id,
      folderPath,
      depth: input.depth + 1,
      maxDepth: input.maxDepth,
      out: input.out
    });
  }
}

async function discoverFolders(options: AffiliateScreenshotFolderProcessingOptions): Promise<{
  status: 'ok' | 'disabled' | 'error';
  reason?: string;
  driveScopeUsed: string;
  scannedRootId: string;
  scannedRootName: string;
  driveScopeMode: string;
  authMode: string;
  discoveryMode: AffiliateScreenshotFolderProcessingReport['discovery_mode'];
  recursiveScanEnabled: boolean;
  folders: AffiliateScreenshotFolderInput[];
  client?: DriveClient;
}> {
  if (options.localFolders) {
    return {
      status: 'ok',
      driveScopeUsed: 'local_input',
      scannedRootId: 'local_input',
      scannedRootName: 'local_input',
      driveScopeMode: 'local_input',
      authMode: 'local_input',
      discoveryMode: 'local_input',
      recursiveScanEnabled: false,
      folders: options.localFolders
    };
  }

  const authConfig = getDriveAuthConfig();
  const profile = getDriveAuthProfile(authConfig);
  if (!options.client && !profile.ready) {
    return {
      status: 'disabled',
      reason: profile.reason || 'Drive is not configured',
      driveScopeUsed: 'drive_unavailable',
      scannedRootId: '',
      scannedRootName: '',
      driveScopeMode: authConfig.rootMode,
      authMode: authConfig.mode,
      discoveryMode: 'drive_folder_walk',
      recursiveScanEnabled: false,
      folders: []
    };
  }

  const client = options.client || getDriveClient(authConfig);
  if (typeof client.listSubfoldersInFolder !== 'function') {
    return {
      status: 'error',
      reason: 'Drive client does not support folder discovery',
      driveScopeUsed: 'drive_client_missing_list_subfolders',
      scannedRootId: '',
      scannedRootName: '',
      driveScopeMode: authConfig.rootMode,
      authMode: authConfig.mode,
      discoveryMode: 'drive_folder_walk',
      recursiveScanEnabled: false,
      folders: [],
      client
    };
  }

  let rootFolderId = options.parentFolderId || process.env.MERLIN_AFFILIATE_SCREENSHOT_PARENT_FOLDER_ID || authConfig.rootFolderId;
  let rootFolderPath = options.parentFolderPath || process.env.MERLIN_AFFILIATE_SCREENSHOT_PARENT_FOLDER_PATH || '';
  if (!rootFolderId) {
    rootFolderId = 'root';
    rootFolderPath = rootFolderPath || 'root';
  }
  if (!rootFolderPath) rootFolderPath = rootFolderId;
  const scannedRootName = rootFolderPath.split(/[\\/]+/).filter(Boolean).pop() || rootFolderPath;

  const discovered: DiscoveredFolder[] = [{ folderId: rootFolderId, folderName: rootFolderPath, folderPath: rootFolderPath }];
  await walkDriveFolders({
    client,
    folderId: rootFolderId,
    folderPath: rootFolderPath,
    depth: 1,
    maxDepth: options.maxDepth ?? Number(process.env.MERLIN_AFFILIATE_SCREENSHOT_FOLDER_SCAN_DEPTH || DEFAULT_SCAN_DEPTH),
    out: discovered
  });

  const folders: AffiliateScreenshotFolderInput[] = [];
  for (const folder of discovered) {
    const files = await client.listFilesInFolder(folder.folderId);
    folders.push({
      ...folder,
      files: files.map((file) => ({
        ...toLocalFile(file),
        parentFolderName: folder.folderName
      }))
    });
  }

  return {
    status: 'ok',
    driveScopeUsed: rootFolderPath,
    scannedRootId: rootFolderId,
    scannedRootName,
    driveScopeMode: authConfig.rootMode,
    authMode: authConfig.mode,
    discoveryMode: 'drive_folder_walk',
    recursiveScanEnabled: true,
    folders,
    client
  };
}

async function buildSeedInputs(input: {
  folders: AffiliateScreenshotFolderInput[];
  client?: DriveClient;
  generatedAt: string;
}): Promise<{
  seedInputs: MerlinExistingScreenshotSeedInput[];
  affiliateFolders: AffiliateScreenshotFolderProcessingReport['affiliate_folders'];
  screenshotsFoundCount: number;
  foldersWithoutValidEmailCount: number;
  filesWithoutAttributionCount: number;
  filesMissingParentFolderMetadataCount: number;
}> {
  const seedInputs: MerlinExistingScreenshotSeedInput[] = [];
  const affiliateFolders: AffiliateScreenshotFolderProcessingReport['affiliate_folders'] = [];
  let screenshotsFoundCount = 0;
  let foldersWithoutValidEmailCount = 0;
  let filesWithoutAttributionCount = 0;
  let filesMissingParentFolderMetadataCount = 0;

  for (const folder of input.folders) {
    const folderPath = folder.folderPath || folder.folderName;
    const attribution = resolveAffiliateFolderAttributionFromPath({ folderPath });
    const files = folder.files.filter((file) => isSupportedScreenshot(file.fileName, file.mimeType));
    if (files.length === 0) continue;
    screenshotsFoundCount += files.length;
    if (!folder.folderPath?.trim() && !folder.folderName?.trim()) {
      filesMissingParentFolderMetadataCount += files.length;
    }

    if (!attribution.affiliate_attribution_email) {
      foldersWithoutValidEmailCount += 1;
      filesWithoutAttributionCount += files.length;
      continue;
    }

    affiliateFolders.push({
      folder_id: folder.folderId,
      folder_name: folder.folderName,
      affiliate_attribution_email: attribution.affiliate_attribution_email,
      screenshot_count: files.length
    });

    for (const file of files) {
      const extractedText = await readFileText(input.client, file);
      seedInputs.push({
        fileId: file.fileId,
        fileName: file.fileName,
        drivePath: `${folderPath}/${file.fileName}`,
        sourceFolder: folderPath,
        sourceFolderId: folder.folderId,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        extractedText,
        visualLabels: file.visualLabels,
        sourceFileAttribution: {
          attributionSource: 'folder_context',
          attributionStatus: 'matched_affiliate_folder',
          sourceChannel: 'drive_upload',
          modifiedAt: file.modifiedTime,
          capturedAt: input.generatedAt,
          needsAttributionReview: false,
          ...attribution
        }
      });
    }
  }

  return {
    seedInputs,
    affiliateFolders,
    screenshotsFoundCount,
    foldersWithoutValidEmailCount,
    filesWithoutAttributionCount,
    filesMissingParentFolderMetadataCount
  };
}

function countResults(results: MerlinProfileSeedResult[]): Pick<
  AffiliateScreenshotFolderProcessingReport,
  | 'mealscout_created_count'
  | 'mealscout_updated_count'
  | 'tradescout_created_count'
  | 'tradescout_updated_count'
  | 'blocked_ambiguous_count'
  | 'blocked_missing_identity_count'
  | 'verification_email_sent_count'
  | 'verification_email_failed_count'
  | 'verification_email_not_available_count'
> {
  return {
    mealscout_created_count: results.filter((row) => row.brand_lane === 'MEALSCOUT' && row.profile_action === 'create').length,
    mealscout_updated_count: results.filter((row) => row.brand_lane === 'MEALSCOUT' && row.profile_action === 'update').length,
    tradescout_created_count: results.filter((row) => row.brand_lane === 'TRADESCOUT' && row.profile_action === 'create').length,
    tradescout_updated_count: results.filter((row) => row.brand_lane === 'TRADESCOUT' && row.profile_action === 'update').length,
    blocked_ambiguous_count: results.filter((row) => row.blockedReason === 'ambiguous_or_unsupported_brand').length,
    blocked_missing_identity_count: results.filter((row) => row.blockedReason === 'missing_required_identity').length,
    verification_email_sent_count: results.filter((row) => row.verification_email_status === 'sent').length,
    verification_email_failed_count: results.filter((row) => row.verification_email_status === 'failed').length,
    verification_email_not_available_count: results.filter((row) => row.verification_email_status === 'not_available').length
  };
}

export async function processAffiliateScreenshotFolders(
  options: AffiliateScreenshotFolderProcessingOptions
): Promise<AffiliateScreenshotFolderProcessingReport> {
  const generatedAt = new Date().toISOString();
  const discovery = await discoverFolders(options);
  const built = await buildSeedInputs({
    folders: discovery.folders,
    client: discovery.client || options.client,
    generatedAt
  });
  const ledgerBefore = readAffiliateTrackingLedgerRows().length;
  let results: MerlinProfileSeedResult[] = [];
  if (options.apply && discovery.status === 'ok' && built.seedInputs.length > 0) {
    const processed = await processExistingScreenshotsIntoSeededProfiles({ screenshots: built.seedInputs });
    results = processed.results;
  }
  const ledgerAfter = readAffiliateTrackingLedgerRows().length;
  const counts = countResults(results);
  const validAffiliateFolderNames = built.affiliateFolders.map((folder) => folder.folder_name);
  const folderNamesScanned = discovery.folders.map((folder) => folder.folderName).filter((name) => name.trim().length > 0);
  const fileParentFolderIds = discovery.folders
    .flatMap((folder) => folder.files.map((file) => file.parentFolderId || folder.folderId))
    .filter((value) => value.trim().length > 0);
  const fileParentFolderNames = discovery.folders
    .flatMap((folder) => folder.files.map((file) => file.parentFolderName || folder.folderName))
    .filter((value) => value.trim().length > 0);
  const reason =
    discovery.reason ||
    (discovery.status === 'ok' && built.affiliateFolders.length === 0
      ? 'no_valid_email_token_folder_visible'
      : undefined);
  const report: AffiliateScreenshotFolderProcessingReport = {
    generated_at: generatedAt,
    mode: options.apply ? 'apply' : 'dry_run',
    status: discovery.status,
    reason,
    drive_scope_used: discovery.driveScopeUsed,
    scanned_root_id: discovery.scannedRootId,
    scanned_root_name: discovery.scannedRootName,
    drive_scope_mode: discovery.driveScopeMode,
    auth_mode: discovery.authMode,
    discovery_mode: discovery.discoveryMode,
    recursive_scan_enabled: discovery.recursiveScanEnabled,
    folders_scanned_count: discovery.folders.length,
    folder_paths_scanned_count: discovery.folders.filter((folder) => (folder.folderPath || folder.folderName).trim().length > 0).length,
    folder_names_scanned_sample: folderNamesScanned.slice(0, 20),
    folders_with_at_symbol_count: folderNamesScanned.filter((name) => name.includes('@')).length,
    valid_affiliate_folder_names: validAffiliateFolderNames,
    files_parent_folder_ids_sample: Array.from(new Set(fileParentFolderIds)).slice(0, 20),
    files_parent_folder_names_sample: Array.from(new Set(fileParentFolderNames)).slice(0, 20),
    affiliate_folders_found_count: built.affiliateFolders.length,
    screenshots_found_count: built.screenshotsFoundCount,
    screenshots_processed_count: results.length,
    ...counts,
    affiliate_ledger_rows_written: options.apply ? Math.max(0, ledgerAfter - ledgerBefore) : 0,
    folders_without_valid_email_count: built.foldersWithoutValidEmailCount,
    files_without_attribution_count: built.filesWithoutAttributionCount,
    files_missing_parent_folder_metadata_count: built.filesMissingParentFolderMetadataCount,
    safety_confirmations: {
      email_verified_false: true,
      insurance_verified_false: true,
      claim_status_unclaimed: true,
      affiliate_folder_email_not_used_as_business_email: true,
      no_cleanup_delete_archive_suppress: true,
      no_payout_logic: true
    },
    affiliate_folders: built.affiliateFolders,
    processed_results: results
  };
  if (options.reportPath) {
    writeFileSync(options.reportPath, renderAffiliateScreenshotFolderProcessingReport(report), 'utf8');
  }
  return report;
}

export function renderAffiliateScreenshotFolderProcessingReport(report: AffiliateScreenshotFolderProcessingReport): string {
  const lines = [
    'Merlin affiliate screenshot folder processing report',
    '',
    `generated_at: ${report.generated_at}`,
    `mode: ${report.mode}`,
    `status: ${report.status}`,
    `reason: ${report.reason || ''}`,
    `drive_scope_used: ${report.drive_scope_used}`,
    `scanned_root_id: ${report.scanned_root_id}`,
    `scanned_root_name: ${report.scanned_root_name}`,
    `drive_scope_mode: ${report.drive_scope_mode}`,
    `auth_mode: ${report.auth_mode}`,
    `discovery_mode: ${report.discovery_mode}`,
    `recursive_scan_enabled: ${report.recursive_scan_enabled}`,
    `folders_scanned_count: ${report.folders_scanned_count}`,
    `folder_paths_scanned_count: ${report.folder_paths_scanned_count}`,
    `folder_names_scanned_sample: ${report.folder_names_scanned_sample.join(', ')}`,
    `folders_with_at_symbol_count: ${report.folders_with_at_symbol_count}`,
    `valid_affiliate_folder_names: ${report.valid_affiliate_folder_names.join(', ')}`,
    `files_parent_folder_ids_sample: ${report.files_parent_folder_ids_sample.join(', ')}`,
    `files_parent_folder_names_sample: ${report.files_parent_folder_names_sample.join(', ')}`,
    `affiliate_folders_found_count: ${report.affiliate_folders_found_count}`,
    `screenshots_found_count: ${report.screenshots_found_count}`,
    `screenshots_processed_count: ${report.screenshots_processed_count}`,
    `mealscout_created_count: ${report.mealscout_created_count}`,
    `mealscout_updated_count: ${report.mealscout_updated_count}`,
    `tradescout_created_count: ${report.tradescout_created_count}`,
    `tradescout_updated_count: ${report.tradescout_updated_count}`,
    `blocked_ambiguous_count: ${report.blocked_ambiguous_count}`,
    `blocked_missing_identity_count: ${report.blocked_missing_identity_count}`,
    `affiliate_ledger_rows_written: ${report.affiliate_ledger_rows_written}`,
    `verification_email_sent_count: ${report.verification_email_sent_count}`,
    `verification_email_failed_count: ${report.verification_email_failed_count}`,
    `verification_email_not_available_count: ${report.verification_email_not_available_count}`,
    `folders_without_valid_email_count: ${report.folders_without_valid_email_count}`,
    `files_without_attribution_count: ${report.files_without_attribution_count}`,
    `files_missing_parent_folder_metadata_count: ${report.files_missing_parent_folder_metadata_count}`,
    '',
    'safety_confirmations:',
    '- email_verified false',
    '- insurance_verified false',
    '- claim_status unclaimed',
    '- affiliate folder email not used as business email',
    '- no cleanup/delete/archive/suppress',
    '- no payout logic',
    '',
    'affiliate_folders:'
  ];
  for (const folder of report.affiliate_folders) {
    lines.push(`- ${folder.folder_name} | ${folder.affiliate_attribution_email || ''} | screenshots=${folder.screenshot_count}`);
  }
  lines.push('', 'processed_results:');
  for (const result of report.processed_results) {
    lines.push(
      `- ${result.sourceFileId} | ${result.sourceFileName} | ${result.brand_lane || ''} | ${result.seed_status} | ${result.profile_action || ''} | ${result.profile_email || ''} | ${result.verification_email_status} | ${result.blockedReason || ''}`
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv: string[]): AffiliateScreenshotFolderProcessingOptions & { inputPath?: string } {
  const parsed: AffiliateScreenshotFolderProcessingOptions & { inputPath?: string } = {
    apply: false,
    reportPath: resolve(process.cwd(), AFFILIATE_SCREENSHOT_FOLDER_REPORT_FILE)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--input') parsed.inputPath = argv[++index];
    else if (arg === '--report') parsed.reportPath = resolve(process.cwd(), argv[++index] || AFFILIATE_SCREENSHOT_FOLDER_REPORT_FILE);
    else if (arg === '--parent-folder-id') parsed.parentFolderId = argv[++index];
    else if (arg === '--parent-folder-path') parsed.parentFolderPath = argv[++index];
    else if (arg === '--max-depth') parsed.maxDepth = Number(argv[++index]);
  }
  return parsed;
}

function readLocalFolders(inputPath: string | undefined): AffiliateScreenshotFolderInput[] | undefined {
  if (!inputPath) return undefined;
  const parsed = JSON.parse(readFileSync(resolve(process.cwd(), inputPath), 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { folders?: unknown }).folders)) {
    throw new Error('Local input must be a JSON object with a folders array');
  }
  return (parsed as { folders: AffiliateScreenshotFolderInput[] }).folders;
}

async function main(): Promise<void> {
  loadEnvFromDotFile();
  const args = parseArgs(process.argv.slice(2));
  const report = await processAffiliateScreenshotFolders({
    ...args,
    localFolders: readLocalFolders(args.inputPath)
  });
  process.stdout.write(renderAffiliateScreenshotFolderProcessingReport(report));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath || invokedPath.endsWith('affiliateScreenshotFolderProcessing.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'affiliate screenshot folder processing failed');
    process.exitCode = 1;
  });
}
