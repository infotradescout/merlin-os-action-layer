import { createDriveBootstrapPlan, createFileRoutingPlan, parseDriveManagerConfig, type DriveManagerConfig } from './driveManager.js';  
import { classifyDriveManagedPath, getRequiredDriveFolders, normalizeDriveFolderName } from './driveFolders.js';  
import { createDriveFileRecord, mapDriveFileToSourceRecord, shouldCreate4dataEvent } from './driveIngest.js';  
import {  
 createManifestEntry,  
 getManifestEntryByDriveFileId,  
 markManifestFailed,  \
 markManifestNeedsReview,  \
 markManifestProcessed,  \
 markManifestSkipped,  \
 updateManifestExtraction  \
} from './driveManifest.js';  \
import { ingestDriveImportEvent } from './lisa.js';  \
import { getDriveAuthConfig, getDriveAuthProfile, type DriveAuthConfig } from './driveAuth.js';  \
import { getDriveClient, type DriveClient, type DriveFileInfo } from './driveClient.js';  \
import { recordReplayEvent } from './replay.js';  \
import { extractSupportedFile } from './fileExtraction.js';  \
  \
type FolderAlias =  \
 | '00_Inbox'  \
 | '01_Processed'  \
 | '02_Needs_Review'  \
 | '03_Archived_Sources'  \
 | '04_Entity_Files'  \
 | '05_Exports'  \
 | '06_Audit'  \
 | '07_System';  \
  \
const FOLDER_NAMES: FolderAlias[] = [  \
 '00_Inbox',  \
 '01_Processed',  \
 '02_Needs_Review',  \
 '03_Archived_Sources',  \
 '04_Entity_Files',  \
 '05_Exports',  \
 '06_Audit',  \
 '07_System'  \
];  \
const BOOTSTRAP_ENABLED_ENV = 'MERLIN_DRIVE_BOOTSTRAP_ENABLED';  \
const CREATE_MISSING_ENV = 'MERLIN_DRIVE_CREATE_MISSING_FOLDERS';  \
const LEGACY_ALLOW_CREATE_ENV = 'MERLIN_DRIVE_ALLOW_FOLDER_CREATE';  \
  \
type DriveSyncBlockReason = 'setup_required' | 'folder_conflict';  \
  \
type RouteDecision = 'processed' | 'needs_review' | 'skipped';  \
  \
function buildPath(name: string, usePrefix: boolean, rootFolderName: string): string {  \
 return usePrefix ? `${normalizeDriveFolderName(rootFolderName)}/${name}` : name;  \
}  \
  \
function toAuthConfig(config?: DriveManagerConfig): DriveAuthConfig {  \
 if (!config) {  \
 return getDriveAuthConfig();  \
 }  \
 return getDriveAuthConfig({  \
 ...process.env,  \
 MERLIN_DRIVE_MODE: config.mode,  \
 MERLIN_DRIVE_SYNC_ENABLED: config.syncEnabled ? 'true' : 'false',  \
 MERLIN_DRIVE_ROOT_MODE: config.rootMode,  \
 MERLIN_DRIVE_ROOT_FOLDER_NAME: config.rootFolderName,  \
 MERLIN_DRIVE_SYNC_MODE: config.syncMode  \
 });  \
}  \
  \
function defaultManagedFolders(): Record<FolderAlias, { id: string; path: string }> {  \
 const entries: Record<FolderAlias, { id: string; path: string }> = {} as Record<FolderAlias, { id: string; path: string }>;  \
 for (const folderName of FOLDER_NAMES) {  \
 entries[folderName] = { id: '', path: folderName };  \
 }  \
 return entries;  \
}  \
  \
async function resolveParentFolder(  \
 config: DriveManagerConfig,  \
 client: DriveClient,  \
 explicitRootFolderId?: string  \
): Promise<{ folderId: string; useFolderPrefix: boolean }> {  \
 if (explicitRootFolderId) {  \
 return { folderId: explicitRootFolderId, useFolderPrefix: false };  \
 }  \
  \
 const rootFolder = await client.findFolderByName(config.rootFolderName, 'root');  \
 if (!rootFolder) {  \
 return { folderId: 'root', useFolderPrefix: false };  \
 }  \
  \
 return { folderId: rootFolder.id, useFolderPrefix: true };  \
}  \
  \
export interface DriveSyncDiscovery {  \
 status: 'ready' | 'disabled' | 'error';  \
 reason?: string;  \
 mode: DriveManagerConfig['mode'];  \
 syncMode: DriveManagerConfig['syncMode'];  \
 rootMode: DriveManagerConfig['rootMode'];  \
 root_folder_name: string;  \
 root_folder_id?: string;  \
 folder_paths: string[];  \
 managed_folders: Record<FolderAlias, { id: string; path: string }>;  \
 canonical_folder_ids: Record<FolderAlias, string>;  \
 duplicate_managed_folders: Partial<Record<FolderAlias, string[]>>;  \
 sync_blocked: boolean;  \
 sync_block_reason?: DriveSyncBlockReason;  \
 bootstrap_enabled: boolean;  \
 create_missing_folders: boolean;  \
 folder_create_allowed: boolean;  \
 bootstrap_plan: ReturnType<typeof createDriveBootstrapPlan>;  \
 sync_mode: DriveManagerConfig['syncMode'];  \
}  \
  \
export interface DriveSyncSummary {  \
 status: 'ok' | 'disabled' | 'error';  \
 processed: number;  \
 needs_review: number;  \
 skipped: number;  \
 failed: number;  \
 manifest_updates: number;  \
 replay_events: number;  \
 block_reason?: DriveSyncBlockReason;  \
 reason?: string;  \
}  \
  \
function envTrue(value: string | undefined): boolean {  \
 return (value || '').toLowerCase() === 'true';  \
}  \
  \
export interface DriveSyncImportResult {  \
 route: RouteDecision;  \
 manifest_id: string;  \
 event_id?: string;  \
 replay_events: number;  \
 manifest_failed: boolean;  \
 reason: string;  \
}  \
  \
export async function discoverManagedFolders(  \
 options: { client?: DriveClient; config?: DriveManagerConfig; rootFolderId?: string } = {}  \
): Promise<DriveSyncDiscovery> {  \
 const config = options.config || parseDriveManagerConfig();  \
 const authConfig = toAuthConfig(config);  \
 const profile = getDriveAuthProfile(authConfig);  \
 const bootstrapEnabled = envTrue(process.env[BOOTSTRAP_ENABLED_ENV]);  \
 const createMissingFolders = envTrue(process.env[CREATE_MISSING_ENV]);  \
 const legacyAllowCreate = envTrue(process.env[LEGACY_ALLOW_CREATE_ENV]);  \
 const allowFolderCreate = legacyAllowCreate || (bootstrapEnabled && createMissingFolders);  \
 const defaultCanonicalIds = {} as Record<FolderAlias, string>;  \
 for (const folderName of FOLDER_NAMES) {  \
 defaultCanonicalIds[folderName] = '';  \
 }  \
  \
 if (!config.syncEnabled || !profile.ready) {  \
 return {  \
 status: 'disabled',  \
 mode: config.mode,  \
 syncMode: config.syncMode,  \
 rootMode: config.rootMode,  \
 root_folder_name: config.rootFolderName,  \
 folder_paths: [],  \
 managed_folders: defaultManagedFolders(),  \
 canonical_folder_ids: defaultCanonicalIds,  \
 duplicate_managed_folders: {},  \
 sync_blocked: true,  \
 bootstrap_enabled: bootstrapEnabled,  \
 create_missing_folders: createMissingFolders,  \
 folder_create_allowed: allowFolderCreate,  \
 bootstrap_plan: createDriveBootstrapPlan([], config.rootFolderName),  \
 sync_mode: config.syncMode  \
 };  \
 }  \
  \
 const client = options.client || getDriveClient(authConfig);  \
 const { folderId: parentFolderId, useFolderPrefix } = await resolveParentFolder(config, client, options.rootFolderId);  \
 const observedExistingPaths: string[] = [];  \
 const duplicateManagedFolders: Partial<Record<FolderAlias, string[]>> = {};  \
 const canonicalFolderIds = {} as Record<FolderAlias, string>;  \
 let hasMissing = false;  \
  \
 const managedFolders: Record<FolderAlias, { id: string; path: string }> = {} as Record<  \
 FolderAlias,  \
 { id: string; path: string }  \
 >;  \
  \
 for (const folderName of FOLDER_NAMES) {  \
 const matches = await client.listFoldersByName(folderName, parentFolderId);  \
 const matchIds = matches.map((entry) => entry.id);  \
 const hasDuplicates = matchIds.length > 1;  \
 if (hasDuplicates) {  \
 duplicateManagedFolders[folderName] = matchIds;  \
 }  \
  \
 let folder = matches[0];  \
 if (!folder && allowFolderCreate) {  \
 folder = await client.createFolderIfMissing(folderName, parentFolderId);  \
 }  \
 if (!folder) {  \
 hasMissing = true;  \
 }  \
  \
 canonicalFolderIds[folderName] = folder?.id || '';  \
 managedFolders[folderName] = {  \
 id: folder?.id || '',  \
 path: buildPath(folderName, useFolderPrefix, config.rootFolderName)  \
 };  \
 if (folder) {  \
 observedExistingPaths.push(buildPath(folderName, useFolderPrefix, config.rootFolderName));  \
 }  \
 }  \
  \
 const bootstrap = createDriveBootstrapPlan(observedExistingPaths, config.rootFolderName);  \
 const hasDuplicates = Object.keys(duplicateManagedFolders).length > 0;  \
 const syncBlocked = hasDuplicates || hasMissing;  \
 const blockReason: DriveSyncBlockReason | undefined = hasDuplicates  \
 ? 'folder_conflict'  \
 : hasMissing  \
 ? 'setup_required'  \
 : undefined;  \
 const status: DriveSyncDiscovery['status'] = syncBlocked ? 'error' : 'ready';  \
 const reason = blockReason;  \
  \
 return {  \
 status,  \
 reason,  \
 mode: config.mode,  \
 syncMode: config.syncMode,  \
 rootMode: config.rootMode,  \
 root_folder_name: config.rootFolderName,  \
 root_folder_id: options.rootFolderId,  \
 folder_paths: Object.values(managedFolders).map((folder) => folder.path),  \
 managed_folders: managedFolders,  \
 canonical_folder_ids: canonicalFolderIds,  \
 duplicate_managed_folders: duplicateManagedFolders,  \
 sync_blocked: syncBlocked,  \
 sync_block_reason: blockReason,  \
 bootstrap_enabled: bootstrapEnabled,  \
 create_missing_folders: createMissingFolders,  \
 folder_create_allowed: allowFolderCreate,  \
 bootstrap_plan: {  \
 root_folder_name: bootstrap.root_folder_name,  \
 required_folders: bootstrap.required_folders,  \
 reusable_folders: bootstrap.reusable_folders,  \
 missing_folders: bootstrap.missing_folders  \
 },  \
 sync_mode: config.syncMode  \
 };  \
}  \
  \
function isRawIntakeFile(file: { mime_type: string; file_name: string }): boolean {  \
 const mime = file.mime_type.toLowerCase();  \
 const ext = file.file_name.slice(file.file_name.lastIndexOf('.')).toLowerCase();  \
 return (  \
 mime.startsWith('image/') ||  \
 mime === 'application/pdf' ||  \
 ['.png', '.jpg', '.jpeg', '.pdf'].includes(ext)  \
 );  \
}  \
  \
export function routeImportedFile(fileRecord: DriveFileRecord): {  \
 route: RouteDecision;  \
 reason: string;  \
 moveTo: FolderAlias;  \
} {  \
 const managedPath = classifyDriveManagedPath(fileRecord.folder_path);  \
  \
 if (managedPath === 'system' || managedPath === 'audit') {  \
 return {  \
 route: 'skipped',  \
 reason: `Files under ${managedPath} are reserved and should not create live signals`,  \
 moveTo: '07_System'  \
 };  \
 }  \
  \
 if (managedPath === 'needs_review') {  \
 return {  \
 route: 'needs_review',  \
 reason: 'File is in the needs-review folder',  \
 moveTo: '02_Needs_Review'  \
 };  \
 }  \
  \
 if (managedPath === 'inbox') {  \
 const isRaw = isRawIntakeFile(fileRecord);  \
 if (!fileRecord.entity_id && !isRaw) {  \
 return {  \
 route: 'needs_review',  \
 reason: 'Missing entity_id for inbox file',  \
 moveTo: '02_Needs_Review'  \
 };  \
 }  \
  \
 const forProcessing = { ...fileRecord, processing_status: 'processed' as const };  \
 if (shouldCreate4dataEvent(forProcessing) || isRaw) {  \
 return {  \
 route: 'processed',  \
 reason: isRaw ? 'Raw intake evidence file' : 'Supported supported inbox file',  \
 moveTo: '01_Processed'  \
 };  \
 }  \
  \
 return {  \
 route: 'needs_review',  \
 reason: 'Inbox file is not currently supported',  \
 moveTo: '02_Needs_Review'  \
 };  \
 }  \
  \
 const plan = createFileRoutingPlan(fileRecord);  \
 if (plan.route === 'processed') {  \
 return {  \
 route: 'processed',  \
 reason: plan.reason,  \
 moveTo: '01_Processed'  \
 };  \
 }  \
  \
 if (plan.route === 'needs_review') {  \
 return {  \
 route: 'needs_review',  \
 reason: plan.reason,  \
 moveTo: '02_Needs_Review'  \
 };  \
 }  \
  \
 return {  \
 route: 'skipped',  \
 reason: plan.reason,  \
 moveTo: '02_Needs_Review'  \
 };  \
}  \
  \
export async function importDriveFile(  \
 file: DriveFileInfo,  \
 options: {  \
 client?: DriveClient;  \
 folderPath: string;  \
 folderAlias: FolderAlias;  \
 managedFolders?: Record<FolderAlias, { id: string; path: string }>;  \
 }  \
): Promise<DriveSyncImportResult> {  \
 const client = options.client || getDriveClient();  \
 const fileRecord = createDriveFileRecord({  \
 drive_file_id: file.drive_file_id,  \
 file_name: file.file_name,  \
 mime_type: file.mime_type,  \
 folder_id: file.folder_id || options.folderAlias,  \
 folder_path: options.folderPath,  \
 web_url: file.web_url,  \
 entity_id: file.entity_id,  \
 observed_at: file.modified_time || new Date().toISOString()  \
 });  \
  \
 const sourceRecord = mapDriveFileToSourceRecord(fileRecord);  \
 let manifest = createManifestEntry(fileRecord);  \
 const routing = routeImportedFile(fileRecord);  \
 const targetFolderId = options.managedFolders?.[routing.moveTo]?.id;  \
 recordReplayEvent({  \
 event_type: 'drive_import_received',  \
 entity_id: fileRecord.entity_id,  \
 signal_id: manifest.id,  \
 summary: `Drive file ${fileRecord.drive_file_id} discovered for import`,  \
 source_refs: [`drive:${fileRecord.drive_file_id}`, `manifest:${manifest.id}`],  \
 payload: sourceRecord  \
 });  \
  \
 try {  \
 const content = await client.downloadFileContent(file.drive_file_id);  \
 const extraction = extractSupportedFile({  \
 file_id: file.drive_file_id,  \
 file_name: file.file_name,  \
 mime_type: file.mime_type,  \
 content  \n });  \n manifest = updateManifestExtraction(manifest.id, {  \n extracted_text: extraction.extracted_text,  \n extracted_fields: extraction.extracted_fields,  \n extraction_status: extraction.extraction_status,  \n extraction_error: extraction.extraction_error,  \n extracted_at: extraction.extracted_at  \n });  \n  \n if (extraction.extraction_status === 'completed') {  \n recordReplayEvent({  \n event_type: 'drive_file_extraction_completed',  \n entity_id: fileRecord.entity_id,  \n signal_id: manifest.id,  \n summary: `Drive file ${file.drive_file_id} extraction completed`,  \n source_refs: [`manifest:${manifest.id}`],  \n payload: {  \n extracted_at: extraction.extracted_at,  \n mime_type: extraction.mime_type  \n }  \n });  \n } else if (extraction.extraction_status === 'failed') {  \n recordReplayEvent({  \n event_type: 'drive_file_extraction_failed',  \n entity_id: fileRecord.entity_id,  \n signal_id: manifest.id,  \n summary: `Drive file ${file.drive_file_id} extraction failed`,  \n source_refs: [`manifest:${manifest.id}`],  \n payload: {  \n extraction_error: extraction.extraction_error  \n }  \n });  \n } else {  \n recordReplayEvent({  \n event_type: 'drive_file_metadata_only',  \n entity_id: fileRecord.entity_id,  \n signal_id: manifest.id,  \n summary: `Drive file ${file.drive_file_id} extraction stored metadata only`,  \n source_refs: [`manifest:${manifest.id}`],  \n payload: {  \n extraction_status: extraction.extraction_status  \n }  \n });  \n }  \n } catch (error) {  \n const extractionError = error instanceof Error ? error.message : 'extraction_failed';  \n manifest = updateManifestExtraction(manifest.id, {  \n extraction_status: 'failed',  \n extraction_error: extractionError,  \n extracted_at: new Date().toISOString()  \n });  \n recordReplayEvent({  \n event_type: 'drive_file_extraction_failed',  \n entity_id: fileRecord.entity_id,  \n signal_id: manifest.id,  \n summary: `Drive file ${file.drive_file_id} extraction failed`,  \n source_refs: [`manifest:${manifest.id}`],  \n payload: {  \n extraction_error: extractionError  \n }  \n });  \n }  \n  \n try {  \n if (routing.route === 'processed') {  \n const eventId = ingestDriveImportEvent({  \n entity_id: fileRecord.entity_id || 'unknown-entity',  \n event_type: 'drive_file_imported',  \n origin_surface: 'drive',  \n observed_at: fileRecord.observed_at,  \n source_reference: `drive:${fileRecord.drive_file_id}`,  \n payload: {  \n source_record: sourceRecord,  \n folder_path: fileRecord.folder_path,  \n folder_id: fileRecord.folder_id,  \n mime_type: fileRecord.mime_type,  \n drive_file_id: fileRecord.drive_file_id,  \n web_url: fileRecord.web_url,  \n file_name: fileRecord.file_name,  \n processing_status: fileRecord.processing_status  \n },  \n file_name: fileRecord.file_name  \n } as never);  \n  \n const updated = markManifestProcessed(manifest.id, {  \n source_record_id: `drive:${fileRecord.drive_file_id}`,  \n created_4data_event_id: eventId,  \n processed_at: fileRecord.observed_at  \n });  \n if (targetFolderId) {  \n await client.moveFileToFolder(file.drive_file_id, targetFolderId);  \n }  \n  \n let extraEventsCount = 0;  \n if (isRawIntakeFile(fileRecord)) {  \n ingestDriveImportEvent({  \n entity_id: fileRecord.entity_id || 'unknown-entity',  \n event_type: 'screenshot_intake_queued',  \n origin_surface: 'drive',  \n observed_at: fileRecord.observed_at,  \n source_reference: `drive:${fileRecord.drive_file_id}`,  \n payload: {  \n drive_file_id: fileRecord.drive_file_id,  \n file_name: fileRecord.file_name,  \n mime_type: fileRecord.mime_type,  \n web_url: fileRecord.web_url  \n },  \n file_name: fileRecord.file_name  \n } as never);  \n extraEventsCount = 1;  \n }  \n  \n recordReplayEvent({  \n event_type: 'drive_import_processed',  \n entity_id: fileRecord.entity_id,  \n signal_id: eventId,  \n summary: `Drive file ${fileRecord.drive_file_id} imported`,  \n source_refs: [`manifest:${updated.id}`, `lisa:${eventId}`],  \n payload: {  \n manifest_id: updated.id  \n }  \n });  \n  \n return {  \n route: 'processed',  \n manifest_id: manifest.id,  \n event_id: eventId,  \n replay_events: 2 + extraEventsCount,  \n manifest_failed: false,  \n reason: routing.reason  \n };  \n }  \n  \n const updated = routing.route === 'needs_review'  \n ? markManifestNeedsReview(manifest.id, routing.reason)  \n : markManifestSkipped(manifest.id, routing.reason);  \n  \n if (targetFolderId) {  \n await client.moveFileToFolder(file.drive_file_id, targetFolderId);  \n }  \n  \n recordReplayEvent({  \n event_type: routing.route === 'needs_review' ? 'drive_import_needs_review' : 'drive_import_skipped',  \n entity_id: fileRecord.entity_id,  \n summary: `Drive file ${fileRecord.drive_file_id} not imported`,  \n source_refs: [`manifest:${updated.id}`],  \n payload: {  \n reason: routing.reason  \n }  \n });  \n  \n return {  \n route: routing.route,  \n manifest_id: updated.id,  \n replay_events: 1,  \n manifest_failed: false,  \n reason: routing.reason  \n };  \n } catch (error) {  \n const reason = error instanceof Error ? error.message : 'Drive import failed';  \n const updated = markManifestFailed(manifest.id, reason);  \n  \n if (targetFolderId) {  \n await client.moveFileToFolder(file.drive_file_id, targetFolderId);  \n }  \n  \n recordReplayEvent({  \n event_type: 'drive_import_failed',  \n entity_id: fileRecord.entity_id,  \n summary: `Drive file ${fileRecord.drive_file_id} import failed`,  \n source_refs: [`manifest:${updated.id}`],  \n payload: { reason }  \n });  \n  \n return {  \n route: 'skipped',  \n manifest_id: updated.id,  \n replay_events: 1,  \n manifest_failed: true,  \n reason  \n };  \n }  \n}  \n  \nexport async function syncDriveInbox(  \n options: { client?: DriveClient; config?: DriveManagerConfig } = {}  \n): Promise<DriveSyncSummary> {  \n const config = options.config || parseDriveManagerConfig();  \n const authConfig = toAuthConfig(config);  \n const profile = getDriveAuthProfile(authConfig);  \n if (!config.syncEnabled || !profile.ready) {  \n return {  \n status: 'disabled',  \n processed: 0,  \n needs_review: 0,  \n skipped: 0,  \n failed: 0,  \n manifest_updates: 0,  \n replay_events: 0,  \n block_reason: undefined,  \n reason: profile.reason  \n };  \n }  \n  \n const summary: DriveSyncSummary = {  \n status: 'ok',  \n processed: 0,  \n needs_review: 0,  \n skipped: 0,  \n failed: 0,  \n manifest_updates: 0,  \n replay_events: 0  \n };  \n  \n const client = options.client || getDriveClient(authConfig);  \n const discovery = await discoverManagedFolders({ client, config, rootFolderId: authConfig.rootFolderId });  \n if (discovery.status !== 'ready') {  \n return {  \n status: 'error',  \n processed: 0,  \n needs_review: 0,  \n skipped: 0,  \n failed: 1,  \n manifest_updates: 0,  \n replay_events: 0,  \n block_reason: discovery.sync_block_reason,  \n reason: discovery.reason  \n };  \n }  \n  \n const inboxFolder = discovery.managed_folders['00_Inbox'];  \n if (!inboxFolder?.id) {  \n return {  \n status: 'error',  \n processed: 0,  \n needs_review: 0,  \n skipped: 0,  \n failed: 1,  \n manifest_updates: 0,  \n replay_events: 0,  \n reason: 'Drive inbox folder not found'  \n };  \n }  \n  \n async function syncFolder(folderId: string, folderPath: string, folderAlias: FolderAlias) {  \n const files = await client.listFilesInFolder(folderId);  \n for (const file of files) {  \n if (getManifestEntryByDriveFileId(file.drive_file_id)) {  \n continue;  \n }  \n  \n const result = await importDriveFile(file, {  \n client,  \n folderPath,  \n folderAlias,  \n managedFolders: discovery.managed_folders  \n });  \n  \n summary.manifest_updates += 1;  \n summary.replay_events += result.replay_events;  \n if (result.manifest_failed) {  \n summary.failed += 1;  \n } else if (result.route === 'processed') {  \n summary.processed += 1;  \n } else if (result.route === 'needs_review') {  \n summary.needs_review += 1;  \n } else {  \n summary.skipped += 1;  \n }  \n }  \n }  \n  \n await syncFolder(inboxFolder.id, inboxFolder.path, '00_Inbox');  \n  \n try {  \n const { discoverMealScoutIntakeFolders } = await import('./mealscoutDriveIntake.js');  \n const msDiscovery = await discoverMealScoutIntakeFolders({ client });  \n const msScreenshotsFolder = msDiscovery.folders['incoming/screenshots'];  \n if (msScreenshotsFolder && msScreenshotsFolder.id) {  \n await syncFolder(msScreenshotsFolder.id, msScreenshotsFolder.path, '00_Inbox');  \n }  \n } catch {  \n // Soft fallback if MealScout intake module is missing/disabled  \n }  \n  \n try {  \n const legacyFolderId = process.env.MERLIN_MEALSCOUT_LEGACY_SCREENSHOTS_FOLDER_ID;  \n if (legacyFolderId) {  \n await syncFolder(legacyFolderId, 'MealScout screenshot/Screenshots', '00_Inbox');  \n } else {  \n const legacyRoot = await client.findFolderByName('MealScout screenshot ', 'root');  \n if (legacyRoot && legacyRoot.id) {  \n const legacyScreenshots = await client.findFolderByName('Screenshots', legacyRoot.id);  \n if (legacyScreenshots && legacyScreenshots.id) {  \n await syncFolder(legacyScreenshots.id, 'MealScout screenshot/Screenshots', '00_Inbox');  \n }  \n }  \n }  \n } catch {  \n // Soft fallback if legacy folder cannot be located or is inaccessible  \n }  \n  \n return summary;  \n}  \n