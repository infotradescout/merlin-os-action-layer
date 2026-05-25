import { createDriveBootstrapPlan, createFileRoutingPlan, parseDriveManagerConfig, type DriveManagerConfig } from './driveManager.js';
import { classifyDriveManagedPath, getRequiredDriveFolders, normalizeDriveFolderName } from './driveFolders.js';
import { createDriveFileRecord, mapDriveFileToSourceRecord, shouldCreate4dataEvent } from './driveIngest.js';
import {
  createManifestEntry,
  getManifestEntryByDriveFileId,
  markManifestFailed,
  markManifestNeedsReview,
  markManifestProcessed,
  markManifestSkipped,
  updateManifestExtraction
} from './driveManifest.js';
import { ingestDriveImportEvent } from './lisa.js';
import { getDriveAuthConfig, getDriveAuthProfile, type DriveAuthConfig } from './driveAuth.js';
import { getDriveClient, type DriveClient, type DriveFileInfo } from './driveClient.js';
import { recordReplayEvent } from './replay.js';
import { extractSupportedFile } from './fileExtraction.js';

type FolderAlias =
  | '00_Inbox'
  | '01_Processed'
  | '02_Needs_Review'
  | '03_Archived_Sources'
  | '04_Entity_Files'
  | '05_Exports'
  | '06_Audit'
  | '07_System';

const FOLDER_NAMES: FolderAlias[] = [
  '00_Inbox',
  '01_Processed',
  '02_Needs_Review',
  '03_Archived_Sources',
  '04_Entity_Files',
  '05_Exports',
  '06_Audit',
  '07_System'
];
const BOOTSTRAP_ENABLED_ENV = 'MERLIN_DRIVE_BOOTSTRAP_ENABLED';
const CREATE_MISSING_ENV = 'MERLIN_DRIVE_CREATE_MISSING_FOLDERS';
const LEGACY_ALLOW_CREATE_ENV = 'MERLIN_DRIVE_ALLOW_FOLDER_CREATE';

type DriveSyncBlockReason = 'setup_required' | 'folder_conflict';

type RouteDecision = 'processed' | 'needs_review' | 'skipped';

function buildPath(name: string, usePrefix: boolean, rootFolderName: string): string {
  return usePrefix ? `${normalizeDriveFolderName(rootFolderName)}/${name}` : name;
}

function toAuthConfig(config?: DriveManagerConfig): DriveAuthConfig {
  if (!config) {
    return getDriveAuthConfig();
  }
  return getDriveAuthConfig({
    ...process.env,
    MERLIN_DRIVE_MODE: config.mode,
    MERLIN_DRIVE_SYNC_ENABLED: config.syncEnabled ? 'true' : 'false',
    MERLIN_DRIVE_ROOT_MODE: config.rootMode,
    MERLIN_DRIVE_ROOT_FOLDER_NAME: config.rootFolderName,
    MERLIN_DRIVE_SYNC_MODE: config.syncMode
  });
}

function defaultManagedFolders(): Record<FolderAlias, { id: string; path: string }> {
  const entries: Record<FolderAlias, { id: string; path: string }> = {} as Record<FolderAlias, { id: string; path: string }>;
  for (const folderName of FOLDER_NAMES) {
    entries[folderName] = { id: '', path: folderName };
  }
  return entries;
}

async function resolveParentFolder(
  config: DriveManagerConfig,
  client: DriveClient,
  explicitRootFolderId?: string
): Promise<{ folderId: string; useFolderPrefix: boolean }> {
  if (explicitRootFolderId) {
    return { folderId: explicitRootFolderId, useFolderPrefix: false };
  }

  const rootFolder = await client.findFolderByName(config.rootFolderName, 'root');
  if (!rootFolder) {
    return { folderId: 'root', useFolderPrefix: false };
  }

  return { folderId: rootFolder.id, useFolderPrefix: true };
}

export interface DriveSyncDiscovery {
  status: 'ready' | 'disabled' | 'error';
  reason?: string;
  mode: DriveManagerConfig['mode'];
  syncMode: DriveManagerConfig['syncMode'];
  rootMode: DriveManagerConfig['rootMode'];
  root_folder_name: string;
  root_folder_id?: string;
  folder_paths: string[];
  managed_folders: Record<FolderAlias, { id: string; path: string }>;
  canonical_folder_ids: Record<FolderAlias, string>;
  duplicate_managed_folders: Partial<Record<FolderAlias, string[]>>;
  sync_blocked: boolean;
  sync_block_reason?: DriveSyncBlockReason;
  bootstrap_enabled: boolean;
  create_missing_folders: boolean;
  folder_create_allowed: boolean;
  bootstrap_plan: ReturnType<typeof createDriveBootstrapPlan>;
}

export interface DriveSyncSummary {
  status: 'ok' | 'disabled' | 'error';
  processed: number;
  needs_review: number;
  skipped: number;
  failed: number;
  manifest_updates: number;
  replay_events: number;
  block_reason?: DriveSyncBlockReason;
  reason?: string;
}

function envTrue(value: string | undefined): boolean {
  return (value || '').toLowerCase() === 'true';
}

export interface DriveSyncImportResult {
  route: RouteDecision;
  manifest_id: string;
  event_id?: string;
  replay_events: number;
  manifest_failed: boolean;
  reason: string;
}

export async function discoverManagedFolders(
  options: { client?: DriveClient; config?: DriveManagerConfig; rootFolderId?: string } = {}
): Promise<DriveSyncDiscovery> {
  const config = options.config || parseDriveManagerConfig();
  const authConfig = toAuthConfig(config);
  const profile = getDriveAuthProfile(authConfig);
  const bootstrapEnabled = envTrue(process.env[BOOTSTRAP_ENABLED_ENV]);
  const createMissingFolders = envTrue(process.env[CREATE_MISSING_ENV]);
  const legacyAllowCreate = envTrue(process.env[LEGACY_ALLOW_CREATE_ENV]);
  const allowFolderCreate = legacyAllowCreate || (bootstrapEnabled && createMissingFolders);
  const defaultCanonicalIds = {} as Record<FolderAlias, string>;
  for (const folderName of FOLDER_NAMES) {
    defaultCanonicalIds[folderName] = '';
  }

  if (!config.syncEnabled || !profile.ready) {
    return {
      status: 'disabled',
      reason: profile.reason || 'Drive sync disabled',
      mode: config.mode,
      syncMode: config.syncMode,
      rootMode: config.rootMode,
      root_folder_name: config.rootFolderName,
      folder_paths: [],
      managed_folders: defaultManagedFolders(),
      canonical_folder_ids: defaultCanonicalIds,
      duplicate_managed_folders: {},
      sync_blocked: true,
      bootstrap_enabled: bootstrapEnabled,
      create_missing_folders: createMissingFolders,
      folder_create_allowed: allowFolderCreate,
      bootstrap_plan: createDriveBootstrapPlan([], config.rootFolderName)
    };
  }

  const client = options.client || getDriveClient(authConfig);
  const { folderId: parentFolderId, useFolderPrefix } = await resolveParentFolder(config, client, options.rootFolderId);
  const observedExistingPaths: string[] = [];
  const duplicateManagedFolders: Partial<Record<FolderAlias, string[]>> = {};
  const canonicalFolderIds = {} as Record<FolderAlias, string>;
  let hasMissing = false;

  const managedFolders: Record<FolderAlias, { id: string; path: string }> = {} as Record<
    FolderAlias,
    { id: string; path: string }
  >;

  for (const folderName of FOLDER_NAMES) {
    const matches = await client.listFoldersByName(folderName, parentFolderId);
    const matchIds = matches.map((entry) => entry.id);
    const hasDuplicates = matchIds.length > 1;
    if (hasDuplicates) {
      duplicateManagedFolders[folderName] = matchIds;
    }

    let folder = matches[0];
    if (!folder && allowFolderCreate) {
      folder = await client.createFolderIfMissing(folderName, parentFolderId);
    }
    if (!folder) {
      hasMissing = true;
    }

    canonicalFolderIds[folderName] = folder?.id || '';
    managedFolders[folderName] = {
      id: folder?.id || '',
      path: buildPath(folderName, useFolderPrefix, config.rootFolderName)
    };
    if (folder) {
      observedExistingPaths.push(buildPath(folderName, useFolderPrefix, config.rootFolderName));
    }
  }

  const bootstrap = createDriveBootstrapPlan(observedExistingPaths, config.rootFolderName);
  const hasDuplicates = Object.keys(duplicateManagedFolders).length > 0;
  const syncBlocked = hasDuplicates || hasMissing;
  const blockReason: DriveSyncBlockReason | undefined = hasDuplicates
    ? 'folder_conflict'
    : hasMissing
      ? 'setup_required'
      : undefined;
  const status: DriveSyncDiscovery['status'] = syncBlocked ? 'error' : 'ready';
  const reason = blockReason;

  return {
    status,
    reason,
    mode: config.mode,
    syncMode: config.syncMode,
    rootMode: config.rootMode,
    root_folder_name: config.rootFolderName,
    root_folder_id: options.rootFolderId,
    folder_paths: Object.values(managedFolders).map((folder) => folder.path),
    managed_folders: managedFolders,
    canonical_folder_ids: canonicalFolderIds,
    duplicate_managed_folders: duplicateManagedFolders,
    sync_blocked: syncBlocked,
    sync_block_reason: blockReason,
    bootstrap_enabled: bootstrapEnabled,
    create_missing_folders: createMissingFolders,
    folder_create_allowed: allowFolderCreate,
    bootstrap_plan: {
      root_folder_name: bootstrap.root_folder_name,
      required_folders: bootstrap.required_folders,
      reusable_folders: bootstrap.reusable_folders,
      missing_folders: bootstrap.missing_folders
    }
  };
}

export function routeImportedFile(fileRecord: ReturnType<typeof createDriveFileRecord>): {
  route: RouteDecision;
  reason: string;
  moveTo: FolderAlias;
} {
  const managedPath = classifyDriveManagedPath(fileRecord.folder_path);

  if (managedPath === 'system' || managedPath === 'audit') {
    return {
      route: 'skipped',
      reason: `Files under ${managedPath} are reserved and should not create live signals`,
      moveTo: '07_System'
    };
  }

  if (managedPath === 'needs_review') {
    return {
      route: 'needs_review',
      reason: 'File is in the needs-review folder',
      moveTo: '02_Needs_Review'
    };
  }

  if (managedPath === 'inbox') {
    if (!fileRecord.entity_id) {
      return {
        route: 'needs_review',
        reason: 'Missing entity_id for inbox file',
        moveTo: '02_Needs_Review'
      };
    }

    const forProcessing = { ...fileRecord, processing_status: 'processed' as const };
    if (shouldCreate4dataEvent(forProcessing)) {
      return {
        route: 'processed',
        reason: 'Supported supported inbox file',
        moveTo: '01_Processed'
      };
    }

    return {
      route: 'needs_review',
      reason: 'Inbox file is not currently supported',
      moveTo: '02_Needs_Review'
    };
  }

  const plan = createFileRoutingPlan(fileRecord);
  if (plan.route === 'processed') {
    return {
      route: 'processed',
      reason: plan.reason,
      moveTo: '01_Processed'
    };
  }

  if (plan.route === 'needs_review') {
    return {
      route: 'needs_review',
      reason: plan.reason,
      moveTo: '02_Needs_Review'
    };
  }

  return {
    route: 'skipped',
    reason: plan.reason,
    moveTo: '02_Needs_Review'
  };
}

export async function importDriveFile(
  file: DriveFileInfo,
  options: {
    client?: DriveClient;
    folderPath: string;
    folderAlias: FolderAlias;
    managedFolders?: Record<FolderAlias, { id: string; path: string }>;
  }
): Promise<DriveSyncImportResult> {
  const client = options.client || getDriveClient();
  const fileRecord = createDriveFileRecord({
    drive_file_id: file.drive_file_id,
    file_name: file.file_name,
    mime_type: file.mime_type,
    folder_id: file.folder_id || options.folderAlias,
    folder_path: options.folderPath,
    web_url: file.web_url,
    entity_id: file.entity_id,
    observed_at: file.modified_time || new Date().toISOString()
  });

  const sourceRecord = mapDriveFileToSourceRecord(fileRecord);
  let manifest = createManifestEntry(fileRecord);
  const routing = routeImportedFile(fileRecord);
  const targetFolderId = options.managedFolders?.[routing.moveTo]?.id;
  recordReplayEvent({
    event_type: 'drive_import_received',
    entity_id: fileRecord.entity_id,
    signal_id: manifest.id,
    summary: `Drive file ${fileRecord.drive_file_id} discovered for import`,
    source_refs: [`drive:${fileRecord.drive_file_id}`, `manifest:${manifest.id}`],
    payload: sourceRecord
  });

  try {
    const content = await client.downloadFileContent(file.drive_file_id);
    const extraction = extractSupportedFile({
      file_id: file.drive_file_id,
      file_name: file.file_name,
      mime_type: file.mime_type,
      content
    });
    manifest = updateManifestExtraction(manifest.id, {
      extracted_text: extraction.extracted_text,
      extracted_fields: extraction.extracted_fields,
      extraction_status: extraction.extraction_status,
      extraction_error: extraction.extraction_error,
      extracted_at: extraction.extracted_at
    });

    if (extraction.extraction_status === 'completed') {
      recordReplayEvent({
        event_type: 'drive_file_extraction_completed',
        entity_id: fileRecord.entity_id,
        signal_id: manifest.id,
        summary: `Drive file ${file.drive_file_id} extraction completed`,
        source_refs: [`manifest:${manifest.id}`],
        payload: {
          extracted_at: extraction.extracted_at,
          mime_type: extraction.mime_type
        }
      });
    } else if (extraction.extraction_status === 'failed') {
      recordReplayEvent({
        event_type: 'drive_file_extraction_failed',
        entity_id: fileRecord.entity_id,
        signal_id: manifest.id,
        summary: `Drive file ${file.drive_file_id} extraction failed`,
        source_refs: [`manifest:${manifest.id}`],
        payload: {
          extraction_error: extraction.extraction_error
        }
      });
    } else {
      recordReplayEvent({
        event_type: 'drive_file_metadata_only',
        entity_id: fileRecord.entity_id,
        signal_id: manifest.id,
        summary: `Drive file ${file.drive_file_id} extraction stored metadata only`,
        source_refs: [`manifest:${manifest.id}`],
        payload: {
          extraction_status: extraction.extraction_status
        }
      });
    }
  } catch (error) {
    const extractionError = error instanceof Error ? error.message : 'extraction_failed';
    manifest = updateManifestExtraction(manifest.id, {
      extraction_status: 'failed',
      extraction_error: extractionError,
      extracted_at: new Date().toISOString()
    });
    recordReplayEvent({
      event_type: 'drive_file_extraction_failed',
      entity_id: fileRecord.entity_id,
      signal_id: manifest.id,
      summary: `Drive file ${file.drive_file_id} extraction failed`,
      source_refs: [`manifest:${manifest.id}`],
      payload: {
        extraction_error: extractionError
      }
    });
  }

  try {
    if (routing.route === 'processed') {
      const eventId = ingestDriveImportEvent({
        entity_id: fileRecord.entity_id || 'unknown-entity',
        event_type: 'drive_file_imported',
        origin_surface: 'drive',
        observed_at: fileRecord.observed_at,
        source_reference: `drive:${fileRecord.drive_file_id}`,
        payload: {
          source_record: sourceRecord,
          folder_path: fileRecord.folder_path,
          folder_id: fileRecord.folder_id,
          mime_type: fileRecord.mime_type,
          drive_file_id: fileRecord.drive_file_id,
          web_url: fileRecord.web_url,
          file_name: fileRecord.file_name,
          processing_status: fileRecord.processing_status
        },
        file_name: fileRecord.file_name
      } as never);

      const updated = markManifestProcessed(manifest.id, {
        source_record_id: `drive:${fileRecord.drive_file_id}`,
        created_4data_event_id: eventId,
        processed_at: fileRecord.observed_at
      });
      if (targetFolderId) {
        await client.moveFileToFolder(file.drive_file_id, targetFolderId);
      }

      recordReplayEvent({
        event_type: 'drive_import_processed',
        entity_id: fileRecord.entity_id,
        signal_id: eventId,
        summary: `Drive file ${fileRecord.drive_file_id} imported`,
        source_refs: [`manifest:${updated.id}`, `lisa:${eventId}`],
        payload: {
          manifest_id: updated.id
        }
      });

      return {
        route: 'processed',
        manifest_id: manifest.id,
        event_id: eventId,
        replay_events: 2,
        manifest_failed: false,
        reason: routing.reason
      };
    }

    const updated = routing.route === 'needs_review'
      ? markManifestNeedsReview(manifest.id, routing.reason)
      : markManifestSkipped(manifest.id, routing.reason);

    if (targetFolderId) {
      await client.moveFileToFolder(file.drive_file_id, targetFolderId);
    }

    recordReplayEvent({
      event_type: routing.route === 'needs_review' ? 'drive_import_needs_review' : 'drive_import_skipped',
      entity_id: fileRecord.entity_id,
      summary: `Drive file ${fileRecord.drive_file_id} not imported`,
      source_refs: [`manifest:${updated.id}`],
      payload: {
        reason: routing.reason
      }
    });

    return {
      route: routing.route,
      manifest_id: updated.id,
      replay_events: 1,
      manifest_failed: false,
      reason: routing.reason
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Drive import failed';
    const updated = markManifestFailed(manifest.id, reason);

    if (targetFolderId) {
      await client.moveFileToFolder(file.drive_file_id, targetFolderId);
    }

    recordReplayEvent({
      event_type: 'drive_import_failed',
      entity_id: fileRecord.entity_id,
      summary: `Drive file ${fileRecord.drive_file_id} import failed`,
      source_refs: [`manifest:${updated.id}`],
      payload: { reason }
    });

    return {
      route: 'skipped',
      manifest_id: updated.id,
      replay_events: 1,
      manifest_failed: true,
      reason
    };
  }
}

export async function syncDriveInbox(
  options: { client?: DriveClient; config?: DriveManagerConfig } = {}
): Promise<DriveSyncSummary> {
  const config = options.config || parseDriveManagerConfig();
  const authConfig = toAuthConfig(config);
  const profile = getDriveAuthProfile(authConfig);
  if (!config.syncEnabled || !profile.ready) {
    return {
      status: 'disabled',
      processed: 0,
      needs_review: 0,
      skipped: 0,
      failed: 0,
      manifest_updates: 0,
      replay_events: 0,
      block_reason: undefined,
      reason: profile.reason
    };
  }

  const summary: DriveSyncSummary = {
    status: 'ok',
    processed: 0,
    needs_review: 0,
    skipped: 0,
    failed: 0,
    manifest_updates: 0,
    replay_events: 0
  };

  const client = options.client || getDriveClient(authConfig);
  const discovery = await discoverManagedFolders({ client, config, rootFolderId: authConfig.rootFolderId });
  if (discovery.status !== 'ready') {
    return {
      status: 'error',
      processed: 0,
      needs_review: 0,
      skipped: 0,
      failed: 1,
      manifest_updates: 0,
      replay_events: 0,
      block_reason: discovery.sync_block_reason,
      reason: discovery.reason
    };
  }

  const inboxFolder = discovery.managed_folders['00_Inbox'];
  if (!inboxFolder?.id) {
    return {
      status: 'error',
      processed: 0,
      needs_review: 0,
      skipped: 0,
      failed: 1,
      manifest_updates: 0,
      replay_events: 0,
      reason: 'Drive inbox folder not found'
    };
  }

  const files = await client.listFilesInFolder(inboxFolder.id);
  for (const file of files) {
    if (getManifestEntryByDriveFileId(file.drive_file_id)) {
      continue;
    }

    const result = await importDriveFile(file, {
      client,
      folderPath: inboxFolder.path,
      folderAlias: '00_Inbox',
      managedFolders: discovery.managed_folders
    });

    summary.manifest_updates += 1;
    summary.replay_events += result.replay_events;
    if (result.manifest_failed) {
      summary.failed += 1;
    } else if (result.route === 'processed') {
      summary.processed += 1;
    } else if (result.route === 'needs_review') {
      summary.needs_review += 1;
    } else {
      summary.skipped += 1;
    }
  }

  return summary;
}
