import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFromDotFile } from '../src/env.js';
import { getDriveClient, type DriveClient } from '../src/driveClient.js';
import { processExistingScreenshotsIntoSeededProfiles, type MerlinExistingScreenshotSeedInput } from '../src/merlin/profileSeedRuntime.js';
import { buildMerlinProfileSeedExportBundle } from '../src/merlin/affiliateScreenshotFolderProcessing.js';

type MoveManifestRow = {
  batch_id: string;
  operation: string;
  source_file_id: string;
  source_file_name: string;
  source_folder_id: string;
  source_folder_name: string;
  visible_business_name: string;
  category: string;
  destination_project: string;
  destination_folder_name: string;
  destination_folder_id: string;
  seed_action: string;
  safety_gate: string;
  confidence: string;
  move_status: string;
  notes: string;
};

type ExecutionMode = 'execute' | 'diagnose' | 'copy';

type DiagnosticClassification =
  | 'parent_visible'
  | 'parent_missing'
  | 'file_not_found'
  | 'permission_insufficient'
  | 'destination_missing'
  | 'destination_not_writable'
  | 'unknown_drive_metadata_blocker';

type AuditRow = {
  source_file_id: string;
  source_file_name: string;
  intended_destination_folder: string;
  final_folder_id: string;
  move_status: string;
  moved_at: string;
  moved_by_executor: string;
  notes: string;
};

type ExecuteManifestOptions = {
  mode?: ExecutionMode;
  manifestPath?: string;
  auditPath?: string;
  diagnosticPath?: string;
  copyExecutionPath?: string;
  copyAuditPath?: string;
  seedReportPath?: string;
  seedExportPath?: string;
  movedBy?: string;
  client?: DriveClient;
};

type CopyExecutionRow = {
  batch_id: string;
  source_file_id: string;
  source_file_name: string;
  destination_project: string;
  destination_folder_name: string;
  destination_folder_id: string;
  seed_action: string;
  safety_gate: string;
  confidence: string;
  copy_status: 'copied' | 'blocked_copy_failed' | 'skipped_ineligible';
  copied_file_id: string;
  copied_at: string;
  executor: string;
  notes: string;
};

type CopyAuditRow = {
  batch_id: string;
  source_file_id: string;
  source_file_name: string;
  copied_file_id: string;
  destination_project: string;
  destination_folder_name: string;
  destination_folder_id: string;
  seed_action: string;
  safety_gate: string;
  copy_status: 'copied' | 'blocked_copy_failed' | 'skipped_ineligible';
  copied_at: string;
  executor: string;
  notes: string;
};

type Batch001SeedReportRow = {
  seedId?: string;
  brand_lane?: string;
  sourceFileId: string;
  sourceFileName: string;
  sourceFilePath?: string;
  source_refs?: string[];
  seed_status?: string;
  profile_action?: string;
  target_profile_id?: string;
  target_profile_type?: string;
  profile_name?: string;
  profile_email?: string;
  phone?: string;
  website?: string;
  socials?: Record<string, unknown>;
  extracted_fields?: Record<string, unknown>;
  seeded_from_evidence: true;
  profile_origin: 'evidence_seed';
  claim_status: 'unclaimed';
  email_verified: false;
  insurance_verified: false;
  owner_user_id: null;
  original_source_file_id: string;
  copied_file_id: string;
  evidence_file_id: string;
  source_file_id: string;
  attribution_method?: string;
  submission_flow?: string;
  safety_notes?: string[];
  verification_email_status?: string;
  mutationAllowed?: boolean;
};

type DiagnosticRow = {
  source_file_id: string;
  source_file_name: string;
  batch_id: string;
  input_move_status: string;
  classification: DiagnosticClassification;
  source_metadata: {
    file_id?: string;
    name?: string;
    mimeType?: string;
    parents?: string[];
    owners?: unknown;
    permissions?: unknown;
    capabilities?: unknown;
  };
  destination_check: {
    destination_folder_name: string;
    destination_folder_id?: string;
    visible: boolean;
    writable: boolean;
  };
  controlled_retry_state_applied: boolean;
  notes: string;
};

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      value = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
}

function toCsv(rows: string[][]): string {
  return `${rows
    .map((row) =>
      row
        .map((cell) => {
          const safe = cell ?? '';
          if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
            return `"${safe.replace(/"/g, '""')}"`;
          }
          return safe;
        })
        .join(',')
    )
    .join('\n')}\n`;
}

function readMoveManifest(path: string): MoveManifestRow[] {
  const parsed = parseCsv(readFileSync(path, 'utf8'));
  if (parsed.length < 2) throw new Error('Move manifest is empty');
  const [header, ...body] = parsed;
  const headerMap = new Map<string, number>();
  header.forEach((name, index) => headerMap.set(name, index));

  const required = [
    'batch_id',
    'operation',
    'source_file_id',
    'source_file_name',
    'source_folder_id',
    'source_folder_name',
    'destination_project',
    'destination_folder_name',
    'seed_action',
    'safety_gate',
    'confidence',
    'move_status'
  ];
  for (const key of required) {
    if (!headerMap.has(key)) throw new Error(`Manifest missing required column: ${key}`);
  }

  return body.map((row) => {
    const get = (key: string) => row[headerMap.get(key) ?? -1] || '';
    return {
      batch_id: get('batch_id'),
      operation: get('operation'),
      source_file_id: get('source_file_id'),
      source_file_name: get('source_file_name'),
      source_folder_id: get('source_folder_id'),
      source_folder_name: get('source_folder_name'),
      visible_business_name: get('visible_business_name'),
      category: get('category'),
      destination_project: get('destination_project'),
      destination_folder_name: get('destination_folder_name'),
      destination_folder_id: get('destination_folder_id'),
      seed_action: get('seed_action'),
      safety_gate: get('safety_gate'),
      confidence: get('confidence'),
      move_status: get('move_status'),
      notes: get('notes')
    } satisfies MoveManifestRow;
  });
}

function assertManifestSafety(rows: MoveManifestRow[]): void {
  for (const row of rows) {
    if (!row.source_file_id || !row.source_file_name || !row.destination_project || !row.destination_folder_name || !row.seed_action || !row.safety_gate || !row.confidence) {
      throw new Error(`Manifest row missing required values: ${row.source_file_id || row.source_file_name}`);
    }
    if (row.operation !== 'move_when_available') {
      throw new Error(`Unsupported operation for row ${row.source_file_id}: ${row.operation}`);
    }
    const isContractor = row.batch_id === 'BATCH-004-TRADESCOUT-CONTRACTORS';
    if (isContractor && (row.seed_action === 'seed_to_merlin_evidence' || row.destination_project === 'Merlin / MealScout')) {
      throw new Error(`Contractor row violates seeding boundary: ${row.source_file_id}`);
    }
  }
}

function isMoveEligible(row: MoveManifestRow): boolean {
  return (
    row.operation === 'move_when_available' &&
    (row.move_status === 'pending' ||
      row.move_status === 'failed' ||
      row.move_status === 'blocked_missing_current_parent' ||
      row.move_status === 'blocked_drive_permission_or_parent_semantics')
  );
}

function isDiagnoseEligible(row: MoveManifestRow): boolean {
  return (
    row.operation === 'move_when_available' &&
    (row.move_status === 'pending' ||
      row.move_status === 'failed' ||
      row.move_status === 'blocked_missing_current_parent' ||
      row.move_status === 'blocked_drive_permission_or_parent_semantics')
  );
}

function isCopyEligible(row: MoveManifestRow): boolean {
  const operationAllowed = row.operation === 'move_when_available' || row.operation === 'copy_when_available';
  const statusAllowed =
    row.move_status === 'pending' ||
    row.move_status === 'failed' ||
    row.move_status === 'blocked_missing_current_parent' ||
    row.move_status === 'blocked_drive_permission_or_parent_semantics';
  return operationAllowed && statusAllowed;
}

function isPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /insufficient|permission|forbidden|403/i.test(message);
}

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|404/i.test(message);
}

async function ensureDestinationFolderId(row: MoveManifestRow, cache: Map<string, string>, client: DriveClient): Promise<string> {
  if (row.destination_folder_id?.trim()) return row.destination_folder_id.trim();
  const cacheKey = `${row.source_folder_id}::${row.destination_folder_name}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const sourceFolder = await client.getFileMetadata(row.source_folder_id);
  let parentFolderId = sourceFolder.folder_id;
  if (!parentFolderId) {
    // Shared-drive folder metadata can omit parents for top-level folders;
    // in that case, create destination paths under the source folder itself.
    parentFolderId = row.source_folder_id;
  }

  const parts = row.destination_folder_name.split('/').map((value) => value.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Invalid destination folder name for row ${row.source_file_id}`);
  }

  let currentParent = parentFolderId;
  for (const part of parts) {
    const existing = await client.findFolderByName(part, currentParent);
    if (existing) {
      currentParent = existing.id;
      continue;
    }
    const created = await client.createFolderIfMissing(part, currentParent);
    currentParent = created.id;
  }

  cache.set(cacheKey, currentParent);
  return currentParent;
}

async function resolveDestinationFolderIdForDiagnose(
  row: MoveManifestRow,
  cache: Map<string, string>,
  client: DriveClient
): Promise<string | undefined> {
  if (row.destination_folder_id?.trim()) return row.destination_folder_id.trim();
  const cacheKey = `${row.source_folder_id}::${row.destination_folder_name}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const parts = row.destination_folder_name.split('/').map((value) => value.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;

  let currentParent = row.source_folder_id;
  for (const part of parts) {
    const existing = await client.findFolderByName(part, currentParent);
    if (!existing) return undefined;
    currentParent = existing.id;
  }

  cache.set(cacheKey, currentParent);
  return currentParent;
}

function writeMoveManifest(path: string, rows: MoveManifestRow[]): void {
  const header = [
    'batch_id',
    'operation',
    'source_file_id',
    'source_file_name',
    'source_folder_id',
    'source_folder_name',
    'visible_business_name',
    'category',
    'destination_project',
    'destination_folder_name',
    'destination_folder_id',
    'seed_action',
    'safety_gate',
    'confidence',
    'move_status',
    'notes'
  ];

  const body = rows.map((row) => [
    row.batch_id,
    row.operation,
    row.source_file_id,
    row.source_file_name,
    row.source_folder_id,
    row.source_folder_name,
    row.visible_business_name,
    row.category,
    row.destination_project,
    row.destination_folder_name,
    row.destination_folder_id,
    row.seed_action,
    row.safety_gate,
    row.confidence,
    row.move_status,
    row.notes
  ]);

  writeFileSync(path, toCsv([header, ...body]), 'utf8');
}

function writeAuditManifest(path: string, rows: AuditRow[]): void {
  const header = [
    'source_file_id',
    'source_file_name',
    'intended_destination_folder',
    'final_folder_id',
    'move_status',
    'moved_at',
    'moved_by / executor',
    'notes'
  ];
  const body = rows.map((row) => [
    row.source_file_id,
    row.source_file_name,
    row.intended_destination_folder,
    row.final_folder_id,
    row.move_status,
    row.moved_at,
    row.moved_by_executor,
    row.notes
  ]);
  writeFileSync(path, toCsv([header, ...body]), 'utf8');
}

function writeDiagnostic(path: string, payload: { mode: ExecutionMode; generated_at: string; rows: DiagnosticRow[] }): void {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeCopyExecutionManifest(path: string, rows: CopyExecutionRow[]): void {
  const header = [
    'batch_id',
    'source_file_id',
    'source_file_name',
    'destination_project',
    'destination_folder_name',
    'destination_folder_id',
    'seed_action',
    'safety_gate',
    'confidence',
    'copy_status',
    'copied_file_id',
    'copied_at',
    'executor',
    'notes'
  ];
  const body = rows.map((row) => [
    row.batch_id,
    row.source_file_id,
    row.source_file_name,
    row.destination_project,
    row.destination_folder_name,
    row.destination_folder_id,
    row.seed_action,
    row.safety_gate,
    row.confidence,
    row.copy_status,
    row.copied_file_id,
    row.copied_at,
    row.executor,
    row.notes
  ]);
  writeFileSync(path, toCsv([header, ...body]), 'utf8');
}

function writeCopyAuditManifest(path: string, rows: CopyAuditRow[]): void {
  const header = [
    'batch_id',
    'source_file_id',
    'source_file_name',
    'copied_file_id',
    'destination_project',
    'destination_folder_name',
    'destination_folder_id',
    'seed_action',
    'safety_gate',
    'copy_status',
    'copied_at',
    'executor',
    'notes'
  ];
  const body = rows.map((row) => [
    row.batch_id,
    row.source_file_id,
    row.source_file_name,
    row.copied_file_id,
    row.destination_project,
    row.destination_folder_name,
    row.destination_folder_id,
    row.seed_action,
    row.safety_gate,
    row.copy_status,
    row.copied_at,
    row.executor,
    row.notes
  ]);
  writeFileSync(path, toCsv([header, ...body]), 'utf8');
}

function readModeFromArgv(argv: string[]): ExecutionMode {
  const modeEq = argv.find((arg) => arg.startsWith('--mode='));
  if (modeEq) {
    const value = modeEq.split('=')[1]?.trim().toLowerCase();
    if (value === 'copy') return 'copy';
    return value === 'diagnose' ? 'diagnose' : 'execute';
  }
  const modeIndex = argv.findIndex((arg) => arg === '--mode');
  if (modeIndex >= 0) {
    const value = (argv[modeIndex + 1] || '').trim().toLowerCase();
    if (value === 'copy') return 'copy';
    return value === 'diagnose' ? 'diagnose' : 'execute';
  }
  return 'execute';
}

async function runCopyMode(
  rows: MoveManifestRow[],
  options: {
    movedBy: string;
    copyExecutionPath: string;
    copyAuditPath: string;
    seedReportPath: string;
    seedExportPath: string;
    client: DriveClient;
  }
): Promise<{
  moved_total: number;
  failed_total: number;
  batch001_seed_inputs: number;
  batch001_seeded_results: number;
  audit_manifest: string;
  seed_report: string;
  seed_export: string;
}> {
  const folderCache = new Map<string, string>();
  const copyExecutionRows: CopyExecutionRow[] = [];
  const copyAuditRows: CopyAuditRow[] = [];

  for (const row of rows) {
    const copiedAt = new Date().toISOString();
    if (!isCopyEligible(row)) {
      copyExecutionRows.push({
        batch_id: row.batch_id,
        source_file_id: row.source_file_id,
        source_file_name: row.source_file_name,
        destination_project: row.destination_project,
        destination_folder_name: row.destination_folder_name,
        destination_folder_id: row.destination_folder_id,
        seed_action: row.seed_action,
        safety_gate: row.safety_gate,
        confidence: row.confidence,
        copy_status: 'skipped_ineligible',
        copied_file_id: '',
        copied_at: copiedAt,
        executor: options.movedBy,
        notes: `${row.notes} | copy_skipped_ineligible`
      });
      continue;
    }

    try {
      const destinationFolderId = await ensureDestinationFolderId(row, folderCache, options.client);
      const copied = await options.client.copyFileToFolder?.(row.source_file_id, destinationFolderId);
      if (!copied?.drive_file_id) {
        throw new Error('copy_api_unavailable_or_missing_copied_file_id');
      }

      row.destination_folder_id = destinationFolderId;

      const copyRow: CopyExecutionRow = {
        batch_id: row.batch_id,
        source_file_id: row.source_file_id,
        source_file_name: row.source_file_name,
        destination_project: row.destination_project,
        destination_folder_name: row.destination_folder_name,
        destination_folder_id: destinationFolderId,
        seed_action: row.seed_action,
        safety_gate: row.safety_gate,
        confidence: row.confidence,
        copy_status: 'copied',
        copied_file_id: copied.drive_file_id,
        copied_at: copiedAt,
        executor: options.movedBy,
        notes: row.notes
      };
      copyExecutionRows.push(copyRow);
      copyAuditRows.push({
        batch_id: copyRow.batch_id,
        source_file_id: copyRow.source_file_id,
        source_file_name: copyRow.source_file_name,
        copied_file_id: copyRow.copied_file_id,
        destination_project: copyRow.destination_project,
        destination_folder_name: copyRow.destination_folder_name,
        destination_folder_id: copyRow.destination_folder_id,
        seed_action: copyRow.seed_action,
        safety_gate: copyRow.safety_gate,
        copy_status: copyRow.copy_status,
        copied_at: copyRow.copied_at,
        executor: copyRow.executor,
        notes: copyRow.notes
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const copyRow: CopyExecutionRow = {
        batch_id: row.batch_id,
        source_file_id: row.source_file_id,
        source_file_name: row.source_file_name,
        destination_project: row.destination_project,
        destination_folder_name: row.destination_folder_name,
        destination_folder_id: row.destination_folder_id,
        seed_action: row.seed_action,
        safety_gate: row.safety_gate,
        confidence: row.confidence,
        copy_status: 'blocked_copy_failed',
        copied_file_id: '',
        copied_at: copiedAt,
        executor: options.movedBy,
        notes: `${row.notes} | copy_error=${message}`
      };
      copyExecutionRows.push(copyRow);
      copyAuditRows.push({
        batch_id: copyRow.batch_id,
        source_file_id: copyRow.source_file_id,
        source_file_name: copyRow.source_file_name,
        copied_file_id: '',
        destination_project: copyRow.destination_project,
        destination_folder_name: copyRow.destination_folder_name,
        destination_folder_id: copyRow.destination_folder_id,
        seed_action: copyRow.seed_action,
        safety_gate: copyRow.safety_gate,
        copy_status: copyRow.copy_status,
        copied_at: copyRow.copied_at,
        executor: copyRow.executor,
        notes: copyRow.notes
      });
    }
  }

  writeCopyExecutionManifest(options.copyExecutionPath, copyExecutionRows);
  writeCopyAuditManifest(options.copyAuditPath, copyAuditRows);

  const batch001Copies = copyExecutionRows.filter(
    (row) => row.batch_id === 'BATCH-001-MEALSCOUT-MERLIN-SEED' && row.copy_status === 'copied'
  );
  const copyByCopiedFileId = new Map(batch001Copies.map((row) => [row.copied_file_id, row]));
  const batch001Screenshots: MerlinExistingScreenshotSeedInput[] = [];

  for (const row of batch001Copies) {
    const metadata = await options.client.getFileMetadata(row.copied_file_id);
    const extractedText = await options.client.downloadFileContent(row.copied_file_id);
    batch001Screenshots.push({
      fileId: row.copied_file_id,
      fileName: row.source_file_name,
      sourceFolder: row.destination_folder_name,
      sourceFolderId: row.destination_folder_id,
      drivePath: `${row.destination_folder_name}/${row.source_file_name}`,
      mimeType: metadata.mime_type,
      modifiedTime: metadata.modified_time,
      extractedText,
      sourceFileAttribution: {
        attributionSource: 'request_context',
        attributionStatus: 'unmatched',
        sourceChannel: 'admin_import',
        affiliate_attribution_source: 'admin_unattributed'
      }
    });
  }

  const seedResult = await processExistingScreenshotsIntoSeededProfiles({ screenshots: batch001Screenshots });
  const normalizedSeedRows: Batch001SeedReportRow[] = seedResult.results.map((row) => {
    const copyMeta = copyByCopiedFileId.get(row.sourceFileId);
    const originalSourceId = copyMeta?.source_file_id || row.sourceFileId;
    const copiedId = copyMeta?.copied_file_id || row.sourceFileId;
    return {
      ...row,
      seeded_from_evidence: true,
      profile_origin: 'evidence_seed',
      claim_status: 'unclaimed',
      email_verified: false,
      insurance_verified: false,
      owner_user_id: null,
      original_source_file_id: originalSourceId,
      copied_file_id: copiedId,
      evidence_file_id: copiedId,
      source_file_id: originalSourceId
    };
  });
  const normalizedSeedReport = {
    ...seedResult,
    results: normalizedSeedRows
  };
  writeFileSync(options.seedReportPath, `${JSON.stringify(normalizedSeedReport, null, 2)}\n`, 'utf8');

  const exportRows = buildMerlinProfileSeedExportBundle(seedResult.results);
  writeFileSync(options.seedExportPath, `${JSON.stringify(exportRows, null, 2)}\n`, 'utf8');

  const summary = {
    moved_total: copyExecutionRows.filter((row) => row.copy_status === 'copied').length,
    failed_total: copyExecutionRows.filter((row) => row.copy_status === 'blocked_copy_failed').length,
    batch001_seed_inputs: batch001Screenshots.length,
    batch001_seeded_results: seedResult.results.length,
    audit_manifest: options.copyAuditPath,
    seed_report: options.seedReportPath,
    seed_export: options.seedExportPath
  };
  if (summary.batch001_seed_inputs > 0) {
    process.stdout.write(`[SEED GATE OPENED] ${summary.batch001_seed_inputs} copied BATCH-001 files ready. Proceeding with Merlin seeding...\n`);
  } else {
    process.stdout.write('[SEED GATE CLOSED] No copied BATCH-001 files are available. Raw Screenshots-folder seeding remains prohibited.\n');
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  return summary;
}

async function runDiagnoseMode(
  rows: MoveManifestRow[],
  options: {
    movedBy: string;
    manifestPath: string;
    diagnosticPath: string;
    client: DriveClient;
  }
): Promise<{
  moved_total: number;
  failed_total: number;
  batch001_seed_inputs: number;
  batch001_seeded_results: number;
  audit_manifest: string;
  seed_report: string;
  seed_export: string;
}> {
  const diagnostics: DiagnosticRow[] = [];
  const destinationCache = new Map<string, string>();

  for (const row of rows) {
    if (!isDiagnoseEligible(row)) continue;

    let classification: DiagnosticClassification = 'unknown_drive_metadata_blocker';
    let sourceMetadata: DiagnosticRow['source_metadata'] = {};
    let destinationVisible = false;
    let destinationWritable = false;
    let destinationFolderId = row.destination_folder_id?.trim() || undefined;
    let controlledRetry = false;
    let notes = row.notes;

    try {
      const source = await options.client.getFileMetadata(row.source_file_id);
      sourceMetadata = {
        file_id: source.drive_file_id,
        name: source.file_name,
        mimeType: source.mime_type,
        parents: source.folder_id ? [source.folder_id] : []
      };

      if (!source.folder_id?.trim()) {
        classification = 'parent_visible';
        sourceMetadata.parents = ['root'];
        notes = `${notes} | parent_fallback=root`;
      } else {
        classification = 'parent_visible';
      }

      try {
        destinationFolderId = await resolveDestinationFolderIdForDiagnose(row, destinationCache, options.client);
        if (!destinationFolderId) {
          classification = classification === 'parent_visible' ? 'destination_missing' : classification;
        } else {
          const destination = await options.client.getFileMetadata(destinationFolderId);
          destinationVisible = true;
          destinationWritable = true;

          sourceMetadata.owners = destination.raw_metadata?.owners;
          sourceMetadata.permissions = destination.raw_metadata?.permissions;
          sourceMetadata.capabilities = destination.raw_metadata?.capabilities;

          const canAddChildren = destination.raw_metadata?.capabilities && typeof (destination.raw_metadata.capabilities as { canAddChildren?: unknown }).canAddChildren === 'boolean'
            ? Boolean((destination.raw_metadata.capabilities as { canAddChildren?: boolean }).canAddChildren)
            : true;
          destinationWritable = canAddChildren;

          if (!destinationWritable) {
            classification = 'destination_not_writable';
          }
        }
      } catch (destinationError) {
        if (isPermissionError(destinationError)) {
          classification = 'permission_insufficient';
        } else {
          classification = 'unknown_drive_metadata_blocker';
        }
      }
    } catch (sourceError) {
      if (isNotFoundError(sourceError)) {
        classification = 'file_not_found';
      } else if (isPermissionError(sourceError)) {
        classification = 'permission_insufficient';
      } else {
        classification = 'unknown_drive_metadata_blocker';
      }
      notes = `${notes} | diagnostic_error=${sourceError instanceof Error ? sourceError.message : String(sourceError)}`;
    }

    if (
      (row.move_status === 'blocked_missing_current_parent' || row.move_status === 'blocked_drive_permission_or_parent_semantics') &&
      classification === 'parent_visible' &&
      destinationVisible &&
      destinationWritable
    ) {
      row.move_status = 'failed';
      controlledRetry = true;
      row.notes = `${notes} | retry_state=failed_via_diagnose`;
      notes = row.notes;
    }

    diagnostics.push({
      source_file_id: row.source_file_id,
      source_file_name: row.source_file_name,
      batch_id: row.batch_id,
      input_move_status: row.move_status,
      classification,
      source_metadata: sourceMetadata,
      destination_check: {
        destination_folder_name: row.destination_folder_name,
        destination_folder_id: destinationFolderId,
        visible: destinationVisible,
        writable: destinationWritable
      },
      controlled_retry_state_applied: controlledRetry,
      notes
    });
  }

  writeMoveManifest(options.manifestPath, rows);
  writeDiagnostic(options.diagnosticPath, {
    mode: 'diagnose',
    generated_at: new Date().toISOString(),
    rows: diagnostics
  });

  process.stdout.write('[SEED GATE CLOSED] Diagnose mode never seeds and never moves files.\n');
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: 'diagnose',
        diagnostic_manifest: options.diagnosticPath,
        processed_rows: diagnostics.length,
        moved_total: 0,
        failed_total: diagnostics.filter((row) => row.classification !== 'parent_visible').length,
        batch001_seed_inputs: 0,
        batch001_seeded_results: 0
      },
      null,
      2
    )}\n`
  );

  return {
    moved_total: 0,
    failed_total: diagnostics.filter((row) => row.classification !== 'parent_visible').length,
    batch001_seed_inputs: 0,
    batch001_seeded_results: 0,
    audit_manifest: options.diagnosticPath,
    seed_report: 'diagnose_mode_no_seed',
    seed_export: 'diagnose_mode_no_seed'
  };
}

export async function executeManifestMoves(options: ExecuteManifestOptions = {}): Promise<{
  moved_total: number;
  failed_total: number;
  batch001_seed_inputs: number;
  batch001_seeded_results: number;
  audit_manifest: string;
  seed_report: string;
  seed_export: string;
}> {
  const mode = options.mode || 'execute';
  const manifestPath = options.manifestPath || resolve(process.cwd(), 'screenshots-bulk-move-execution-manifest.csv');
  const auditPath = options.auditPath || resolve(process.cwd(), 'screenshots-post-move-audit-manifest.csv');
  const diagnosticPath = options.diagnosticPath || resolve(process.cwd(), 'screenshots-drive-parent-permission-diagnostic.json');
  const copyExecutionPath = options.copyExecutionPath || resolve(process.cwd(), 'screenshots-copy-execution-manifest.csv');
  const copyAuditPath = options.copyAuditPath || resolve(process.cwd(), 'screenshots-copy-audit-manifest.csv');
  const seedReportPath = options.seedReportPath || resolve(process.cwd(), 'screenshots-batch001-seed-report.json');
  const seedExportPath = options.seedExportPath || resolve(process.cwd(), 'screenshots-batch001-merlin-profile-seed-export.json');
  const movedBy = options.movedBy || process.env.USERNAME || process.env.USER || 'copilot-executor';

  const rows = readMoveManifest(manifestPath);
  assertManifestSafety(rows);

  const client = options.client || getDriveClient();

  if (mode === 'diagnose') {
    return runDiagnoseMode(rows, { movedBy, manifestPath, diagnosticPath, client });
  }

  if (mode === 'copy') {
    return runCopyMode(rows, {
      movedBy,
      copyExecutionPath,
      copyAuditPath,
      seedReportPath,
      seedExportPath,
      client
    });
  }

  const folderCache = new Map<string, string>();
  const auditRows: AuditRow[] = [];

  for (const row of rows) {
    const movedAt = new Date().toISOString();
    if (!isMoveEligible(row)) {
      auditRows.push({
        source_file_id: row.source_file_id,
        source_file_name: row.source_file_name,
        intended_destination_folder: row.destination_folder_name,
        final_folder_id: row.destination_folder_id || '',
        move_status: row.move_status,
        moved_at: movedAt,
        moved_by_executor: movedBy,
        notes: `${row.notes} | execute_skipped_ineligible`
      });
      continue;
    }

    try {
      const destinationFolderId = await ensureDestinationFolderId(row, folderCache, client);
      const currentParentId = (await client.getFileMetadata(row.source_file_id)).folder_id?.trim() || 'root';

      await client.moveFileToFolder(row.source_file_id, destinationFolderId, currentParentId);
      row.destination_folder_id = destinationFolderId;
      row.move_status = 'moved';
      auditRows.push({
        source_file_id: row.source_file_id,
        source_file_name: row.source_file_name,
        intended_destination_folder: row.destination_folder_name,
        final_folder_id: destinationFolderId,
        move_status: 'moved',
        moved_at: movedAt,
        moved_by_executor: movedBy,
        notes: row.notes
      });
    } catch (error) {
      row.move_status = 'blocked_drive_permission_or_parent_semantics';
      const message = error instanceof Error ? error.message : String(error);
      auditRows.push({
        source_file_id: row.source_file_id,
        source_file_name: row.source_file_name,
        intended_destination_folder: row.destination_folder_name,
        final_folder_id: row.destination_folder_id || '',
        move_status: 'blocked_drive_permission_or_parent_semantics',
        moved_at: movedAt,
        moved_by_executor: movedBy,
        notes: `${row.notes} | move_error=${message}`
      });
    }
  }

  writeMoveManifest(manifestPath, rows);
  writeAuditManifest(auditPath, auditRows);

  const batch001Rows = rows.filter((row) => row.batch_id === 'BATCH-001-MEALSCOUT-MERLIN-SEED' && row.move_status === 'moved');
  const batch001Screenshots: MerlinExistingScreenshotSeedInput[] = [];

  for (const row of batch001Rows) {
    const metadata = await client.getFileMetadata(row.source_file_id);
    const extractedText = await client.downloadFileContent(row.source_file_id);
    batch001Screenshots.push({
      fileId: row.source_file_id,
      fileName: row.source_file_name,
      sourceFolder: row.destination_folder_name,
      sourceFolderId: row.destination_folder_id,
      drivePath: `${row.destination_folder_name}/${row.source_file_name}`,
      mimeType: metadata.mime_type,
      modifiedTime: metadata.modified_time,
      extractedText,
      sourceFileAttribution: {
        attributionSource: 'request_context',
        attributionStatus: 'unmatched',
        sourceChannel: 'admin_import',
        affiliate_attribution_source: 'admin_unattributed'
      }
    });
  }

  const seedResult = await processExistingScreenshotsIntoSeededProfiles({ screenshots: batch001Screenshots });
  writeFileSync(seedReportPath, `${JSON.stringify(seedResult, null, 2)}\n`, 'utf8');

  const exportRows = buildMerlinProfileSeedExportBundle(seedResult.results);
  writeFileSync(seedExportPath, `${JSON.stringify(exportRows, null, 2)}\n`, 'utf8');

  const summary = {
    moved_total: auditRows.filter((row) => row.move_status === 'moved').length,
    failed_total: auditRows.filter((row) => row.move_status !== 'moved').length,
    batch001_seed_inputs: batch001Screenshots.length,
    batch001_seeded_results: seedResult.results.length,
    audit_manifest: auditPath,
    seed_report: seedReportPath,
    seed_export: seedExportPath
  };
  if (summary.batch001_seed_inputs > 0) {
    process.stdout.write(`[SEED GATE OPENED] ${summary.batch001_seed_inputs} BATCH-001 files moved successfully. Proceeding with Merlin seeding...\n`);
  } else {
    process.stdout.write('[SEED GATE CLOSED] No BATCH-001 files were successfully moved. Raw Screenshots-folder seeding remains prohibited.\n');
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main(): Promise<void> {
  loadEnvFromDotFile();
  const mode = readModeFromArgv(process.argv.slice(2));
  await executeManifestMoves({ mode });
}

const invokedPath = resolve(process.argv[1] || '');
const modulePath = resolve(fileURLToPath(import.meta.url));

if (invokedPath === modulePath || invokedPath.endsWith('screenshots-manifest-move-and-seed.ts')) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
