import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDriveAuthConfig, getDriveAuthProfile } from '../driveAuth.js';
import { getDriveClient, type DriveClient, type DriveFileInfo, type DriveFolderInfo } from '../driveClient.js';
import { parseDriveManagerConfig } from '../driveManager.js';
import { resolveAffiliateFolderAttributionFromPath } from '../mealscoutAffiliateFolderAttribution.js';
import {
  processExistingScreenshotsIntoSeededProfiles,
  type MerlinExistingScreenshotSeedInput,
  type MerlinProfileSeedResult
} from './profileSeedRuntime.js';

const DEFAULT_REPORT_FILE = 'merlin-affiliate-screenshot-folder-processing-report.txt';
const SUPPORTED_SCREENSHOT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.heif', '.pdf']);
const SUPPORTED_SCREENSHOT_MIMES = new Set(['application/pdf']);

export type AffiliateScreenshotFolderProcessingFile = {
  fileId: string;
  fileName: string;
  mimeType?: string;
  modifiedTime?: string;
  webUrl?: string;
  extractedText?: string;
  visualLabels?: string[];
};

export type AffiliateScreenshotFolderProcessingFolder = {
  folderId: string;
  folderName: string;
  folderPath?: string;
  files: AffiliateScreenshotFolderProcessingFile[];
};

export type AffiliateScreenshotFolderProcessingOptions = {
  apply: boolean;
  reportPath?: string;
  parentFolderId?: string;
  parentFolderPath?: string;
  localFolders?: AffiliateScreenshotFolderProcessingFolder[];
  client?: DriveClient;
};

export type AffiliateScreenshotFolderProcessingReport = {
  generated_at: string;
  mode: 'dry_run' | 'apply';
  status: 'ok' | 'disabled' | 'error';
  reason?: string;
  drive_scope_used: string;
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
  safety_confirmations: {
    email_verified_false: true;
    insurance_verified_false: true;
    claim_status_unclaimed: true;
    affiliate_folder_email_not_used_as_business_email: true;
    no_cleanup_delete_archive_suppress: true;
    no_payout_logic: true;
  };
  discovered_affiliate_folders: Array<{
    folder_id: string;
    folder_name: string;
    affiliate_attribution_email?: string;
    screenshot_count: number;
  }>;
  processed_results: MerlinProfileSeedResult[];
};

type ResolvedFolder = AffiliateScreenshotFolderProcessingFolder & {
  affiliate_attribution_email?: string;
};

function isSupportedScreenshotFile(fileName: string, mimeType: string | undefined): boolean {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (SUPPORTED_SCREENSHOT_MIMES.has(mime)) return true;
  const dotIndex = fileName.lastIndexOf('.');
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
  return SUPPORTED_SCREENSHOT_EXTENSIONS.has(extension);
}

function normalizeFolderPath(parentPath: string | undefined, folderName: string): string {
  const safeParent = (parentPath || '').replace(/[\\/]+$/g, '').trim();
  return safeParent ? `${safeParent}/${folderName}` : folderName;
}

function toDriveFile(folder: DriveFolderInfo, file: DriveFileInfo): AffiliateScreenshotFolderProcessingFile {
  const metadata = file.raw_metadata || {};
  return {
    fileId: file.drive_file_id,
    fileName: file.file_name,
    mimeType: file.mime_type,
    modifiedTime: file.modified_time,
    webUrl: file.web_url,
    extractedText: typeof metadata.extracted_text === 'string' ? metadata.extracted_text : undefined,
    visualLabels: Array.isArray(metadata.visual_labels)
      ? metadata.visual_labels.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : undefined
  };
}

async function readFileText(client: DriveClient | undefined, file: AffiliateScreenshotFolderProcessingFile): Promise<string | undefined> {
  if (file.extractedText?.trim()) return file.extractedText;
  if (!client) return undefined;
  try {
    const text = await client.downloadFileContent(file.fileId);
    return text?.trim() ? text : undefined;
  } catch {
    return undefined;
  }
}

async function discoverDriveFolders(options: AffiliateScreenshotFolderProcessingOptions): Promise<{
  status: 'ok' | 'disabled' | 'error';
  reason?: string;
  driveScopeUsed: string;
  folders: AffiliateScreenshotFolderProcessingFolder[];
}> {
  if (options.localFolders) {
    return {
      status: 'ok',
      driveScopeUsed: 'local_input',
      folders: options.localFolders
    };
  }

  const authConfig = getDriveAuthConfig();
  const profile = getDriveAuthProfile(authConfig);
  if (!profile.ready) {
    return {
      status: 'disabled',
      reason: profile.reason || 'Drive is not configured',
      driveScopeUsed: 'drive_unavailable',
      folders: []
    };
  }

  const client = options.client || getDriveClient(authConfig);
  if (typeof client.listSubfoldersInFolder !== 'function') {
    return {
      status: 'error',
      reason: 'Drive client does not support folder discovery',
      driveScopeUsed: 'drive_client_missing_list_subfolders',
      folders: []
    };
  }

  const configuredParentId =
    options.parentFolderId ||
    process.env.MERLIN_AFFILIATE_SCREENSHOT_PARENT_FOLDER_ID ||
    authConfig.rootFolderId;
  const driveConfig = parseDriveManagerConfig();
  let parentFolderId = configuredParentId || 'root';
  let parentFolderPath = options.parentFolderPath || process.env.MERLIN_AFFILIATE_SCREENSHOT_PARENT_FOLDER_PATH || driveConfig.rootFolderName;

  if (!configuredParentId) {
    const rootFolder = await client.findFolderByName(driveConfig.rootFolderName, 'root');
    if (rootFolder) {
      parentFolderId = rootFolder.id;
      parentFolderPath = rootFolder.name;
    } else {
      parentFolderPath = 'root';
    }
  }

  const subfolders = await client.listSubfoldersInFolder(parentFolderId);
  const folders: AffiliateScreenshotFolderProcessingFolder[] = [];
  for (const folder of subfolders) {
    const files = await client.listFilesInFolder(folder.id);
    folders.push({
      folderId: folder.id,
      folderName: folder.name,
      folderPath: normalizeFolderPath(parentFolderPath, folder.name),
      files: files.map((file) => toDriveFile(folder, file))
    });
  }

  return {
    status: 'ok',
    driveScopeUsed: parentFolderPath,
    folders
  };
}

async function buildSeedInputs(input: {
  folders: AffiliateScreenshotFolderProcessingFolder[];
  client?: DriveClient;
  generatedAt: string;
}): Promise<{
  resolvedFolders: ResolvedFolder[];
  seedInputs: MerlinExistingScreenshotSeedInput[];
  screenshotsFoundCount: number;
  foldersWithoutValidEmailCount: number;
  filesWithoutAttributionCount: number;
}> {
  const seedInputs: MerlinExistingScreenshotSeedInput[] = [];
  const resolvedFolders: ResolvedFolder[] = [];
  let screenshotsFoundCount = 0;
  let filesWithoutAttributionCount = 0;
  let foldersWithoutValidEmailCount = 0;

  for (const folder of input.folders) {
    const folderPath = folder.folderPath || folder.folderName;
    const attribution = resolveAffiliateFolderAttributionFromPath({ folderPath });
    const affiliateEmail = attribution.affiliate_attribution_email;
    const supportedFiles = folder.files.filter((file) => isSupportedScreenshotFile(file.fileName, file.mimeType));
    screenshotsFoundCount += supportedFiles.length;
    if (!affiliateEmail) {
      foldersWithoutValidEmailCount += 1;
      filesWithoutAttributionCount += supportedFiles.length;
      resolvedFolders.push({ ...folder, files: supportedFiles });
      continue;
    }

    resolvedFolders.push({ ...folder, files: supportedFiles, affiliate_attribution_email: affiliateEmail });
    for (const file of supportedFiles) {
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
    resolvedFolders,
    seedInputs,
    screenshotsFoundCount,
    foldersWithoutValidEmailCount,
    filesWithoutAttributionCount
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
  const discovery = await discoverDriveFolders(options);
  const built = await buildSeedInputs({
    folders: discovery.folders,
    client: options.client,
    generatedAt
  });

  let results: MerlinProfileSeedResult[] = [];
  if (options.apply && discovery.status === 'ok' && built.seedInputs.length > 0) {
    const processed = await processExistingScreenshotsIntoSeededProfiles({ screenshots: built.seedInputs });
    results = processed.results;
  }

  const resultCounts = countResults(results);
  const report: AffiliateScreenshotFolderProcessingReport = {
    generated_at: generatedAt,
    mode: options.apply ? 'apply' : 'dry_run',
    status: discovery.status,
    reason: discovery.reason,
    drive_scope_used: discovery.driveScopeUsed,
    affiliate_folders_found_count: built.resolvedFolders.filter((folder) => folder.affiliate_attribution_email).length,
    screenshots_found_count: built.screenshotsFoundCount,
    screenshots_processed_count: results.length,
    ...resultCounts,
    affiliate_ledger_rows_written: options.apply
      ? results.filter((result) => built.seedInputs.some((seed) => seed.fileId === result.sourceFileId && seed.sourceFileAttribution?.affiliate_attribution_email)).length
      : 0,
    folders_without_valid_email_count: built.foldersWithoutValidEmailCount,
    files_without_attribution_count: built.filesWithoutAttributionCount,
    safety_confirmations: {
      email_verified_false: true,
      insurance_verified_false: true,
      claim_status_unclaimed: true,
      affiliate_folder_email_not_used_as_business_email: true,
      no_cleanup_delete_archive_suppress: true,
      no_payout_logic: true
    },
    discovered_affiliate_folders: built.resolvedFolders.map((folder) => ({
      folder_id: folder.folderId,
      folder_name: folder.folderName,
      affiliate_attribution_email: folder.affiliate_attribution_email,
      screenshot_count: folder.files.length
    })),
    processed_results: results
  };

  if (options.reportPath) {
    writeFileSync(options.reportPath, renderAffiliateScreenshotFolderProcessingReport(report), 'utf8');
  }
  return report;
}

export function renderAffiliateScreenshotFolderProcessingReport(report: AffiliateScreenshotFolderProcessingReport): string {
  const lines = [
    'Merlin Affiliate Screenshot Folder Processing Report',
    '',
    `generated_at: ${report.generated_at}`,
    `mode: ${report.mode}`,
    `status: ${report.status}`,
    `reason: ${report.reason || ''}`,
    `drive_scope_used: ${report.drive_scope_used}`,
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
    '',
    'safety_confirmations:',
    '- email_verified false',
    '- insurance_verified false',
    '- claim_status unclaimed',
    '- affiliate folder email not used as business email',
    '- no cleanup/delete/archive/suppress',
    '- no payout logic',
    '',
    'discovered_affiliate_folders:'
  ];

  for (const folder of report.discovered_affiliate_folders) {
    lines.push(
      `- folder_id=${folder.folder_id} folder_name="${folder.folder_name}" affiliate_attribution_email=${folder.affiliate_attribution_email || ''} screenshot_count=${folder.screenshot_count}`
    );
  }
  lines.push('', 'processed_results:');
  for (const result of report.processed_results) {
    lines.push(
      `- source_file_id=${result.sourceFileId} brand_lane=${result.brand_lane || ''} seed_status=${result.seed_status} profile_action=${result.profile_action || ''} profile_email=${result.profile_email || ''} verification_email_status=${result.verification_email_status} blocked_reason=${result.blockedReason || ''}`
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv: string[]): {
  apply: boolean;
  inputPath?: string;
  reportPath: string;
  parentFolderId?: string;
  parentFolderPath?: string;
} {
  const parsed = {
    apply: false,
    inputPath: undefined as string | undefined,
    reportPath: DEFAULT_REPORT_FILE,
    parentFolderId: undefined as string | undefined,
    parentFolderPath: undefined as string | undefined
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--input') parsed.inputPath = argv[++index];
    else if (arg === '--report') parsed.reportPath = argv[++index] || DEFAULT_REPORT_FILE;
    else if (arg === '--parent-folder-id') parsed.parentFolderId = argv[++index];
    else if (arg === '--parent-folder-path') parsed.parentFolderPath = argv[++index];
  }
  return parsed;
}

function readLocalFolders(inputPath: string | undefined): AffiliateScreenshotFolderProcessingFolder[] | undefined {
  if (!inputPath) return undefined;
  const parsed = JSON.parse(readFileSync(resolve(process.cwd(), inputPath), 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { folders?: unknown }).folders)) {
    throw new Error('Local input must be a JSON object with a folders array');
  }
  return (parsed as { folders: AffiliateScreenshotFolderProcessingFolder[] }).folders;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await processAffiliateScreenshotFolders({
    apply: args.apply,
    reportPath: resolve(process.cwd(), args.reportPath),
    parentFolderId: args.parentFolderId,
    parentFolderPath: args.parentFolderPath,
    localFolders: readLocalFolders(args.inputPath)
  });
  process.stdout.write(renderAffiliateScreenshotFolderProcessingReport(report));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath && (invokedPath === modulePath || invokedPath.endsWith('affiliateScreenshotFolderProcessing.ts'))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'affiliate screenshot folder processing failed');
    process.exitCode = 1;
  });
}

export function runAffiliateScreenshotFolderProcessingScript(args: string[]): string {
  return execFileSync(process.execPath, [
    resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    'src/merlin/affiliateScreenshotFolderProcessing.ts',
    ...args
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}
