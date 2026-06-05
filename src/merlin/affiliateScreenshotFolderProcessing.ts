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
  preflightOnly?: boolean;
  reportPath?: string;
  rootFolderId?: string;
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
  requested_root_folder_id: string;
  effective_root_folder_id: string;
  effective_root_folder_name: string;
  root_folder_has_affiliate_email_token: boolean;
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
  affiliate_attributed_screenshots_count: number;
  admin_flow_screenshots_count: number;
  loose_unattributed_screenshots_count: number;
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
  admin_flow_profiles_created_count: number;
  admin_flow_profiles_updated_count: number;
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

export type AffiliateScreenshotFolderPreflightReport = {
  generated_at: string;
  status: 'ok' | 'blocked' | 'error';
  reason?: string;
  requested_root_folder_id: string;
  effective_root_folder_id: string;
  effective_root_folder_name: string;
  auth_mode: string;
  drive_scope_mode: string;
  folder_metadata_accessible: boolean;
  recursive_scan_enabled: boolean;
  folders_scanned_count: number;
  child_folder_count: number;
  child_folder_names_sample: string[];
  folders_with_at_symbol_count: number;
  valid_affiliate_folder_names: string[];
  screenshots_found_count: number;
  affiliate_attributed_screenshots_count: number;
  admin_flow_screenshots_count: number;
  screenshots_inside_affiliate_folders_count: number;
  loose_unattributed_screenshots_count: number;
  mutation_methods_invoked: string[];
  safety_confirmation: {
    no_drive_move: true;
    no_drive_trash: true;
    no_drive_delete: true;
    no_drive_archive: true;
    no_drive_suppress: true;
  };
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
  requestedRootFolderId: string;
  effectiveRootFolderId: string;
  effectiveRootFolderName: string;
  rootFolderHasAffiliateEmailToken: boolean;
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
      requestedRootFolderId: '',
      effectiveRootFolderId: 'local_input',
      effectiveRootFolderName: 'local_input',
      rootFolderHasAffiliateEmailToken: false,
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
      requestedRootFolderId: options.rootFolderId || process.env.MERLIN_AFFILIATE_SCREENSHOT_ROOT_FOLDER_ID || '',
      effectiveRootFolderId: '',
      effectiveRootFolderName: '',
      rootFolderHasAffiliateEmailToken: false,
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
      requestedRootFolderId: options.rootFolderId || process.env.MERLIN_AFFILIATE_SCREENSHOT_ROOT_FOLDER_ID || '',
      effectiveRootFolderId: '',
      effectiveRootFolderName: '',
      rootFolderHasAffiliateEmailToken: false,
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

  const requestedRootFolderId = options.rootFolderId || process.env.MERLIN_AFFILIATE_SCREENSHOT_ROOT_FOLDER_ID || '';
  let rootFolderId =
    requestedRootFolderId ||
    options.parentFolderId ||
    process.env.MERLIN_AFFILIATE_SCREENSHOT_PARENT_FOLDER_ID ||
    authConfig.rootFolderId;
  let rootFolderPath = options.parentFolderPath || process.env.MERLIN_AFFILIATE_SCREENSHOT_PARENT_FOLDER_PATH || '';
  if (!rootFolderId) {
    rootFolderId = 'root';
    rootFolderPath = rootFolderPath || 'root';
  }
  if (requestedRootFolderId) {
    try {
      const metadata = await client.getFileMetadata(requestedRootFolderId);
      rootFolderId = metadata.drive_file_id || requestedRootFolderId;
      rootFolderPath = metadata.file_name || requestedRootFolderId;
    } catch (error) {
      return {
        status: 'error',
        reason: `root_folder_metadata_unavailable:${error instanceof Error ? error.message : 'unknown_error'}`,
        driveScopeUsed: requestedRootFolderId,
        requestedRootFolderId,
        effectiveRootFolderId: requestedRootFolderId,
        effectiveRootFolderName: '',
        rootFolderHasAffiliateEmailToken: false,
        scannedRootId: requestedRootFolderId,
        scannedRootName: '',
        driveScopeMode: authConfig.rootMode,
        authMode: authConfig.mode,
        discoveryMode: 'drive_folder_walk',
        recursiveScanEnabled: false,
        folders: [],
        client
      };
    }
  }
  if (!rootFolderPath) rootFolderPath = rootFolderId;
  const scannedRootName = rootFolderPath.split(/[\\/]+/).filter(Boolean).pop() || rootFolderPath;
  const rootFolderHasAffiliateEmailToken = Boolean(
    resolveAffiliateFolderAttributionFromPath({ folderPath: rootFolderPath }).affiliate_attribution_email
  );

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
    requestedRootFolderId,
    effectiveRootFolderId: rootFolderId,
    effectiveRootFolderName: scannedRootName,
    rootFolderHasAffiliateEmailToken,
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

function createMutationAuditClient(client: DriveClient, mutationMethodsInvoked: string[]): DriveClient {
  return {
    listFilesInFolder(folderId: string) {
      return client.listFilesInFolder(folderId);
    },
    listSubfoldersInFolder: client.listSubfoldersInFolder
      ? (folderId: string) => client.listSubfoldersInFolder!(folderId)
      : undefined,
    getFileMetadata(fileId: string) {
      return client.getFileMetadata(fileId);
    },
    downloadFileContent(fileId: string) {
      return client.downloadFileContent(fileId);
    },
    downloadFileBinary: client.downloadFileBinary ? (fileId: string) => client.downloadFileBinary!(fileId) : undefined,
    findFolderByName(name: string, parentFolderId: string) {
      return client.findFolderByName(name, parentFolderId);
    },
    listFoldersByName(name: string, parentFolderId: string) {
      return client.listFoldersByName(name, parentFolderId);
    },
    async moveFileToFolder(fileId: string, targetFolderId: string): Promise<boolean> {
      mutationMethodsInvoked.push('moveFileToFolder');
      return client.moveFileToFolder(fileId, targetFolderId);
    },
    async trashFile(fileId: string): Promise<boolean> {
      mutationMethodsInvoked.push('trashFile');
      if (typeof client.trashFile !== 'function') return false;
      return client.trashFile(fileId);
    },
    async createFolderIfMissing(name: string, parentFolderId: string) {
      mutationMethodsInvoked.push('createFolderIfMissing');
      return client.createFolderIfMissing(name, parentFolderId);
    }
  };
}

function summarizePreflight(input: {
  generatedAt: string;
  discovery: Awaited<ReturnType<typeof discoverFolders>>;
  mutationMethodsInvoked: string[];
}): AffiliateScreenshotFolderPreflightReport {
  const folderNames = input.discovery.folders.map((folder) => folder.folderName).filter((name) => name.trim().length > 0);
  const childFolders = input.discovery.folders.slice(1);
  const validAffiliateFolders = input.discovery.folders.filter((folder) =>
    Boolean(resolveAffiliateFolderAttributionFromPath({ folderPath: folder.folderPath || folder.folderName }).affiliate_attribution_email)
  );
  const validAffiliateFolderIds = new Set(validAffiliateFolders.map((folder) => folder.folderId));
  let screenshotsFoundCount = 0;
  let screenshotsInsideAffiliateFoldersCount = 0;
  let looseUnattributedScreenshotsCount = 0;

  for (const folder of input.discovery.folders) {
    const files = folder.files.filter((file) => isSupportedScreenshot(file.fileName, file.mimeType));
    screenshotsFoundCount += files.length;
    if (validAffiliateFolderIds.has(folder.folderId)) {
      screenshotsInsideAffiliateFoldersCount += files.length;
    } else {
      looseUnattributedScreenshotsCount += files.length;
    }
  }

  const folderMetadataAccessible =
    input.discovery.status === 'ok' &&
    input.discovery.effectiveRootFolderId.trim().length > 0 &&
    input.discovery.effectiveRootFolderName.trim().length > 0;
  const hasValidAffiliateFolder = validAffiliateFolders.length > 0;
  const status: AffiliateScreenshotFolderPreflightReport['status'] =
    input.discovery.status === 'error'
      ? 'error'
      : input.discovery.status === 'disabled' || !folderMetadataAccessible
        ? 'blocked'
        : 'ok';
  const reason =
    input.discovery.reason ||
    (!folderMetadataAccessible
      ? 'folder_metadata_unavailable'
      : undefined);

  return {
    generated_at: input.generatedAt,
    status,
    reason,
    requested_root_folder_id: input.discovery.requestedRootFolderId,
    effective_root_folder_id: input.discovery.effectiveRootFolderId,
    effective_root_folder_name: input.discovery.effectiveRootFolderName,
    auth_mode: input.discovery.authMode,
    drive_scope_mode: input.discovery.driveScopeMode,
    folder_metadata_accessible: folderMetadataAccessible,
    recursive_scan_enabled: input.discovery.recursiveScanEnabled,
    folders_scanned_count: input.discovery.folders.length,
    child_folder_count: childFolders.length,
    child_folder_names_sample: childFolders.map((folder) => folder.folderName).slice(0, 20),
    folders_with_at_symbol_count: folderNames.filter((name) => name.includes('@')).length,
    valid_affiliate_folder_names: validAffiliateFolders.map((folder) => folder.folderName),
    screenshots_found_count: screenshotsFoundCount,
    affiliate_attributed_screenshots_count: screenshotsInsideAffiliateFoldersCount,
    admin_flow_screenshots_count: looseUnattributedScreenshotsCount,
    screenshots_inside_affiliate_folders_count: screenshotsInsideAffiliateFoldersCount,
    loose_unattributed_screenshots_count: looseUnattributedScreenshotsCount,
    mutation_methods_invoked: input.mutationMethodsInvoked,
    safety_confirmation: {
      no_drive_move: true,
      no_drive_trash: true,
      no_drive_delete: true,
      no_drive_archive: true,
      no_drive_suppress: true
    }
  };
}

export async function preflightAffiliateScreenshotFolders(
  options: AffiliateScreenshotFolderProcessingOptions
): Promise<AffiliateScreenshotFolderPreflightReport> {
  const generatedAt = new Date().toISOString();
  const mutationMethodsInvoked: string[] = [];
  const discovery = await discoverFolders({
    ...options,
    apply: false,
    client: options.client ? createMutationAuditClient(options.client, mutationMethodsInvoked) : undefined
  });
  const report = summarizePreflight({
    generatedAt,
    discovery,
    mutationMethodsInvoked
  });
  if (options.reportPath) {
    writeFileSync(options.reportPath, renderAffiliateScreenshotFolderPreflightReport(report), 'utf8');
  }
  return report;
}

async function buildSeedInputs(input: {
  folders: AffiliateScreenshotFolderInput[];
  client?: DriveClient;
  generatedAt: string;
}): Promise<{
  seedInputs: MerlinExistingScreenshotSeedInput[];
  affiliateFolders: AffiliateScreenshotFolderProcessingReport['affiliate_folders'];
  screenshotsFoundCount: number;
  affiliateAttributedScreenshotsCount: number;
  adminFlowScreenshotsCount: number;
  adminFlowSourceFileIds: string[];
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
  let affiliateAttributedScreenshotsCount = 0;
  let adminFlowScreenshotsCount = 0;
  const adminFlowSourceFileIds: string[] = [];

  for (const folder of input.folders) {
    const folderPath = folder.folderPath || folder.folderName;
    const attribution = resolveAffiliateFolderAttributionFromPath({ folderPath });
    const files = folder.files.filter((file) => isSupportedScreenshot(file.fileName, file.mimeType));
    if (attribution.affiliate_attribution_email) {
      affiliateFolders.push({
        folder_id: folder.folderId,
        folder_name: folder.folderName,
        affiliate_attribution_email: attribution.affiliate_attribution_email,
        screenshot_count: files.length
      });
    }
    if (files.length === 0) continue;
    screenshotsFoundCount += files.length;
    if (!folder.folderPath?.trim() && !folder.folderName?.trim()) {
      filesMissingParentFolderMetadataCount += files.length;
    }

    if (!attribution.affiliate_attribution_email) {
      foldersWithoutValidEmailCount += 1;
      filesWithoutAttributionCount += files.length;
      adminFlowScreenshotsCount += files.length;
      adminFlowSourceFileIds.push(...files.map((file) => file.fileId));
    } else {
      affiliateAttributedScreenshotsCount += files.length;
    }

    for (const file of files) {
      const extractedText = await readFileText(input.client, file);
      const adminFlowAttribution: MerlinExistingScreenshotSeedInput['sourceFileAttribution'] = {
        attributionSource: 'request_context',
        attributionStatus: 'unmatched',
        sourceChannel: 'admin_import',
        modifiedAt: file.modifiedTime,
        capturedAt: input.generatedAt,
        needsAttributionReview: false,
        affiliate_attribution_source: 'admin_unattributed',
        affiliate_attribution_warnings: ['admin_unattributed']
      };
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
        sourceFileAttribution: attribution.affiliate_attribution_email
          ? {
              attributionSource: 'folder_context',
              attributionStatus: 'matched_affiliate_folder',
              sourceChannel: 'drive_upload',
              modifiedAt: file.modifiedTime,
              capturedAt: input.generatedAt,
              needsAttributionReview: false,
              ...attribution
            }
          : adminFlowAttribution
      });
    }
  }

  return {
    seedInputs,
    affiliateFolders,
    screenshotsFoundCount,
    affiliateAttributedScreenshotsCount,
    adminFlowScreenshotsCount,
    adminFlowSourceFileIds,
    foldersWithoutValidEmailCount,
    filesWithoutAttributionCount,
    filesMissingParentFolderMetadataCount
  };
}

function countResults(results: MerlinProfileSeedResult[], adminFlowSourceFileIds: Set<string>): Pick<
  AffiliateScreenshotFolderProcessingReport,
  | 'mealscout_created_count'
  | 'mealscout_updated_count'
  | 'tradescout_created_count'
  | 'tradescout_updated_count'
  | 'blocked_ambiguous_count'
  | 'blocked_missing_identity_count'
  | 'admin_flow_profiles_created_count'
  | 'admin_flow_profiles_updated_count'
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
    admin_flow_profiles_created_count: results.filter((row) => adminFlowSourceFileIds.has(row.sourceFileId) && row.profile_action === 'create').length,
    admin_flow_profiles_updated_count: results.filter((row) => adminFlowSourceFileIds.has(row.sourceFileId) && row.profile_action === 'update').length,
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
  const counts = countResults(results, new Set(built.adminFlowSourceFileIds));
  const validAffiliateFolderNames = built.affiliateFolders.map((folder) => folder.folder_name);
  const hasEmptyAffiliateFolder = built.affiliateFolders.some((folder) => folder.screenshot_count === 0);
  const folderNamesScanned = discovery.folders.map((folder) => folder.folderName).filter((name) => name.trim().length > 0);
  const fileParentFolderIds = discovery.folders
    .flatMap((folder) => folder.files.map((file) => file.parentFolderId || folder.folderId))
    .filter((value) => value.trim().length > 0);
  const fileParentFolderNames = discovery.folders
    .flatMap((folder) => folder.files.map((file) => file.parentFolderName || folder.folderName))
    .filter((value) => value.trim().length > 0);
  const reason =
    discovery.reason ||
    (discovery.status === 'ok' && hasEmptyAffiliateFolder && built.screenshotsFoundCount === 0
      ? 'folder_empty'
      : undefined);
  const report: AffiliateScreenshotFolderProcessingReport = {
    generated_at: generatedAt,
    mode: options.apply ? 'apply' : 'dry_run',
    status: discovery.status,
    reason,
    drive_scope_used: discovery.driveScopeUsed,
    requested_root_folder_id: discovery.requestedRootFolderId,
    effective_root_folder_id: discovery.effectiveRootFolderId,
    effective_root_folder_name: discovery.effectiveRootFolderName,
    root_folder_has_affiliate_email_token: discovery.rootFolderHasAffiliateEmailToken,
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
    affiliate_attributed_screenshots_count: built.affiliateAttributedScreenshotsCount,
    admin_flow_screenshots_count: built.adminFlowScreenshotsCount,
    loose_unattributed_screenshots_count: built.adminFlowScreenshotsCount,
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
    `requested_root_folder_id: ${report.requested_root_folder_id}`,
    `effective_root_folder_id: ${report.effective_root_folder_id}`,
    `effective_root_folder_name: ${report.effective_root_folder_name}`,
    `root_folder_has_affiliate_email_token: ${report.root_folder_has_affiliate_email_token}`,
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
    `affiliate_attributed_screenshots_count: ${report.affiliate_attributed_screenshots_count}`,
    `admin_flow_screenshots_count: ${report.admin_flow_screenshots_count}`,
    `loose_unattributed_screenshots_count: ${report.loose_unattributed_screenshots_count}`,
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
    `admin_flow_profiles_created_count: ${report.admin_flow_profiles_created_count}`,
    `admin_flow_profiles_updated_count: ${report.admin_flow_profiles_updated_count}`,
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

export function renderAffiliateScreenshotFolderPreflightReport(report: AffiliateScreenshotFolderPreflightReport): string {
  const lines = [
    'Merlin affiliate screenshot folder preflight report',
    '',
    `generated_at: ${report.generated_at}`,
    `status: ${report.status}`,
    `reason: ${report.reason || ''}`,
    `requested_root_folder_id: ${report.requested_root_folder_id}`,
    `effective_root_folder_id: ${report.effective_root_folder_id}`,
    `effective_root_folder_name: ${report.effective_root_folder_name}`,
    `auth_mode: ${report.auth_mode}`,
    `drive_scope_mode: ${report.drive_scope_mode}`,
    `folder_metadata_accessible: ${report.folder_metadata_accessible}`,
    `recursive_scan_enabled: ${report.recursive_scan_enabled}`,
    `folders_scanned_count: ${report.folders_scanned_count}`,
    `child_folder_count: ${report.child_folder_count}`,
    `child_folder_names_sample: ${report.child_folder_names_sample.join(', ')}`,
    `folders_with_at_symbol_count: ${report.folders_with_at_symbol_count}`,
    `valid_affiliate_folder_names: ${report.valid_affiliate_folder_names.join(', ')}`,
    `screenshots_found_count: ${report.screenshots_found_count}`,
    `affiliate_attributed_screenshots_count: ${report.affiliate_attributed_screenshots_count}`,
    `admin_flow_screenshots_count: ${report.admin_flow_screenshots_count}`,
    `screenshots_inside_affiliate_folders_count: ${report.screenshots_inside_affiliate_folders_count}`,
    `loose_unattributed_screenshots_count: ${report.loose_unattributed_screenshots_count}`,
    `mutation_methods_invoked: ${report.mutation_methods_invoked.join(', ')}`,
    '',
    'safety_confirmation:',
    '- no_drive_move',
    '- no_drive_trash',
    '- no_drive_delete',
    '- no_drive_archive',
    '- no_drive_suppress',
    ''
  ];
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
    else if (arg === '--preflight-only') parsed.preflightOnly = true;
    else if (arg === '--input') parsed.inputPath = argv[++index];
    else if (arg === '--report') parsed.reportPath = resolve(process.cwd(), argv[++index] || AFFILIATE_SCREENSHOT_FOLDER_REPORT_FILE);
    else if (arg === '--root-folder-id') parsed.rootFolderId = argv[++index];
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
  if (args.preflightOnly) {
    const report = await preflightAffiliateScreenshotFolders({
      ...args,
      localFolders: readLocalFolders(args.inputPath)
    });
    process.stdout.write(renderAffiliateScreenshotFolderPreflightReport(report));
    return;
  }
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
